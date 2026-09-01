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
  encryptedSecrets: Record<string, string>;
}

export interface CredentialVault {
  clientInstanceId: string;
  publicKeyJwk: JsonWebKey;
  databaseKey: string;
  privateKeyJwk: JsonWebKey;
  getSecret(reference: string): Promise<string | null>;
  setSecret(reference: string, value: string): Promise<void>;
  deleteSecret(reference: string): Promise<boolean>;
}

const secretReferencePattern = /^[a-z0-9][a-z0-9._:-]{0,199}$/;

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

function validateSecretReference(reference: string): void {
  if (!secretReferencePattern.test(reference)) {
    throw new Error("Invalid credential secret reference");
  }
}

async function writeStoredVault(
  vaultPath: string,
  stored: StoredCredentialVault,
): Promise<void> {
  const temporaryPath = `${vaultPath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, vaultPath);
}

function credentialVaultFromStored(
  stored: StoredCredentialVault,
  vaultPath: string,
): CredentialVault {
  let secrets = { ...stored.encryptedSecrets };
  let mutationTail: Promise<void> = Promise.resolve();
  const mutate = (operation: () => Promise<void>): Promise<void> => {
    const pending = mutationTail.then(operation);
    mutationTail = pending.catch(() => undefined);
    return pending;
  };
  return {
    clientInstanceId: stored.clientInstanceId,
    publicKeyJwk: stored.publicKeyJwk,
    databaseKey: safeStorage.decryptString(
      Buffer.from(stored.encryptedDatabaseKey, "base64"),
    ),
    privateKeyJwk: decryptJsonWebKey(stored.encryptedPrivateKeyJwk),
    async getSecret(reference) {
      validateSecretReference(reference);
      await mutationTail;
      const encrypted = secrets[reference];
      return encrypted
        ? safeStorage.decryptString(Buffer.from(encrypted, "base64"))
        : null;
    },
    async setSecret(reference, value) {
      validateSecretReference(reference);
      if (!value) throw new Error("Credential secret cannot be empty");
      await mutate(async () => {
        const previous = secrets;
        const next = {
          ...secrets,
          [reference]: safeStorage.encryptString(value).toString("base64"),
        };
        stored.encryptedSecrets = next;
        try {
          await writeStoredVault(vaultPath, stored);
          secrets = next;
        } catch (error) {
          stored.encryptedSecrets = previous;
          throw error;
        }
      });
    },
    async deleteSecret(reference) {
      validateSecretReference(reference);
      let deleted = false;
      await mutate(async () => {
        if (!(reference in secrets)) return;
        const previous = secrets;
        const next = { ...secrets };
        delete next[reference];
        stored.encryptedSecrets = next;
        try {
          await writeStoredVault(vaultPath, stored);
          secrets = next;
          deleted = true;
        } catch (error) {
          stored.encryptedSecrets = previous;
          throw error;
        }
      });
      return deleted;
    },
  };
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
    if (
      !stored.encryptedSecrets ||
      typeof stored.encryptedSecrets !== "object" ||
      Array.isArray(stored.encryptedSecrets)
    ) {
      throw new Error("Credential vault is missing encrypted secrets");
    }
    return credentialVaultFromStored(stored, vaultPath);
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
    encryptedSecrets: {},
  };

  await writeStoredVault(vaultPath, stored);
  return credentialVaultFromStored(stored, vaultPath);
}
