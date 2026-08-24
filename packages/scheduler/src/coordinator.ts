import {
  claimScheduledRun,
  failScheduledRun,
  getNextScheduledRunWakeAt,
  markScheduledRunDispatched,
  retryScheduledRun,
  type ClaimedScheduledRun,
  type RadiusDatabase,
} from "@curve-ai/radius-storage";

import { reconcileSchedules } from "./reconcile.js";

const DEFAULT_LEASE_DURATION_MS = 60_000;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_MAX_DISPATCH_ATTEMPTS = 3;
const DEFAULT_MAX_DISPATCHES_PER_WAKE = 100;
const SAFETY_WAKE_INTERVAL_MS = 60_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;

export interface ScheduledTaskExecutor {
  dispatch(run: ClaimedScheduledRun): Promise<{ sessionId: string | null }>;
}

export interface LocalSchedulerOptions {
  database: RadiusDatabase;
  executor?: ScheduledTaskExecutor;
  leaseDurationMs?: number;
  retryDelayMs?: number;
  maxDispatchAttempts?: number;
  maxDispatchesPerWake?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
}

export interface LocalScheduler {
  start(): Promise<void>;
  wake(): Promise<void>;
  stop(): Promise<void>;
}

function retryDelay(baseMs: number, attemptCount: number): number {
  return Math.min(baseMs * 2 ** Math.max(0, attemptCount - 1), 60_000);
}

export function createLocalScheduler(
  options: LocalSchedulerOptions,
): LocalScheduler {
  const now = options.now ?? Date.now;
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const maxDispatchAttempts =
    options.maxDispatchAttempts ?? DEFAULT_MAX_DISPATCH_ATTEMPTS;
  const maxDispatchesPerWake = Math.max(
    1,
    Math.floor(options.maxDispatchesPerWake ?? DEFAULT_MAX_DISPATCHES_PER_WAKE),
  );
  let started = false;
  let timer: NodeJS.Timeout | null = null;
  let wakePromise: Promise<void> | null = null;
  let wakeAgain = false;

  const clearWakeTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const setWakeTimer = (delay: number): void => {
    timer = setTimeout(() => void scheduler.wake(), delay);
    timer.unref();
  };

  const nextWakeAt = async (
    currentTime: number,
    nextScheduleAt: number | null,
  ): Promise<number> => {
    const runWakeAt = options.executor
      ? await getNextScheduledRunWakeAt(options.database)
      : null;
    const candidates = [
      currentTime + SAFETY_WAKE_INTERVAL_MS,
      runWakeAt,
      nextScheduleAt,
    ].filter((value): value is number => value !== null);
    return Math.min(...candidates);
  };

  const armWakeTimer = async (nextScheduleAt: number | null): Promise<void> => {
    clearWakeTimer();
    if (!started) return;
    const currentTime = now();
    const wakeAt = await nextWakeAt(currentTime, nextScheduleAt);
    const delay = Math.max(
      0,
      Math.min(wakeAt - currentTime, MAX_TIMER_DELAY_MS),
    );
    setWakeTimer(delay);
  };

  const dispatchReadyRuns = async (): Promise<void> => {
    if (!options.executor) return;
    for (
      let dispatchCount = 0;
      started && dispatchCount < maxDispatchesPerWake;
      dispatchCount += 1
    ) {
      const currentTime = now();
      const run = await claimScheduledRun(options.database, {
        now: currentTime,
        leaseDurationMs,
      });
      if (!run) return;
      try {
        const result = await options.executor.dispatch(run);
        const settled = await markScheduledRunDispatched(
          options.database,
          run.id,
          run.leaseToken,
          result.sessionId,
        );
        if (!settled) throw new Error("Scheduled run lease became stale");
      } catch (error) {
        const errorCode =
          error instanceof Error && error.message
            ? error.message
            : "SCHEDULE_DISPATCH_FAILED";
        if (run.attemptCount >= maxDispatchAttempts) {
          await failScheduledRun(options.database, run.id, run.leaseToken, {
            errorCode,
            now: now(),
          });
        } else {
          await retryScheduledRun(options.database, run.id, run.leaseToken, {
            availableAtMs: now() + retryDelay(retryDelayMs, run.attemptCount),
            errorCode,
          });
        }
        options.onError?.(error);
      }
    }
  };

  const runWake = async (): Promise<void> => {
    let nextScheduleAt: number | null = null;
    try {
      do {
        wakeAgain = false;
        clearWakeTimer();
        const reconciliation = await reconcileSchedules(
          options.database,
          now(),
        );
        nextScheduleAt = reconciliation.nextOccurrenceAtMs;
        await dispatchReadyRuns();
      } while (started && wakeAgain);
    } catch (error) {
      options.onError?.(error);
    } finally {
      try {
        await armWakeTimer(nextScheduleAt);
      } catch (error) {
        options.onError?.(error);
        clearWakeTimer();
        if (started) setWakeTimer(SAFETY_WAKE_INTERVAL_MS);
      }
    }
  };

  const scheduler: LocalScheduler = {
    async start(): Promise<void> {
      if (started) return scheduler.wake();
      started = true;
      await scheduler.wake();
    },
    async wake(): Promise<void> {
      if (!started) return;
      if (wakePromise) {
        wakeAgain = true;
        return wakePromise;
      }
      wakePromise = runWake().finally(() => {
        wakePromise = null;
      });
      return wakePromise;
    },
    async stop(): Promise<void> {
      started = false;
      clearWakeTimer();
      await wakePromise;
    },
  };

  return scheduler;
}
