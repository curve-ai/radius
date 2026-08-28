import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  showAgentDeployments,
  showAgentEnvironmentHistory,
} from "./inventory.js";

const agentDeploymentId = "33333333-3333-4333-8333-333333333333";
const digest = `sha256:${"a".repeat(64)}`;

test("prints deployment inventory with its opaque next cursor", async () => {
  const output: string[] = [];
  await showAgentDeployments({
    root: await createProject(),
    limit: 1,
    platformClient: fakeClient(),
    io: { out: (message) => output.push(message), error: () => undefined },
  });

  assert.match(output[0] ?? "", /20260825\.1/);
  assert.equal(output[1], "Next cursor: next-agentDeployment");
});

test("prints append-only deployment revisions newest first", async () => {
  const output: string[] = [];
  await showAgentEnvironmentHistory({
    root: await createProject(),
    environment: "staging",
    platformClient: fakeClient(),
    io: { out: (message) => output.push(message), error: () => undefined },
  });

  assert.equal(output[0], "agent_example1 staging: current revision 2");
  assert.match(output[1] ?? "", /^r2\trollback\t20260825\.1/);
});

function fakeClient() {
  return {
    listAgentDeployments: async () => ({
      apiVersion: 1 as const,
      agent: "agent_example1",
      agentDeployments: [
        {
          id: agentDeploymentId,
          version: "20260825.1",
          imageDigest: digest,
          sourceManifestDigest: digest,
          sbomDigest: null,
          provenanceDigest: null,
          minimumDesktopVersion: "0.0.1",
          runtimeProtocolVersion: 1,
          state: "verified" as const,
          createdAt: "2026-08-25T20:00:00.000Z",
        },
      ],
      nextCursor: "next-agentDeployment",
    }),
    listAgentEnvironmentHistory: async () => ({
      apiVersion: 1 as const,
      agent: "agent_example1",
      environment: "staging",
      currentRevision: 2,
      revisions: [
        {
          revision: 2,
          action: "rollback" as const,
          agentDeploymentId,
          agentDeploymentVersion: "20260825.1",
          imageDigest: digest,
          previousAgentDeploymentId: "44444444-4444-4444-8444-444444444444",
          createdAt: "2026-08-25T20:01:00.000Z",
        },
      ],
      nextCursor: null,
    }),
  };
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "radius-cli-inventory-"));
  await writeFile(
    join(root, "radius.config.ts"),
    `export default {
      schemaVersion: 1,
      agent: "agent_example1",
      name: "Example",
      runtime: { kind: "typescript", entrypoint: "radius/agent.ts", node: "22" },
      capabilities: [],
      networkAllowlist: [],
      resources: { cpu: 2, memoryMb: 4096, diskMb: 5120 }
    };\n`,
  );
  return root;
}
