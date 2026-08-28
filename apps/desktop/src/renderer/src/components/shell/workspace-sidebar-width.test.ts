import assert from "node:assert/strict";
import test from "node:test";

import {
  clampWorkspaceSidebarWidth,
  getWorkspaceSidebarMaxWidth,
  WORKSPACE_SIDEBAR_MAX_WIDTH,
  WORKSPACE_SIDEBAR_MIN_WIDTH,
} from "./workspace-sidebar-width";

test("caps the sidebar while preserving the minimum workspace width", () => {
  assert.equal(getWorkspaceSidebarMaxWidth(480), 256);
  assert.equal(getWorkspaceSidebarMaxWidth(704), WORKSPACE_SIDEBAR_MAX_WIDTH);
  assert.equal(getWorkspaceSidebarMaxWidth(400), WORKSPACE_SIDEBAR_MIN_WIDTH);
});

test("clamps sidebar resizing to the active window-dependent maximum", () => {
  assert.equal(clampWorkspaceSidebarWidth(480, 256), 256);
  assert.equal(
    clampWorkspaceSidebarWidth(100, 256),
    WORKSPACE_SIDEBAR_MIN_WIDTH,
  );
  assert.equal(clampWorkspaceSidebarWidth(240, 256), 240);
});
