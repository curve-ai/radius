import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDevelopmentAgent } from "./dev.js";

test("registers a live ACP endpoint for the ready Radius app and cleans it up", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-dev-agent-"));
  const userDataPath = join(root, "radius-user-data");
  await writeFile(
    join(root, "radius.config.json"),
    JSON.stringify({
      schemaVersion: 1,
      agent: "agent_example1",
      name: "Live agent",
      runtime: { kind: "command", command: ["unused-in-dev"] },
      development: { endpoint: "ws://127.0.0.1:7331/acp" },
      capabilities: [{ key: "shell", operations: ["execute"] }],
    }),
  );
  let launched = false;
  const registrationPath = join(
    userDataPath,
    "development",
    "agents",
    "agent_example1.json",
  );

  await runDevelopmentAgent({
    root,
    userDataPath,
    io: { out: () => undefined, error: () => undefined },
    launchDesktop: async () => {
      launched = true;
    },
    waitForExit: async () => {
      const registration = JSON.parse(
        await readFile(registrationPath, "utf8"),
      ) as Record<string, unknown>;
      assert.equal(registration.endpoint, "ws://127.0.0.1:7331/acp");
      assert.deepEqual(registration.capabilities, ["shell.execute"]);
      assert.equal(registration.authorization, null);
    },
  });

  assert.equal(launched, true);
  await assert.rejects(readFile(registrationPath, "utf8"), /ENOENT/);
});

test("rejects non-loopback development endpoints", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-dev-remote-"));
  await writeFile(
    join(root, "radius.config.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "Remote agent",
      runtime: { kind: "command", command: ["unused-in-dev"] },
      development: { endpoint: "wss://agents.example.com/acp" },
    }),
  );
  await assert.rejects(
    runDevelopmentAgent({
      root,
      userDataPath: join(root, "user-data"),
      io: { out: () => undefined, error: () => undefined },
      launchDesktop: async () => undefined,
      waitForExit: async () => undefined,
    }),
  );
});
