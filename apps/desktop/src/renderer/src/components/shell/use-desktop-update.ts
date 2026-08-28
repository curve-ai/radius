import { useCallback, useEffect, useState } from "react";

import type { DesktopUpdateStatus } from "../../../../update-types";

export function useDesktopUpdate(): {
  status: DesktopUpdateStatus | null;
  checkForUpdates: () => Promise<void>;
  performUpdate: () => Promise<void>;
} {
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);

  useEffect(() => {
    if (
      typeof window.radius.updateStatus !== "function" ||
      typeof window.radius.onUpdateStatus !== "function"
    ) {
      return;
    }

    let active = true;
    void window.radius
      .updateStatus()
      .then((nextStatus) => {
        if (active) setStatus(nextStatus);
      })
      .catch(() => {
        if (active) setStatus(null);
      });
    const unsubscribe = window.radius.onUpdateStatus((nextStatus) => {
      if (active) setStatus(nextStatus);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const checkForUpdates = useCallback(async (): Promise<void> => {
    if (typeof window.radius.checkForUpdates !== "function") return;
    try {
      await window.radius.checkForUpdates();
    } catch {
      setStatus((current) =>
        current
          ? {
              ...current,
              state: "error",
              percent: null,
              errorCode: "UPDATE_FAILED",
            }
          : null,
      );
    }
  }, []);

  const performUpdate = useCallback(async (): Promise<void> => {
    if (typeof window.radius.performUpdate !== "function") return;
    try {
      await window.radius.performUpdate();
    } catch {
      setStatus((current) =>
        current
          ? {
              ...current,
              state: "error",
              percent: null,
              errorCode: "UPDATE_FAILED",
            }
          : null,
      );
    }
  }, []);

  return { status, checkForUpdates, performUpdate };
}
