import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { changeAgentDeployment } from "./deployments.js";

const agentDeploymentId = "33333333-3333-4333-8333-333333333333";

test("promotes an immutable deployment with an expected revision", async () => {
  const root = await createProject();
  const output: string[] = [];
  let receivedKey = "";

  await changeAgentDeployment({
    action: "promote",
    root,
    agentDeploymentId,
    environment: "production",
    expectedDeploymentRevision: 4,
    platformClient: {
      promoteAgentDeployment: async (
        _agent,
        environment,
        request,
        idempotencyKey,
      ) => {
        receivedKey = idempotencyKey;
        return {
          apiVersion: 1,
          environmentRevision: {
            environment,
            revision: 5,
            agentDeploymentId: request.agentDeploymentId,
            previousAgentDeploymentId: "44444444-4444-4444-8444-444444444444",
          },
        };
      },
      rollbackAgentDeployment: async () => {
        throw new Error("not used");
      },
    },
    io: { out: (message) => output.push(message), error: () => undefined },
  });

  assert.match(receivedKey, /^promote:agent_example1:production:/);
  assert.ok(output.includes("Environment: production revision 5"));
});

test("requires an expected revision for rollback", async () => {
  await assert.rejects(
    changeAgentDeployment({
      action: "rollback",
      root: await createProject(),
      agentDeploymentId,
      platformClient: {
        promoteAgentDeployment: async () => {
          throw new Error("not used");
        },
        rollbackAgentDeployment: async () => {
          throw new Error("not used");
        },
      },
      io: { out: () => undefined, error: () => undefined },
    }),
    /Rollback requires --expected-revision/,
  );
});

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "radius-cli-deployment-"));
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
