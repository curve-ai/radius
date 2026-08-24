import {
  createLocalScheduler,
  type LocalScheduler,
} from "@curve-ai/radius-scheduler";
import { powerMonitor } from "electron";

import type { StorageContext } from "./storage";

let scheduler: LocalScheduler | null = null;

const wakeScheduler = (): void => {
  void scheduler?.wake().catch((error) => {
    console.error("[scheduler] Reconciliation failed", error);
  });
};

export async function initializeScheduler(
  context: StorageContext,
): Promise<void> {
  if (scheduler) return;
  scheduler = createLocalScheduler({
    database: context.database,
    onError: (error) =>
      console.error("[scheduler] Scheduled dispatch failed", error),
  });
  powerMonitor.on("resume", wakeScheduler);
  powerMonitor.on("unlock-screen", wakeScheduler);
  await scheduler.start();
}

export async function stopScheduler(): Promise<void> {
  powerMonitor.removeListener("resume", wakeScheduler);
  powerMonitor.removeListener("unlock-screen", wakeScheduler);
  const active = scheduler;
  scheduler = null;
  await active?.stop();
}
