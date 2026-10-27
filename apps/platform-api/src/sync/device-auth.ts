import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type JsonWebKey as NodeJsonWebKey,
} from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import {
  platformSchema,
  type PlatformDatabase,
} from "@curve-ai/platform-database";

const { syncDevices } = platformSchema;

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * The signature covers the path and query as received. A reverse proxy that
 * rewrites either one invalidates every request, so sync must be routed with
 * the path preserved.
 */
function signatureInput(
  request: Request,
  timestamp: string,
  body: string | Uint8Array,
): string {
  const url = new URL(request.url);
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return `${request.method}\n${url.pathname}${url.search}\n${timestamp}\n${bodyHash}`;
}

/**
 * Confirms the request was signed by a device enrolled to this membership.
 *
 * The bearer identity already proved who is calling. This proves which of
 * their devices, so a stolen token cannot push on behalf of a device whose
 * private key it does not hold.
 */
export async function verifyDeviceRequest(
  database: PlatformDatabase,
  request: Request,
  membershipId: string,
  body: string | Uint8Array,
): Promise<string> {
  const deviceId = request.headers.get("x-radius-client-instance-id");
  const timestamp = request.headers.get("x-radius-timestamp");
  const encodedSignature = request.headers.get("x-radius-signature");
  if (!deviceId || !timestamp || !encodedSignature) {
    throw new Error("DEVICE_SIGNATURE_REQUIRED");
  }

  const timestampMs = Date.parse(timestamp);
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS
  ) {
    throw new Error("DEVICE_TIMESTAMP_INVALID");
  }

  const [device] = await database
    .select({ publicKeyJwk: syncDevices.publicKeyJwk })
    .from(syncDevices)
    .where(
      and(
        eq(syncDevices.id, deviceId),
        eq(syncDevices.membershipId, membershipId),
        isNull(syncDevices.revokedAt),
      ),
    )
    .limit(1);
  if (!device) throw new Error("DEVICE_NOT_REGISTERED");

  const publicKey = createPublicKey({
    key: device.publicKeyJwk as NodeJsonWebKey,
    format: "jwk",
  });
  const valid = verifySignature(
    null,
    Buffer.from(signatureInput(request, timestamp, body)),
    publicKey,
    Buffer.from(encodedSignature, "base64url"),
  );
  if (!valid) throw new Error("DEVICE_SIGNATURE_INVALID");
  return deviceId;
}
