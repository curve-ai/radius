import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DESKTOP_UPDATE_CHANNELS,
  desktopUpdateStatusesEqual,
  normalizeUpdatePercent,
  type DesktopUpdateStatus,
} from "./update-types";

const idleStatus: DesktopUpdateStatus = {
  state: "idle",
  currentVersion: "1.0.0",
  availableVersion: null,
  percent: null,
  errorCode: null,
};

describe("desktop update contract", () => {
  test("uses distinct IPC channels", () => {
    assert.equal(new Set(Object.values(DESKTOP_UPDATE_CHANNELS)).size, 4);
  });

  test("normalizes progress to the integer percentage shown by the UI", () => {
    assert.equal(normalizeUpdatePercent(-1), 0);
    assert.equal(normalizeUpdatePercent(41.6), 42);
    assert.equal(normalizeUpdatePercent(101), 100);
  });

  test("deduplicates structurally equal statuses", () => {
    assert.equal(
      desktopUpdateStatusesEqual(idleStatus, { ...idleStatus }),
      true,
    );
    assert.equal(
      desktopUpdateStatusesEqual(idleStatus, {
        ...idleStatus,
        state: "checking",
      }),
      false,
    );
  });
});
