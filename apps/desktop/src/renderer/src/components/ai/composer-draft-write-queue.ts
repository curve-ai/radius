import type { ComposerDraftContext } from "../../../../radius-api";

export const COMPOSER_DRAFT_SAVE_DELAY_MS = 500;
export const COMPOSER_DRAFT_SAVE_MAX_WAIT_MS = 2_000;

export function composerDraftContextKey(context: ComposerDraftContext): string {
  return context.kind === "session"
    ? `session:${context.sessionId}`
    : context.projectId === null
      ? "new_chat:standalone"
      : `new_chat:project:${context.projectId}`;
}

interface ScheduledDraftWrite {
  operation: () => Promise<void>;
  maxTimer: ReturnType<typeof setTimeout>;
  promise: Promise<void>;
  reject(error: unknown): void;
  resolve(): void;
  timer: ReturnType<typeof setTimeout>;
}

export class ComposerDraftWriteQueue {
  readonly #tails = new Map<string, Promise<void>>();
  readonly #scheduled = new Map<string, ScheduledDraftWrite>();

  #enqueue(contextKey: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.#tails.get(contextKey) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.#tails.set(contextKey, current);
    const cleanup = (): void => {
      if (this.#tails.get(contextKey) === current) {
        this.#tails.delete(contextKey);
      }
    };
    void current.then(cleanup, cleanup);
    return current;
  }

  #commitScheduled(contextKey: string): void {
    const scheduled = this.#scheduled.get(contextKey);
    if (!scheduled) return;
    this.#scheduled.delete(contextKey);
    clearTimeout(scheduled.timer);
    clearTimeout(scheduled.maxTimer);
    void this.#enqueue(contextKey, scheduled.operation).then(
      scheduled.resolve,
      scheduled.reject,
    );
  }

  enqueue(contextKey: string, operation: () => Promise<void>): Promise<void> {
    this.#commitScheduled(contextKey);
    return this.#enqueue(contextKey, operation);
  }

  scheduleLatest(
    contextKey: string,
    operation: () => Promise<void>,
    delayMs = COMPOSER_DRAFT_SAVE_DELAY_MS,
    maxWaitMs = COMPOSER_DRAFT_SAVE_MAX_WAIT_MS,
  ): Promise<void> {
    const existing = this.#scheduled.get(contextKey);
    if (existing) {
      existing.operation = operation;
      clearTimeout(existing.timer);
      existing.timer = setTimeout(
        () => this.#commitScheduled(contextKey),
        delayMs,
      );
      return existing.promise;
    }

    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const scheduled: ScheduledDraftWrite = {
      operation,
      maxTimer: setTimeout(() => this.#commitScheduled(contextKey), maxWaitMs),
      promise,
      reject,
      resolve,
      timer: setTimeout(() => this.#commitScheduled(contextKey), delayMs),
    };
    this.#scheduled.set(contextKey, scheduled);
    return promise;
  }

  async waitForIdle(contextKey: string): Promise<void> {
    this.#commitScheduled(contextKey);
    let current: Promise<void> | undefined;
    while ((current = this.#tails.get(contextKey))) {
      await current.catch(() => undefined);
      if (this.#tails.get(contextKey) === current) return;
    }
  }
}
