import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { and, eq } from "drizzle-orm";

import {
  platformSchema,
  type PlatformDatabase,
} from "@curve-ai/platform-database";
import {
  DeviceRegistrationSchema,
  MAX_SYNC_BATCH_SIZE,
  PushRequestSchema,
  SYNC_PROTOCOL_VERSION,
} from "@curve-ai/radius-sync-protocol";

import { getArtifactStore } from "./artifact-store.js";
import { verifyDeviceRequest } from "./device-auth.js";
import {
  applySyncChange,
  pullSyncChanges,
  type SyncOwner,
} from "./service.js";

const { organizationMemberships, syncDevices, syncFileArtifacts } =
  platformSchema;

/**
 * The identity middleware has already proved who is calling and, where the
 * deployment routes organizations by host, narrowed them to the one this
 * request is for. Sync stores rows against a membership, so the account is
 * resolved to its membership in that organization here.
 */
export interface SyncIdentity {
  accountId: string;
  organizations: readonly { id: string; slug: string }[];
}

async function resolveSyncOwner(
  database: PlatformDatabase,
  identity: SyncIdentity,
): Promise<SyncOwner> {
  if (identity.organizations.length !== 1) {
    throw new Error("SYNC_ORGANIZATION_AMBIGUOUS");
  }
  const organizationId = identity.organizations[0]!.id;
  const [membership] = await database
    .select({ id: organizationMemberships.id })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.accountId, identity.accountId),
        eq(organizationMemberships.lifecycleState, "active"),
      ),
    )
    .limit(1);
  if (!membership) throw new Error("SYNC_MEMBERSHIP_NOT_FOUND");
  return { organizationId, membershipId: membership.id };
}

export function createSyncRoutes(database: PlatformDatabase) {
  const sync = new Hono<{ Variables: { identity: { accountId: string; response: SyncIdentity } } }>();

  const owner = async (context: {
    get: (key: "identity") => { accountId: string; response: SyncIdentity };
  }): Promise<SyncOwner> => {
    const identity = context.get("identity");
    return resolveSyncOwner(database, {
      accountId: identity.accountId,
      organizations: identity.response.organizations,
    });
  };

  sync.use(
    "/push",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (context) => context.json({ error: "PUSH_TOO_LARGE" }, 413),
    }),
  );

  sync.get("/capabilities", (context) =>
    context.json({
      protocolVersions: [SYNC_PROTOCOL_VERSION],
      maxBatchSize: MAX_SYNC_BATCH_SIZE,
      artifactTransfer: getArtifactStore() !== null,
    }),
  );

  sync.post("/devices/register", async (context) => {
    let scope: SyncOwner;
    try {
      scope = await owner(context);
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : "SYNC_FORBIDDEN" },
        403,
      );
    }

    const parsed = DeviceRegistrationSchema.safeParse(await context.req.json());
    if (!parsed.success) {
      return context.json(
        { error: "INVALID_DEVICE", issues: parsed.error.issues },
        422,
      );
    }
    const input = parsed.data;
    const [existing] = await database
      .select({
        membershipId: syncDevices.membershipId,
        publicKeyJwk: syncDevices.publicKeyJwk,
      })
      .from(syncDevices)
      .where(eq(syncDevices.id, input.clientInstanceId))
      .limit(1);
    if (
      existing &&
      (existing.membershipId !== scope.membershipId ||
        existing.publicKeyJwk?.kty !== input.publicKeyJwk.kty ||
        existing.publicKeyJwk?.crv !== input.publicKeyJwk.crv ||
        existing.publicKeyJwk?.x !== input.publicKeyJwk.x)
    ) {
      return context.json({ error: "DEVICE_IDENTITY_CONFLICT" }, 409);
    }

    const now = new Date();
    await database
      .insert(syncDevices)
      .values({
        id: input.clientInstanceId,
        ...scope,
        displayName: input.displayName,
        platform: input.platform,
        publicKeyJwk: input.publicKeyJwk,
        appVersion: input.appVersion,
        createdAt: now,
        lastSeenAt: now,
        revokedAt: null,
      })
      .onConflictDoUpdate({
        target: syncDevices.id,
        set: {
          displayName: input.displayName,
          platform: input.platform,
          publicKeyJwk: input.publicKeyJwk,
          appVersion: input.appVersion,
          lastSeenAt: now,
          revokedAt: null,
        },
      });
    return context.json({ deviceId: input.clientInstanceId, registered: true });
  });

  sync.post("/push", async (context) => {
    let scope: SyncOwner;
    try {
      scope = await owner(context);
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : "SYNC_FORBIDDEN" },
        403,
      );
    }
    const body = await context.req.text();

    let deviceId: string;
    try {
      deviceId = await verifyDeviceRequest(
        database,
        context.req.raw,
        scope.membershipId,
        body,
      );
    } catch (error) {
      return context.json(
        {
          error: error instanceof Error ? error.message : "DEVICE_AUTH_FAILED",
        },
        403,
      );
    }

    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      return context.json({ error: "INVALID_JSON" }, 400);
    }
    const parsed = PushRequestSchema.safeParse(input);
    if (!parsed.success) {
      return context.json(
        { error: "INVALID_PUSH", issues: parsed.error.issues },
        422,
      );
    }
    if (parsed.data.clientInstanceId !== deviceId) {
      return context.json({ error: "DEVICE_BODY_MISMATCH" }, 403);
    }

    const results = [];
    for (const change of parsed.data.changes) {
      results.push(await applySyncChange(database, scope, deviceId, change));
    }
    return context.json({ protocolVersion: SYNC_PROTOCOL_VERSION, results });
  });

  sync.use(
    "/artifacts/:contentSha256",
    bodyLimit({
      maxSize: 100 * 1024 * 1024,
      onError: (context) => context.json({ error: "ARTIFACT_TOO_LARGE" }, 413),
    }),
  );

  sync.on(
    ["HEAD", "GET", "PUT"],
    "/artifacts/:contentSha256",
    async (context) => {
      let scope: SyncOwner;
      try {
        scope = await owner(context);
      } catch (error) {
        return context.json(
          { error: error instanceof Error ? error.message : "SYNC_FORBIDDEN" },
          403,
        );
      }
      const store = getArtifactStore();
      if (!store) {
        return context.json({ error: "ARTIFACT_STORAGE_DISABLED" }, 404);
      }
      const contentSha256 = context.req.param("contentSha256");
      if (!/^[a-f0-9]{64}$/.test(contentSha256)) {
        return context.json({ error: "INVALID_ARTIFACT_HASH" }, 400);
      }

      const body: Uint8Array | null =
        context.req.method === "PUT"
          ? new Uint8Array(await context.req.arrayBuffer())
          : null;
      try {
        await verifyDeviceRequest(
          database,
          context.req.raw,
          scope.membershipId,
          body ?? "",
        );
      } catch (error) {
        return context.json(
          {
            error:
              error instanceof Error ? error.message : "DEVICE_AUTH_FAILED",
          },
          403,
        );
      }

      const [metadata] = await database
        .select()
        .from(syncFileArtifacts)
        .where(
          and(
            eq(syncFileArtifacts.membershipId, scope.membershipId),
            eq(syncFileArtifacts.contentSha256, contentSha256),
          ),
        )
        .limit(1);
      if (!metadata) return context.json({ error: "ARTIFACT_NOT_FOUND" }, 404);

      if (context.req.method === "HEAD") {
        return (await store.has(contentSha256))
          ? new Response(null, { status: 200 })
          : new Response(null, { status: 404 });
      }
      if (context.req.method === "GET") {
        if (!(await store.has(contentSha256))) {
          return context.json({ error: "ARTIFACT_NOT_AVAILABLE" }, 404);
        }
        const bytes = await store.get(contentSha256);
        const responseBody = new Uint8Array(bytes).buffer;
        return new Response(responseBody, {
          headers: {
            "content-type": String(
              metadata.mimeType || "application/octet-stream",
            ),
            "content-length": String(bytes.byteLength),
          },
        });
      }

      if (!body || Number(metadata.byteSize) !== body.byteLength) {
        return context.json({ error: "ARTIFACT_SIZE_MISMATCH" }, 422);
      }
      try {
        const remoteLocator = await store.put(contentSha256, body);
        await database
          .update(syncFileArtifacts)
          .set({ availability: "available", remoteLocator })
          .where(
            and(
              eq(syncFileArtifacts.membershipId, scope.membershipId),
              eq(syncFileArtifacts.contentSha256, contentSha256),
            ),
          );
        return context.json({ remoteLocator });
      } catch (error) {
        return context.json(
          {
            error:
              error instanceof Error ? error.message : "ARTIFACT_UPLOAD_FAILED",
          },
          422,
        );
      }
    },
  );

  sync.get("/pull", async (context) => {
    let scope: SyncOwner;
    try {
      scope = await owner(context);
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : "SYNC_FORBIDDEN" },
        403,
      );
    }
    try {
      await verifyDeviceRequest(
        database,
        context.req.raw,
        scope.membershipId,
        "",
      );
    } catch (error) {
      return context.json(
        {
          error: error instanceof Error ? error.message : "DEVICE_AUTH_FAILED",
        },
        403,
      );
    }

    const requestedLimit = Number.parseInt(
      context.req.query("limit") || "100",
      10,
    );
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_SYNC_BATCH_SIZE)
      : MAX_SYNC_BATCH_SIZE;
    try {
      const result = await pullSyncChanges(
        database,
        scope,
        context.req.query("cursor") || null,
        limit,
      );
      return context.json({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        ...result,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_CURSOR") {
        return context.json({ error: "INVALID_CURSOR" }, 400);
      }
      throw error;
    }
  });

  sync.delete("/devices/:deviceId", async (context) => {
    let scope: SyncOwner;
    try {
      scope = await owner(context);
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : "SYNC_FORBIDDEN" },
        403,
      );
    }
    try {
      await verifyDeviceRequest(
        database,
        context.req.raw,
        scope.membershipId,
        "",
      );
    } catch (error) {
      return context.json(
        {
          error: error instanceof Error ? error.message : "DEVICE_AUTH_FAILED",
        },
        403,
      );
    }

    const result = await database
      .update(syncDevices)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(syncDevices.id, context.req.param("deviceId")),
          eq(syncDevices.membershipId, scope.membershipId),
        ),
      )
      .returning({ id: syncDevices.id });
    return result.length === 1
      ? context.json({ revoked: true })
      : context.json({ error: "DEVICE_NOT_FOUND" }, 404);
  });

  return sync;
}
