import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  AgentConfigSchema,
  HarnessPinSchema,
  parseHarnessPin,
  type AgentConfig,
} from "@curve-ai/agent-contracts";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

import { OperationalError, UsageError } from "./errors.js";
import { LOCK_FILENAME, readLock } from "./lock.js";

export const CONFIG_FILENAME = "radius.json";
export const CONFIG_SCHEMA_URL =
  "https://schemas.curve.ai/radius/agent-config/v1.json";

export function configPath(root: string): string {
  return join(root, CONFIG_FILENAME);
}

/** `agent_` plus 16 hex, matching the contract's agentRef pattern. */
export function mintAgentId(): string {
  return `agent_${randomBytes(8).toString("hex")}`;
}

export async function readRawConfig(root: string): Promise<string | null> {
  try {
    return await readFile(configPath(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export interface LoadedConfig {
  readonly config: AgentConfig;
  readonly path: string;
  /** Set when the config came from a format that is on its way out. */
  readonly deprecation?: string;
}

/**
 * Loads `radius.json`, falling back to the formats it replaced.
 *
 * The fallback is what makes `init` → `dev` → `build` work in a project that
 * predates `radius.json`: without it, `build` would refuse every config the
 * old CLI ever wrote.
 */
export async function loadConfigFile(
  root: string,
  explicitPath?: string | null,
): Promise<LoadedConfig> {
  // A named file is read as given. Probing the directory instead is how
  // `--config agent.prod.json` ended up loading radius.json.
  if (explicitPath) {
    let raw: string;
    try {
      raw = await readFile(explicitPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new OperationalError(`No config at ${explicitPath}.`);
      }
      throw error;
    }
    if (explicitPath.endsWith(".json")) {
      return {
        config: await parseConfig(raw, explicitPath),
        path: explicitPath,
      };
    }
    const { readLegacyConfigFile } = await import("./legacy-config.js");
    const legacy = await readLegacyConfigFile(explicitPath);
    return {
      config: legacy,
      path: explicitPath,
      deprecation: `${explicitPath} is a deprecated config format and will stop being read.`,
    };
  }

  const raw = await readRawConfig(root);
  if (raw !== null) {
    return {
      config: await parseConfig(raw, configPath(root)),
      path: configPath(root),
    };
  }
  const { findLegacyConfig } = await import("./legacy-config.js");
  const legacy = await findLegacyConfig(root);
  if (legacy) {
    return {
      config: legacy.config,
      path: legacy.path,
      deprecation: `${legacy.filename} is deprecated and will stop being read. Run \`radius init\` to write ${CONFIG_FILENAME}.`,
    };
  }
  throw new OperationalError(
    `No ${CONFIG_FILENAME} in ${root}.`,
    "Run `radius init --harness <id>` to create one.",
  );
}

export async function loadConfig(root: string): Promise<AgentConfig> {
  return (await loadConfigFile(root)).config;
}

/**
 * The harness fields a person writes, which sit at the top level of a short
 * `radius.json` beside `harness`. Everything else in the runtime block is
 * copied out of the registry and lives in `radius.lock`.
 */
export const HARNESS_PROJECT_FIELDS = [
  "include",
  "configRoot",
  "toolchains",
  "env",
] as const;

async function parseConfig(raw: string, file: string): Promise<AgentConfig> {
  const errors: ParseError[] = [];
  const parsed: unknown = parse(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new UsageError(`${CONFIG_FILENAME} is not valid JSON.`);
  }
  const shorthand = isRecord(parsed) && "harness" in parsed;
  const expanded = isRecord(parsed)
    ? await expandHarness(parsed, dirname(file))
    : parsed;
  const result = AgentConfigSchema.safeParse(expanded);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => {
        // Report the path the developer wrote. In the short form `include`
        // is top-level, and `runtime.include` names a key that is not there.
        const path = issue.path.map(String);
        const shown =
          shorthand &&
          path[0] === "runtime" &&
          (HARNESS_PROJECT_FIELDS as readonly string[]).includes(path[1] ?? "")
            ? path.slice(1)
            : path;
        return `  ${shown.join(".") || "(root)"}: ${issue.message}`;
      })
      .join("\n");
    throw new UsageError(
      `${CONFIG_FILENAME} is not a valid agent config:\n${detail}`,
    );
  }
  return result.data;
}

/**
 * Turns the short form — `"harness": "opencode@1.19.4"` plus a lock — into
 * the `runtime` block the rest of the CLI reads. Expanding here, before
 * validation, is what keeps every consumer of `AgentConfig` unaware that two
 * files on disk became one object in memory.
 *
 * The verbose form, with `runtime` written out inline, passes through
 * untouched: every config `init` wrote before the lock existed still loads.
 */
async function expandHarness(
  parsed: Record<string, unknown>,
  root: string,
): Promise<unknown> {
  const stray = HARNESS_PROJECT_FIELDS.filter((field) => field in parsed);
  if (!("harness" in parsed)) {
    // Without this, the schema strips the unknown key and a top-level
    // `include` ships nothing, silently.
    if (stray.length > 0) {
      throw new UsageError(
        `${CONFIG_FILENAME} has top-level ${stray.map((field) => `\`${field}\``).join(", ")}, which only applies beside \`harness\`. With an inline \`runtime\`, put ${stray.length > 1 ? "them" : "it"} inside \`runtime\`.`,
      );
    }
    return parsed;
  }
  if ("runtime" in parsed) {
    throw new UsageError(
      `${CONFIG_FILENAME} has both \`harness\` and \`runtime\`. Keep one: \`harness\` pins through ${LOCK_FILENAME}, \`runtime\` pins inline.`,
    );
  }
  const pinResult = HarnessPinSchema.safeParse(parsed.harness);
  if (!pinResult.success) {
    throw new UsageError(
      `${CONFIG_FILENAME}: harness: ${pinResult.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  const pin = parseHarnessPin(pinResult.data);
  const lock = await readLock(root);
  if (!lock) {
    throw new UsageError(
      `${CONFIG_FILENAME} pins ${pin.id}@${pin.version}, but there is no ${LOCK_FILENAME} beside it.\n\nRun \`radius init\` to write it, and commit it with ${CONFIG_FILENAME}.`,
    );
  }
  const locked = lock.harness;
  if (locked.registryId !== pin.id || locked.version !== pin.version) {
    throw new UsageError(
      `${CONFIG_FILENAME} pins ${pin.id}@${pin.version}, but ${LOCK_FILENAME} holds ${locked.registryId}@${locked.version}.\n\nRun \`radius init\` to re-pin, or \`radius init --force\` to move to what the registry offers now.`,
    );
  }

  const { harness: _harness, ...rest } = parsed;
  const runtime: Record<string, unknown> = {
    kind: "harness",
    registryId: locked.registryId,
    distribution: locked.distribution,
    ...(locked.license ? { license: locked.license } : {}),
    ...(locked.licenseUrl ? { licenseUrl: locked.licenseUrl } : {}),
  };
  for (const field of HARNESS_PROJECT_FIELDS) {
    if (field in rest) {
      runtime[field] = rest[field];
      delete rest[field];
    }
  }
  return { ...rest, runtime };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Idempotent fill-in: never overwrite a value that is already present, add
 * what is missing, and report exactly what changed. Edits go through
 * jsonc-parser so comments and formatting survive a re-run — the property
 * that made config-as-data worth choosing over executable config.
 */
export interface ConfigEdit {
  readonly path: (string | number)[];
  /** `undefined` with `replace` removes the key. */
  readonly value: unknown;
  /**
   * Overwrite a present value. Only `init --force` sets it, and only for the
   * keys init owns outright — the harness pin and the inline runtime it
   * migrates away from.
   */
  readonly replace?: boolean;
}

export async function applyConfigEdits(
  root: string,
  edits: ReadonlyArray<ConfigEdit>,
): Promise<string[]> {
  const existing = (await readRawConfig(root)) ?? "{}\n";
  let text = existing;
  const changed: string[] = [];
  for (const edit of edits) {
    const current = parse(text, [], { allowTrailingComma: true });
    const present = valueAt(current, edit.path);
    if (edit.replace) {
      if (JSON.stringify(present) === JSON.stringify(edit.value)) continue;
    } else if (present !== undefined || edit.value === undefined) {
      continue;
    }
    text = applyEdits(
      text,
      modify(text, edit.path, edit.value, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    );
    changed.push(edit.path.join("."));
  }
  if (text !== existing) await writeFile(configPath(root), text, "utf8");
  return changed;
}

function valueAt(source: unknown, path: (string | number)[]): unknown {
  let cursor: unknown = source;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }
  return cursor;
}
