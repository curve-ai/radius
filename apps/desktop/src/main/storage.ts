import {
  ensureClientInstance,
  migrateRadiusDatabase,
  openRadiusDatabase,
  type RadiusDatabase,
} from "@curve-ai/radius-storage";
import { app } from "electron";
import path from "node:path";

import { openCredentialVault } from "./credential-vault";
import type { CredentialVault } from "./credential-vault";
import { localDeviceIdentity } from "./device-identity";

export interface StorageContext {
  database: RadiusDatabase;
  vault: CredentialVault;
}

let storageContext: StorageContext | null = null;

function resolveMigrationsFolder(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "storage-migrations")
    : path.resolve(app.getAppPath(), "../../packages/storage/drizzle");
}

export async function initializeStorage(): Promise<StorageContext> {
  if (storageContext) return storageContext;

  const userDataPath = app.getPath("userData");
  const databasePath = path.join(userDataPath, "radius.db");
  const vault = await openCredentialVault(userDataPath, databasePath);
  const database = await openRadiusDatabase({
    path: databasePath,
    encryptionKey: vault.databaseKey,
  });

  try {
    await migrateRadiusDatabase(database, resolveMigrationsFolder());
    const identity = localDeviceIdentity(vault);
    await ensureClientInstance(database, {
      id: identity.clientInstanceId,
      displayName: identity.displayName,
      platform: identity.platform,
      publicKeyJwk: JSON.stringify(identity.publicKeyJwk),
    });
  } catch (error) {
    database.close();
    throw error;
  }

  storageContext = { database, vault };
  return storageContext;
}

export function closeStorage(): void {
  storageContext?.database.close();
  storageContext = null;
}
