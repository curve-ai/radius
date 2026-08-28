import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  connectAgentAuthenticationAccount,
  disconnectAgentAuthentication,
  getAgentAuthenticationSummary,
  installAgentRelease,
  type InstallAgentReleaseInput,
} from "./agent-auth-store.js";
import { migrateRadiusDatabase, openRadiusDatabase } from "./database.js";
import { clientInstances } from "./schema.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const clientId = "19353755-3c5e-4529-b58d-c74dacf7b68d";
const now = Date.parse("2026-08-24T20:00:00.000Z");

async function removeTemporaryDirectory(directory: string): Promise<void> {
  try {
    await rm(directory, { force: true, recursive: true });
  } catch (error) {
    if (
      process.platform === "win32" &&
      (error as NodeJS.ErrnoException).code === "EBUSY"
    ) {
      return;
    }
    throw error;
  }
}

const releaseInput: InstallAgentReleaseInput = {
  clientInstanceId: clientId,
  providerKey: "vercel-labs",
  agentKey: "fx",
  displayName: "fx",
  releaseVersion: "0.0.5",
  imageDigest: `sha256:${"a".repeat(64)}`,
  manifestSha256: "b".repeat(64),
  protocolKind: "acp-stdio",
  protocolVersion: 1,
  now,
  authRequirements: [
    {
      key: "codex-subscription",
      authority: {
        key: "openai-codex",
        purpose: "model_provider",
        issuer: "https://auth.openai.com",
        displayName: "Codex",
      },
      flow: {
        key: "subscription-oauth",
        kind: "provider_native_oauth",
        publicClientId: null,
        audience: "https://chatgpt.com/backend-api/codex",
        deviceBindingSupported: false,
      },
      requirement: "required",
      portability: "device_only",
      runtimeDelivery: "agent_state_adapter",
      custodyKinds: ["encrypted_agent_state"],
      scopes: [],
    },
  ],
};

async function withDatabase(
  callback: (
    database: Awaited<ReturnType<typeof openRadiusDatabase>>,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-agent-auth-"));
  const database = await openRadiusDatabase({
    path: path.join(directory, "radius.db"),
  });
  try {
    await migrateRadiusDatabase(database, migrationsFolder);
    await database.db.insert(clientInstances).values({
      id: clientId,
      displayName: "Test Mac",
      platform: "darwin",
      publicKeyJwk: JSON.stringify({ kty: "OKP", crv: "Ed25519", x: "test" }),
      isLocal: true,
      createdAtMs: now,
      updatedAtMs: now,
    });
    await callback(database);
  } finally {
    database.close();
    await removeTemporaryDirectory(directory);
  }
}

test("installs an immutable release and derives required authentication", async () => {
  await withDatabase(async (database) => {
    const installed = await installAgentRelease(database, releaseInput);
    const initial = await getAgentAuthenticationSummary(
      database,
      installed.installationId,
    );
    assert.equal(initial.ready, false);
    assert.deepEqual(
      initial.requirements.map((requirement) => ({
        key: requirement.requirementKey,
        state: requirement.state,
      })),
      [{ key: "codex-subscription", state: "needs_authentication" }],
    );

    const connected = await connectAgentAuthenticationAccount(database, {
      installationId: installed.installationId,
      requirementKey: "codex-subscription",
      custodyKind: "encrypted_agent_state",
      credentialRef: "vault:agent:fx:openai-codex",
      remoteSubject: "account-123",
      accountLabel: "Codex subscription",
      expiresAt: "2026-08-25T20:00:00.000Z",
      now: now + 1_000,
    });
    assert.equal(connected.ready, true);
    assert.equal(connected.requirements[0]?.state, "connected");
    assert.equal(connected.requirements[0]?.remoteSubject, "account-123");

    const disconnected = await disconnectAgentAuthentication(
      database,
      installed.installationId,
      "codex-subscription",
      now + 2_000,
    );
    assert.deepEqual(disconnected, {
      credentialRef: "vault:agent:fx:openai-codex",
      credentialUnused: true,
    });
    assert.equal(
      (await getAgentAuthenticationSummary(database, installed.installationId))
        .ready,
      false,
    );
  });
});

test("rejects release metadata changes for the same version", async () => {
  await withDatabase(async (database) => {
    await installAgentRelease(database, releaseInput);
    await assert.rejects(
      installAgentRelease(database, {
        ...releaseInput,
        imageDigest: `sha256:${"c".repeat(64)}`,
      }),
      /Image digest changed for immutable release/,
    );
  });
});
