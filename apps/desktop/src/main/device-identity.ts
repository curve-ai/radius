import { generateKeyPairSync, randomUUID, type JsonWebKey } from "node:crypto";

import type { CredentialVault } from "./credential-vault";

/**
 * The key a sync device signs with. It starts life as the vault's own device
 * key so existing installations keep their enrolment, and diverges only after
 * a revocation forces a new one. It is deliberately not the vault identity
 * itself: revocation is final on the server, so recovering from it means
 * abandoning an id, and the vault id is used for local bookkeeping that must
 * outlive any one server.
 */
const SYNC_DEVICE_SECRET = "radius.sync.device-identity";

export interface SyncDeviceIdentity {
  clientInstanceId: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}

export function localDeviceIdentity(vault: CredentialVault): {
  clientInstanceId: string;
  displayName: string;
  platform: NodeJS.Platform;
  publicKeyJwk: CredentialVault["publicKeyJwk"];
} {
  return {
    clientInstanceId: vault.clientInstanceId,
    displayName: deviceDisplayName(),
    platform: process.platform,
    publicKeyJwk: vault.publicKeyJwk,
  };
}

export function deviceDisplayName(): string {
  return process.platform === "darwin" ? "This Mac" : "This device";
}

export function generateSyncDeviceIdentity(): SyncDeviceIdentity {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    clientInstanceId: randomUUID(),
    publicKeyJwk: publicKey.export({ format: "jwk" }),
    privateKeyJwk: privateKey.export({ format: "jwk" }),
  };
}

function parseStoredIdentity(value: string): SyncDeviceIdentity | null {
  try {
    const parsed = JSON.parse(value) as Partial<SyncDeviceIdentity>;
    return typeof parsed.clientInstanceId === "string" &&
      parsed.publicKeyJwk &&
      parsed.privateKeyJwk
      ? {
          clientInstanceId: parsed.clientInstanceId,
          publicKeyJwk: parsed.publicKeyJwk,
          privateKeyJwk: parsed.privateKeyJwk,
        }
      : null;
  } catch {
    return null;
  }
}

export async function loadSyncDeviceIdentity(
  vault: CredentialVault,
): Promise<SyncDeviceIdentity> {
  const stored = await vault.getSecret(SYNC_DEVICE_SECRET);
  const parsed = stored ? parseStoredIdentity(stored) : null;
  if (parsed) return parsed;

  const seeded: SyncDeviceIdentity = {
    clientInstanceId: vault.clientInstanceId,
    publicKeyJwk: vault.publicKeyJwk,
    privateKeyJwk: vault.privateKeyJwk,
  };
  await vault.setSecret(SYNC_DEVICE_SECRET, JSON.stringify(seeded));
  return seeded;
}

/**
 * Called when the server reports this device was revoked. A revoked id can
 * never register again, so the only way back is a new key and a new id.
 */
export async function rotateSyncDeviceIdentity(
  vault: CredentialVault,
): Promise<SyncDeviceIdentity> {
  const identity = generateSyncDeviceIdentity();
  await vault.setSecret(SYNC_DEVICE_SECRET, JSON.stringify(identity));
  return identity;
}
