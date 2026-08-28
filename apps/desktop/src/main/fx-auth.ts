import {
  connectAgentAuthenticationAccount,
  disconnectAgentAuthentication,
  getAgentAuthenticationSummary,
} from "@curve-ai/radius-storage";
import type { AgentReleaseDescriptor } from "@curve-ai/radius-runtime";
import { app, shell } from "electron";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { StorageContext } from "./storage";
import {
  applyFxThinkingEffort,
  fxThinkingEffortsForModel,
} from "./fx-reasoning";

const FX_AGENT_ID = "fx";
const FX_AUTH_REQUIREMENT_KEY = "codex-subscription";
const FX_CREDENTIAL_REFERENCE = "agent:fx:openai-codex";
const MAX_AUTH_BYTES = 64 * 1024;
const MAX_SETTINGS_BYTES = 64 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 60_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;

interface FxProfileBundle {
  version: 1;
  authJson: string;
  settingsJson: string | null;
}

interface FxAuthMetadata {
  accountId: string;
  expiresAt: string;
}

export interface FxAuthenticationStatus {
  state: "needs_authentication" | "connected" | "expired" | "error";
  accountLabel: string | null;
  detail: string;
  models: Array<{
    id: string;
    label: string;
    thinkingEfforts: Array<{ id: string; label: string }>;
    defaultThinkingEffortId: string | null;
  }>;
  defaultModelId: string | null;
}

export interface FxRuntimeProfileLease {
  path: string;
  finalize(): Promise<void>;
}

let profileTail: Promise<void> = Promise.resolve();
let activeRuntimeProfileLeases = 0;
let cachedAuthenticationStatus: FxAuthenticationStatus | null = null;

function rememberAuthenticationStatus(
  status: FxAuthenticationStatus,
): FxAuthenticationStatus {
  cachedAuthenticationStatus = {
    ...status,
    models: status.models.map((model) => ({
      ...model,
      thinkingEfforts: model.thinkingEfforts.map((effort) => ({ ...effort })),
    })),
  };
  return status;
}

function copyAuthenticationStatus(
  status: FxAuthenticationStatus,
): FxAuthenticationStatus {
  return {
    ...status,
    models: status.models.map((model) => ({
      ...model,
      thinkingEfforts: model.thinkingEfforts.map((effort) => ({ ...effort })),
    })),
  };
}

async function acquireProfileLock(): Promise<() => void> {
  const previous = profileTail;
  let releaseLock: (() => void) | null = null;
  profileTail = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  await previous;
  return () => releaseLock?.();
}

function resolveFxBinary(): string {
  const configured = process.env.RADIUS_FX_BINARY_PATH?.trim();
  if (configured) return path.resolve(configured);
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "agents/fx/macos-arm64/fx");
  }
  return path.join(app.getPath("appData"), "Radius/dev/fx/bin/fx");
}

async function assertFxBinary(): Promise<string> {
  const binaryPath = resolveFxBinary();
  const info = await stat(binaryPath).catch(() => null);
  if (!info?.isFile()) throw new Error("FX_BINARY_NOT_INSTALLED");
  return binaryPath;
}

function minimalFxEnvironment(homePath: string): NodeJS.ProcessEnv {
  return {
    HOME: homePath,
    LANG: process.env.LANG || "en_US.UTF-8",
    PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
    TMPDIR: process.env.TMPDIR || "/tmp",
    FX_AUTO_UPGRADE: "0",
    FX_NO_OPEN_BROWSER: "1",
  };
}

function appendBounded(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length <= MAX_COMMAND_OUTPUT_BYTES
    ? next
    : next.slice(next.length - MAX_COMMAND_OUTPUT_BYTES);
}

async function runFx(
  homePath: string,
  args: string[],
  options: { login?: boolean } = {},
): Promise<{ stdout: string; stderr: string }> {
  const binaryPath = await assertFxBinary();
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      cwd: app.getPath("userData"),
      env: minimalFxEnvironment(homePath),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let authUrlOpened = false;
    const inspectAuthUrl = (chunk: string): void => {
      if (!options.login || authUrlOpened) return;
      for (const match of chunk.matchAll(/https:\/\/[^\s<>"']+/g)) {
        try {
          const url = new URL(match[0]);
          if (url.hostname !== "auth.openai.com") continue;
          authUrlOpened = true;
          void shell.openExternal(url.toString());
          return;
        } catch {
          continue;
        }
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = appendBounded(stdout, chunk);
      inspectAuthUrl(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = appendBounded(stderr, chunk);
      inspectAuthUrl(chunk);
    });
    const timeout = setTimeout(
      () => {
        child.kill("SIGTERM");
        reject(
          new Error(options.login ? "FX_LOGIN_TIMEOUT" : "FX_COMMAND_TIMEOUT"),
        );
      },
      options.login ? LOGIN_TIMEOUT_MS : COMMAND_TIMEOUT_MS,
    );
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `FX_COMMAND_FAILED:${code ?? signal ?? "unknown"}:${stderr.trim().slice(-500)}`,
          ),
        );
    });
  });
}

function parseFxProfileBundle(value: string): FxProfileBundle {
  const parsed = JSON.parse(value) as Partial<FxProfileBundle>;
  if (
    parsed.version !== 1 ||
    typeof parsed.authJson !== "string" ||
    (parsed.settingsJson !== null && typeof parsed.settingsJson !== "string")
  ) {
    throw new Error("FX_CREDENTIAL_BUNDLE_INVALID");
  }
  return parsed as FxProfileBundle;
}

function parseFxAuthMetadata(authJson: string): FxAuthMetadata {
  const value = JSON.parse(authJson) as Record<string, unknown>;
  if (
    value.version !== 1 ||
    typeof value.account_id !== "string" ||
    !value.account_id ||
    typeof value.expires_at_ms !== "number" ||
    !Number.isSafeInteger(value.expires_at_ms)
  ) {
    throw new Error("FX_CODEX_AUTH_INVALID");
  }
  return {
    accountId: value.account_id,
    expiresAt: new Date(value.expires_at_ms).toISOString(),
  };
}

async function readOptionalBounded(
  filePath: string,
  maxBytes: number,
): Promise<string | null> {
  const info = await stat(filePath).catch(() => null);
  if (!info) return null;
  if (!info.isFile() || info.size > maxBytes)
    throw new Error("FX_PROFILE_FILE_INVALID");
  return readFile(filePath, "utf8");
}

async function createMaterializedProfile(
  context: StorageContext,
  requireCredential: boolean,
): Promise<{ root: string; fxDirectory: string }> {
  const parent = path.join(app.getPath("userData"), "runtime-auth");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(parent, "fx-"));
  await chmod(root, 0o700);
  const fxDirectory = path.join(root, ".fx");
  await mkdir(fxDirectory, { mode: 0o700 });
  const encrypted = await context.vault.getSecret(FX_CREDENTIAL_REFERENCE);
  if (!encrypted) {
    if (requireCredential) {
      await rm(root, { force: true, recursive: true });
      throw new Error("FX_AUTHENTICATION_REQUIRED");
    }
    return { root, fxDirectory };
  }
  const bundle = parseFxProfileBundle(encrypted);
  await writeFile(
    path.join(fxDirectory, "chatgpt-auth.json"),
    bundle.authJson,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  if (bundle.settingsJson) {
    await writeFile(
      path.join(fxDirectory, "settings.json"),
      bundle.settingsJson,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  }
  return { root, fxDirectory };
}

async function captureAndSealProfile(
  context: StorageContext,
  root: string,
): Promise<FxAuthMetadata> {
  const fxDirectory = path.join(root, ".fx");
  const authJson = await readOptionalBounded(
    path.join(fxDirectory, "chatgpt-auth.json"),
    MAX_AUTH_BYTES,
  );
  if (!authJson) throw new Error("FX_CODEX_AUTH_MISSING");
  const metadata = parseFxAuthMetadata(authJson);
  const settingsJson = await readOptionalBounded(
    path.join(fxDirectory, "settings.json"),
    MAX_SETTINGS_BYTES,
  );
  await context.vault.setSecret(
    FX_CREDENTIAL_REFERENCE,
    JSON.stringify({
      version: 1,
      authJson,
      settingsJson,
    } satisfies FxProfileBundle),
  );
  return metadata;
}

async function removeMaterializedProfile(root: string): Promise<void> {
  const expectedParent = path.resolve(app.getPath("userData"), "runtime-auth");
  const target = path.resolve(root);
  if (!target.startsWith(`${expectedParent}${path.sep}fx-`)) {
    throw new Error("Refusing to remove an unexpected fx profile path");
  }
  await rm(target, { force: true, recursive: true });
}

async function withFxProfile<T>(
  context: StorageContext,
  requireCredential: boolean,
  operation: (root: string) => Promise<T>,
): Promise<T> {
  const releaseLock = await acquireProfileLock();
  let profile: Awaited<ReturnType<typeof createMaterializedProfile>>;
  try {
    profile = await createMaterializedProfile(context, requireCredential);
  } catch (error) {
    releaseLock();
    throw error;
  }
  try {
    const result = await operation(profile.root);
    if (await context.vault.getSecret(FX_CREDENTIAL_REFERENCE)) {
      await captureAndSealProfile(context, profile.root);
    }
    return result;
  } finally {
    await removeMaterializedProfile(profile.root).finally(releaseLock);
  }
}

function parseModelCatalog(value: string): FxAuthenticationStatus["models"] {
  const parsed = JSON.parse(value) as { ids?: unknown };
  if (!Array.isArray(parsed.ids)) throw new Error("FX_MODEL_CATALOG_INVALID");
  return parsed.ids
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .map((id) => {
      const thinkingEfforts = fxThinkingEffortsForModel(id);
      return {
        id,
        label: id,
        thinkingEfforts,
        defaultThinkingEffortId:
          thinkingEfforts.find((option) => option.id === "auto")?.id ?? null,
      };
    });
}

function preferredModel(
  models: FxAuthenticationStatus["models"],
): string | null {
  for (const preferred of [
    "gpt-5.6-luna",
    "openai/gpt-5.6-luna",
    "gpt-5.6-sol",
  ]) {
    if (models.some((model) => model.id === preferred)) return preferred;
  }
  return models[0]?.id ?? null;
}

export async function connectFxCodex(
  context: StorageContext,
  installationId: string,
): Promise<FxAuthenticationStatus> {
  const releaseLock = await acquireProfileLock();
  let profile: Awaited<ReturnType<typeof createMaterializedProfile>>;
  try {
    profile = await createMaterializedProfile(context, false);
  } catch (error) {
    releaseLock();
    throw error;
  }
  try {
    await runFx(profile.root, ["login", "codex"], { login: true });
    const metadata = await captureAndSealProfile(context, profile.root);
    await connectAgentAuthenticationAccount(context.database, {
      installationId,
      requirementKey: FX_AUTH_REQUIREMENT_KEY,
      custodyKind: "encrypted_agent_state",
      credentialRef: `vault:${FX_CREDENTIAL_REFERENCE}`,
      remoteSubject: metadata.accountId,
      accountLabel: "Codex subscription",
      expiresAt: metadata.expiresAt,
      resultCode: "FX_CODEX_CONNECTED",
    });
  } finally {
    await removeMaterializedProfile(profile.root).finally(releaseLock);
  }
  return getFxAuthenticationStatus(context, installationId);
}

export async function disconnectFxCodex(
  context: StorageContext,
  installationId: string,
): Promise<FxAuthenticationStatus> {
  const result = await disconnectAgentAuthentication(
    context.database,
    installationId,
    FX_AUTH_REQUIREMENT_KEY,
  );
  if (result.credentialUnused) {
    await context.vault.deleteSecret(FX_CREDENTIAL_REFERENCE);
  }
  return getFxAuthenticationStatus(context, installationId);
}

export async function getFxAuthenticationStatus(
  context: StorageContext,
  installationId: string,
  options: { preferCachedDuringRuntime?: boolean } = {},
): Promise<FxAuthenticationStatus> {
  if (
    options.preferCachedDuringRuntime &&
    activeRuntimeProfileLeases > 0 &&
    cachedAuthenticationStatus
  ) {
    return copyAuthenticationStatus(cachedAuthenticationStatus);
  }
  const encrypted = await context.vault.getSecret(FX_CREDENTIAL_REFERENCE);
  const summary = await getAgentAuthenticationSummary(
    context.database,
    installationId,
  );
  if (!encrypted) {
    return rememberAuthenticationStatus({
      state: "needs_authentication",
      accountLabel: null,
      detail: "Connect a Codex subscription",
      models: [],
      defaultModelId: null,
    });
  }
  try {
    const metadata = parseFxAuthMetadata(
      parseFxProfileBundle(encrypted).authJson,
    );
    if (!summary.ready) {
      await connectAgentAuthenticationAccount(context.database, {
        installationId,
        requirementKey: FX_AUTH_REQUIREMENT_KEY,
        custodyKind: "encrypted_agent_state",
        credentialRef: `vault:${FX_CREDENTIAL_REFERENCE}`,
        remoteSubject: metadata.accountId,
        accountLabel: "Codex subscription",
        expiresAt: metadata.expiresAt,
        resultCode: "FX_CODEX_RECONCILED",
      });
    }
    const models = await withFxProfile(context, true, async (root) => {
      const result = await runFx(root, ["models", "--json"]);
      return parseModelCatalog(result.stdout);
    });
    const refreshedBundle = await context.vault.getSecret(
      FX_CREDENTIAL_REFERENCE,
    );
    const refreshedMetadata = refreshedBundle
      ? parseFxAuthMetadata(parseFxProfileBundle(refreshedBundle).authJson)
      : metadata;
    return rememberAuthenticationStatus({
      state:
        Date.parse(refreshedMetadata.expiresAt) <= Date.now()
          ? "expired"
          : "connected",
      accountLabel: "Codex subscription",
      detail: "Authenticated on this Mac",
      models,
      defaultModelId: preferredModel(models),
    });
  } catch {
    return rememberAuthenticationStatus({
      state: "error",
      accountLabel: "Codex subscription",
      detail: "Codex authentication needs attention",
      models: [],
      defaultModelId: null,
    });
  }
}

export async function prepareFxRuntimeProfile(
  context: StorageContext,
  thinkingEffortId: string | null,
): Promise<FxRuntimeProfileLease> {
  const releaseLock = await acquireProfileLock();
  let profile: Awaited<ReturnType<typeof createMaterializedProfile>>;
  try {
    profile = await createMaterializedProfile(context, true);
  } catch (error) {
    releaseLock();
    throw error;
  }
  const settingsPath = path.join(profile.fxDirectory, "settings.json");
  let originalSettingsJson: string | null;
  try {
    originalSettingsJson = await readOptionalBounded(
      settingsPath,
      MAX_SETTINGS_BYTES,
    );
    if (thinkingEffortId) {
      const runtimeSettingsJson = applyFxThinkingEffort(
        originalSettingsJson,
        thinkingEffortId,
      );
      if (Buffer.byteLength(runtimeSettingsJson, "utf8") > MAX_SETTINGS_BYTES) {
        throw new Error("FX_SETTINGS_INVALID");
      }
      await writeFile(settingsPath, runtimeSettingsJson, {
        encoding: "utf8",
        mode: 0o600,
      });
    }
  } catch (error) {
    await removeMaterializedProfile(profile.root).finally(releaseLock);
    throw error;
  }
  activeRuntimeProfileLeases += 1;
  let finalized = false;
  return {
    path: profile.root,
    async finalize() {
      if (finalized) return;
      finalized = true;
      try {
        if (originalSettingsJson === null) {
          await rm(settingsPath, { force: true });
        } else {
          await writeFile(settingsPath, originalSettingsJson, {
            encoding: "utf8",
            mode: 0o600,
          });
        }
        await captureAndSealProfile(context, profile.root);
      } finally {
        activeRuntimeProfileLeases = Math.max(
          0,
          activeRuntimeProfileLeases - 1,
        );
        await removeMaterializedProfile(profile.root).finally(releaseLock);
      }
    },
  };
}

export function isFxRelease(release: AgentReleaseDescriptor): boolean {
  return release.agentId === FX_AGENT_ID;
}
