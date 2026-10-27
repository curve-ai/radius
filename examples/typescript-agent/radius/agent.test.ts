import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  acpStreamFromChild,
  connectAcpRuntime,
} from "@curve-ai/radius-runtime";

test("the ACP TypeScript example serves a real stdio session", async () => {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", fileURLToPath(new URL("agent.ts", import.meta.url))],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stderr.pipe(process.stderr);
  try {
    const runtime = await connectAcpRuntime(acpStreamFromChild(child), {
      cwd: process.cwd(),
      handlers: { onPermissionRequest: async () => ({ outcome: "cancelled" }) },
    });
    try {
      assert.equal(
        (await runtime.prompt("hello")).text,
        "Radius received: hello",
      );
    } finally {
      runtime.close();
    }
  } finally {
    child.kill();
  }
});
