import assert from "node:assert/strict";
import test from "node:test";

import { createAgentRunStartup } from "./agent-run-startup";

test("resolves prompt acceptance exactly once", async () => {
  const startup = createAgentRunStartup();
  startup.resolve();
  startup.reject(new Error("late rejection"));
  await startup.promise;
});

test("rejects prompt acceptance exactly once", async () => {
  const startup = createAgentRunStartup();
  const rejection = new Error("capability rejected");
  startup.reject(rejection);
  startup.resolve();
  await assert.rejects(startup.promise, rejection);
});
