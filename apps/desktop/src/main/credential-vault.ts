import { safeStorage } from "electron";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  type JsonWebKey,
} from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

interface StoredCredentialVault {
  version: 1;
  clientInstanceId: string;
  publicKeyJwk: JsonWebKey;
  encryptedDatabaseKey: string;
  encryptedPrivateKeyJwk: string;
}

export interface CredentialVault {
  clientInstanceId: string;
  publicKeyJwk: JsonWebKey;
  databaseKey: string;
  privateKeyJwk: JsonWebKey;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readUtf8IfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function decryptJsonWebKey(value: string): JsonWebKey {
  return JSON.parse(
    safeStorage.decryptString(Buffer.from(value, "base64")),
  ) as JsonWebKey;
}

export async function openCredentialVault(
  userDataPath: string,
  databasePath: string,
): Promise<CredentialVault> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Operating-system credential encryption is unavailable");
  }

  await mkdir(userDataPath, { recursive: true });
  const vaultPath = path.join(userDataPath, "credential-vault.json");
  const storedVault = await readUtf8IfExists(vaultPath);
  if (storedVault !== null) {
    const stored = JSON.parse(storedVault) as StoredCredentialVault;
    if (stored.version !== 1)
      throw new Error("Unsupported credential-vault version");
    return {
      clientInstanceId: stored.clientInstanceId,
      publicKeyJwk: stored.publicKeyJwk,
      databaseKey: safeStorage.decryptString(
        Buffer.from(stored.encryptedDatabaseKey, "base64"),
      ),
      privateKeyJwk: decryptJsonWebKey(stored.encryptedPrivateKeyJwk),
    };
  }

  if (await fileExists(databasePath)) {
    throw new Error(
      "Radius database exists but its credential vault is missing",
    );
  }

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyJwk = privateKey.export({ format: "jwk" });
  const publicKeyJwk = publicKey.export({ format: "jwk" });
  const databaseKey = randomBytes(32).toString("hex");
  const stored: StoredCredentialVault = {
    version: 1,
    clientInstanceId: randomUUID(),
    publicKeyJwk,
    encryptedDatabaseKey: safeStorage
      .encryptString(databaseKey)
      .toString("base64"),
    encryptedPrivateKeyJwk: safeStorage
      .encryptString(JSON.stringify(privateKeyJwk))
      .toString("base64"),
  };

  const temporaryPath = `${vaultPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, vaultPath);

  return {
    clientInstanceId: stored.clientInstanceId,
    publicKeyJwk,
    databaseKey,
    privateKeyJwk,
  };
}
