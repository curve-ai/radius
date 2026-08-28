import { createHash } from "node:crypto";

export interface CredentialTarget {
  name: string;
  apiUrl: string;
}

export interface RadiusCredentialStore {
  get(target: CredentialTarget): Promise<string | null>;
  set(target: CredentialTarget, token: string): Promise<void>;
  delete(target: CredentialTarget): Promise<boolean>;
}

const KEYRING_SERVICE = "sh.curvehq.radius.cli";

export class NativeRadiusCredentialStore implements RadiusCredentialStore {
  async get(target: CredentialTarget): Promise<string | null> {
    try {
      const entry = await this.entry(target);
      return (await entry.getPassword()) ?? null;
    } catch (error) {
      if (isMissingEntry(error)) return null;
      throw credentialStoreError(error);
    }
  }

  async set(target: CredentialTarget, token: string): Promise<void> {
    const normalized = token.trim();
    if (!normalized) throw new Error("Radius access token is required");
    try {
      const entry = await this.entry(target);
      await entry.setPassword(normalized);
    } catch (error) {
      throw credentialStoreError(error);
    }
  }

  async delete(target: CredentialTarget): Promise<boolean> {
    try {
      const entry = await this.entry(target);
      return await entry.deleteCredential();
    } catch (error) {
      if (isMissingEntry(error)) return false;
      throw credentialStoreError(error);
    }
  }

  private async entry(target: CredentialTarget) {
    let keyring: typeof import("@napi-rs/keyring");
    try {
      keyring = await import("@napi-rs/keyring");
    } catch (error) {
      throw credentialStoreError(error);
    }
    return new keyring.AsyncEntry(KEYRING_SERVICE, credentialAccount(target));
  }
}

export async function resolvePlatformAccessToken(
  target: CredentialTarget,
  explicitToken?: string,
  store: RadiusCredentialStore = new NativeRadiusCredentialStore(),
): Promise<string> {
  const direct = explicitToken?.trim() || process.env.RADIUS_ACCESS_TOKEN?.trim();
  if (direct) return direct;
  const stored = await store.get(target);
  if (stored) return stored;
  throw new Error(
    `No Radius credential for profile ${target.name}. Run radius login --profile ${target.name} or set RADIUS_ACCESS_TOKEN.`,
  );
}

export function credentialAccount(target: CredentialTarget): string {
  const fingerprint = createHash("sha256").update(target.apiUrl).digest("hex").slice(0, 16);
  return `profile:${target.name}:${fingerprint}`;
}

function credentialStoreError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(
    `Operating-system credential storage is unavailable (${detail}). Set RADIUS_ACCESS_TOKEN for this invocation; Radius will not fall back to a plaintext file.`,
  );
}

function isMissingEntry(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no entry|not found|no matching entry/i.test(message);
}
