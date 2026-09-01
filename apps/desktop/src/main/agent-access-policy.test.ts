import assert from "node:assert/strict";
import test from "node:test";

import {
  needsFileApproval,
  needsTerminalApproval,
  type AgentAccessMode,
} from "./agent-access-policy";

const accessModes: AgentAccessMode[] = ["ask", "project", "full"];

test("keeps terminal approvals aligned with all three access modes", () => {
  assert.deepEqual(
    accessModes.map((mode) => ({
      mode,
      inside: needsTerminalApproval(mode, false),
      outside: needsTerminalApproval(mode, true),
    })),
    [
      { mode: "ask", inside: true, outside: true },
      { mode: "project", inside: false, outside: true },
      { mode: "full", inside: false, outside: false },
    ],
  );
});

test("keeps file approvals aligned with all three access modes", () => {
  assert.deepEqual(
    accessModes.map((mode) => ({
      mode,
      projectRead: needsFileApproval(mode, "read", false),
      projectWrite: needsFileApproval(mode, "write", false),
      outsideRead: needsFileApproval(mode, "read", true),
      outsideWrite: needsFileApproval(mode, "write", true),
    })),
    [
      {
        mode: "ask",
        projectRead: false,
        projectWrite: true,
        outsideRead: true,
        outsideWrite: true,
      },
      {
        mode: "project",
        projectRead: false,
        projectWrite: false,
        outsideRead: true,
        outsideWrite: true,
      },
      {
        mode: "full",
        projectRead: false,
        projectWrite: false,
        outsideRead: false,
        outsideWrite: false,
      },
    ],
  );
});
