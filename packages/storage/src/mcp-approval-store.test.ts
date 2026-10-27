import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  grantMcpServerApproval,
  grantMcpToolApproval,
  hasMcpApproval,
  hasMcpServerApproval,
  hasMcpToolApproval,
  listMcpApprovalGrants,
  revokeMcpApproval,
} from "./mcp-approval-store.js";
import {
  installCustomConnector,
  listReadyMcpProviders,
  saveConnectorDiscovery,
} from "./connector-store.js";
import { migrateRadiusDatabase, openRadiusDatabase } from "./database.js";
import { clientInstances } from "./schema.js";

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

test("persists and independently revokes MCP tool and server approvals", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "radius-mcp-grants-"));
  const database = await openRadiusDatabase({
    path: path.join(directory, "radius.db"),
  });
  const now = 1_800_000_000_000;
  try {
    await migrateRadiusDatabase(
      database,
      fileURLToPath(new URL("../drizzle", import.meta.url)),
    );
    await database.db.insert(clientInstances).values({
      id: "client-mcp-approvals",
      displayName: "Approval test Mac",
      platform: "darwin",
      publicKeyJwk: "{}",
      isLocal: true,
      createdAtMs: now,
      updatedAtMs: now,
    });
    const installed = await installCustomConnector(database, {
      clientInstanceId: "client-mcp-approvals",
      displayName: "Test tools",
      endpointUrl: "https://tools.example.com/mcp",
      now,
    });
    const providerId = await saveConnectorDiscovery(database, {
      clientInstanceId: "client-mcp-approvals",
      installationId: installed.id,
      credentialRef: null,
      tools: [
        {
          name: "list_items",
          title: "List items",
          description: "List items from the test service.",
          inputSchemaSha256: "a".repeat(64),
          outputSchemaSha256: null,
        },
      ],
      now,
    });
    const providers = await listReadyMcpProviders(
      database,
      "client-mcp-approvals",
    );
    const bindingId = providers[0]?.bindings[0]?.bindingId;
    assert.ok(bindingId);

    const toolGrantId = await grantMcpToolApproval(
      database,
      bindingId,
      now + 1,
    );
    const serverGrantId = await grantMcpServerApproval(
      database,
      providerId,
      now + 2,
    );

    assert.equal(await hasMcpToolApproval(database, bindingId), true);
    assert.equal(await hasMcpServerApproval(database, providerId), true);
    assert.equal(
      await hasMcpApproval(database, {
        providerId,
        bindingId,
      }),
      true,
    );
    assert.deepEqual(
      await listMcpApprovalGrants(database, "client-mcp-approvals"),
      [
        {
          grantId: serverGrantId,
          scope: "server",
          providerId,
          providerLabel: "Test tools",
          toolName: null,
          grantedAt: new Date(now + 2).toISOString(),
        },
        {
          grantId: toolGrantId,
          scope: "tool",
          providerId,
          providerLabel: "Test tools",
          toolName: "list_items",
          grantedAt: new Date(now + 1).toISOString(),
        },
      ],
    );

    await revokeMcpApproval(database, {
      grantId: serverGrantId,
      scope: "server",
      now: now + 3,
    });
    await revokeMcpApproval(database, {
      grantId: toolGrantId,
      scope: "tool",
      now: now + 4,
    });
    assert.equal(await hasMcpServerApproval(database, providerId), false);
    assert.equal(await hasMcpToolApproval(database, bindingId), false);
    assert.deepEqual(
      await listMcpApprovalGrants(database, "client-mcp-approvals"),
      [],
    );

    assert.notEqual(
      await grantMcpServerApproval(database, providerId, now + 5),
      serverGrantId,
    );
  } finally {
    database.close();
    await removeTemporaryDirectory(directory);
  }
});
