import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { and, count, desc, eq, isNull, max } from "drizzle-orm";

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
import { withSyncOwner } from "./owner.js";
import {
  applySyncChange,
  pullSyncChanges,
  type SyncOwner,
} from "./service.js";

const {
  organizationMemberships,
  syncChanges,
  syncDevices,
  syncFileArtifacts,
  syncProjects,
  syncSessions,
} = platformSchema;

function isForeignDevice(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "23505" || code === "42501";
}

function deviceSummary(device: {
  id: string;
  displayName: string;
  platform: string;
  appVersion: string;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}) {
  return {
    id: device.id,
    displayName: device.displayName,
    platform: device.platform,
    appVersion: device.appVersion,
    createdAt: device.createdAt.toISOString(),
    lastSeenAt: device.lastSeenAt.toISOString(),
    revokedAt: device.revokedAt?.toISOString() ?? null,
  };
}

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

  // What the dashboard shows: the caller's devices and how much they have
  // synced. Read-only and scoped to the caller's own membership, so a browser
  // session is enough; no device signature is involved.
  sync.get("/overview", async (context) => {
    let scope: SyncOwner;
    try {
      scope = await owner(context);
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : "SYNC_FORBIDDEN" },
        403,
      );
    }
    const identity = context.get("identity");
    const byMembership = eq(syncDevices.membershipId, scope.membershipId);
    const [devices, [projects], [sessions], [changes]] = await withSyncOwner(
      database,
      scope,
      (transaction) =>
        Promise.all([
      transaction
        .select({
          id: syncDevices.id,
          displayName: syncDevices.displayName,
          platform: syncDevices.platform,
          appVersion: syncDevices.appVersion,
          createdAt: syncDevices.createdAt,
          lastSeenAt: syncDevices.lastSeenAt,
          revokedAt: syncDevices.revokedAt,
        })
        .from(syncDevices)
        .where(byMembership)
        .orderBy(desc(syncDevices.lastSeenAt)),
      transaction
        .select({ total: count() })
        .from(syncProjects)
        .where(
          and(
            eq(syncProjects.membershipId, scope.membershipId),
            isNull(syncProjects.deletedAt),
          ),
        ),
      transaction
        .select({ total: count() })
        .from(syncSessions)
        .where(
          and(
            eq(syncSessions.membershipId, scope.membershipId),
            isNull(syncSessions.deletedAt),
          ),
        ),
      transaction
        .select({ total: count(), latest: max(syncChanges.acceptedAt) })
        .from(syncChanges)
        .where(eq(syncChanges.membershipId, scope.membershipId)),
        ]),
    );
    return context.json({
      apiVersion: 1,
      organization: identity.response.organizations[0]!.slug,
      artifactTransfer: getArtifactStore() !== null,
      devices: devices.map(deviceSummary),
      projects: projects?.total ?? 0,
      sessions: sessions?.total ?? 0,
      changes: changes?.total ?? 0,
      latestChangeAt: changes?.latest ? changes.latest.toISOString() : null,
    });
  });

  // Revocation from the dashboard. DELETE /devices/:id below is the
  // device-signed form used by the desktop; this one is for the person who
  // lost the laptop and only has a browser. Same rule: revocation is final.
  sync.post("/devices/:deviceId/revoke", async (context) => {
    let scope: SyncOwner;
    try {
      scope = await owner(context);
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : "SYNC_FORBIDDEN" },
        403,
      );
    }
    const [device] = await withSyncOwner(database, scope, (transaction) =>
      transaction
      .update(syncDevices)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(syncDevices.id, context.req.param("deviceId")),
          eq(syncDevices.membershipId, scope.membershipId),
          isNull(syncDevices.revokedAt),
        ),
      )
      .returning({
        id: syncDevices.id,
        displayName: syncDevices.displayName,
        platform: syncDevices.platform,
        appVersion: syncDevices.appVersion,
        createdAt: syncDevices.createdAt,
        lastSeenAt: syncDevices.lastSeenAt,
        revokedAt: syncDevices.revokedAt,
      }),
    );
    if (!device) return context.json({ error: "DEVICE_NOT_FOUND" }, 404);
    return context.json({ apiVersion: 1, device: deviceSummary(device) });
  });

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
    return withSyncOwner(database, scope, async (transaction) => {
    const [existing] = await transaction
      .select({
        membershipId: syncDevices.membershipId,
        publicKeyJwk: syncDevices.publicKeyJwk,
        revokedAt: syncDevices.revokedAt,
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
    // Revocation is final. Re-registering was the way to undo it: the lost
    // laptop that was revoked from another device still holds a session token,
    // and registering itself again would have cleared revoked_at.
    if (existing?.revokedAt) {
      return context.json({ error: "DEVICE_REVOKED" }, 409);
    }

    const now = new Date();
    let registered: { id: string }[];
    try {
      registered = await transaction
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
        },
        setWhere: isNull(syncDevices.revokedAt),
      })
      .returning({ id: syncDevices.id });
    } catch (error) {
      // The id belongs to a device the policy hides: someone else's. Under
      // row security that is a unique violation or a policy rejection rather
      // than a visible row, and it means the same thing as before.
      if (isForeignDevice(error)) {
        return context.json({ error: "DEVICE_IDENTITY_CONFLICT" }, 409);
      }
      throw error;
    }
    if (registered.length === 0) {
      return context.json({ error: "DEVICE_REVOKED" }, 409);
    }
    return context.json({ deviceId: input.clientInstanceId, registered: true });
    });
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
      deviceId = await withSyncOwner(database, scope, (transaction) =>
        verifyDeviceRequest(
          transaction,
          context.req.raw,
          scope.membershipId,
          body,
        ),
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

    // A client fault comes back as a per-change verdict rather than a failed
    // request; only the server's own faults reach here, and those must fail
    // loudly so the client retries. The batch is answered one result per
    // change because that is what the client checks for.
    const results = [];
    try {
      for (const change of parsed.data.changes) {
        results.push(await applySyncChange(database, scope, deviceId, change));
      }
    } catch (error) {
      console.error("Radius sync push failed", error);
      return context.json({ error: "SYNC_PUSH_FAILED" }, 503);
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
        await withSyncOwner(database, scope, (transaction) =>
          verifyDeviceRequest(
            transaction,
            context.req.raw,
            scope.membershipId,
            body ?? "",
          ),
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

      const [metadata] = await withSyncOwner(database, scope, (transaction) =>
        transaction
          .select()
          .from(syncFileArtifacts)
          .where(
            and(
              eq(syncFileArtifacts.membershipId, scope.membershipId),
              eq(syncFileArtifacts.contentSha256, contentSha256),
            ),
          )
          .limit(1),
      );
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
        await withSyncOwner(database, scope, (transaction) =>
          transaction
            .update(syncFileArtifacts)
            .set({ availability: "available", remoteLocator })
            .where(
              and(
                eq(syncFileArtifacts.membershipId, scope.membershipId),
                eq(syncFileArtifacts.contentSha256, contentSha256),
              ),
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
      await withSyncOwner(database, scope, (transaction) =>
        verifyDeviceRequest(transaction, context.req.raw, scope.membershipId, ""),
      );
    } catch (error) {
      return context.json(
        {
          error: error instanceof Error ? error.message : "DEVICE_AUTH_FAILED",
        },
        403,
      );
    }

    const DEFAULT_PULL_LIMIT = 100;
    const requestedLimit = Number.parseInt(
      context.req.query("limit") || String(DEFAULT_PULL_LIMIT),
      10,
    );
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_SYNC_BATCH_SIZE)
      : DEFAULT_PULL_LIMIT;
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
      await withSyncOwner(database, scope, (transaction) =>
        verifyDeviceRequest(transaction, context.req.raw, scope.membershipId, ""),
      );
    } catch (error) {
      return context.json(
        {
          error: error instanceof Error ? error.message : "DEVICE_AUTH_FAILED",
        },
        403,
      );
    }

    const result = await withSyncOwner(database, scope, (transaction) =>
      transaction
        .update(syncDevices)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(syncDevices.id, context.req.param("deviceId")),
            eq(syncDevices.membershipId, scope.membershipId),
          ),
        )
        .returning({ id: syncDevices.id }),
    );
    return result.length === 1
      ? context.json({ revoked: true })
      : context.json({ error: "DEVICE_NOT_FOUND" }, 404);
  });

  return sync;
}
