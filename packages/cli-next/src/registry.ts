import { z } from "zod";

import type {
  HarnessDistribution,
  HarnessPlatformArtifact,
} from "@curve-ai/agent-contracts";

import { OperationalError, UsageError } from "./errors.js";

/**
 * The registry is remote, untrusted input, so it is parsed rather than cast.
 * The previous `as` casts turned a missing field into the string "undefined"
 * and pushed the failure to spawn time.
 */
const RegistryArtifactSchema = z.object({
  archive: z.string().min(1),
  cmd: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

const RegistryAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  license: z.string().min(1).optional(),
  license_url: z.string().min(1).optional(),
  distribution: z
    .object({
      binary: z.record(z.string(), RegistryArtifactSchema).optional(),
      npx: z
        .object({ package: z.string().min(1), args: z.array(z.string()).optional() })
        .optional(),
      uvx: z
        .object({ package: z.string().min(1), args: z.array(z.string()).optional() })
        .optional(),
    })
    .optional(),
});

const RegistryDocumentSchema = z.object({
  agents: z.array(RegistryAgentSchema).default([]),
});

export const ACP_REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

/**
 * The registry names platforms its own way; Radius uses OCI-style keys. The
 * translation lives here and nowhere else, because the registry is consulted
 * at `init` and never again — `build` and `dev` read only what was copied
 * into config.
 */
const PLATFORM_KEYS: Readonly<Record<string, string>> = {
  "darwin-aarch64": "darwin/arm64",
  "darwin-x86_64": "darwin/amd64",
  "linux-aarch64": "linux/arm64",
  "linux-x86_64": "linux/amd64",
  "windows-aarch64": "windows/arm64",
  "windows-x86_64": "windows/amd64",
};

export interface RegistryEntry {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly license?: string;
  readonly licenseUrl?: string;
  readonly distribution: HarnessDistribution;
}

/** `linux/arm64` for the machine this is running on. */
export function hostPlatformKey(platform: string, arch: string): string {
  const os = platform === "win32" ? "windows" : platform;
  const cpu = arch === "x64" ? "amd64" : arch === "arm64" ? "arm64" : arch;
  return `${os}/${cpu}`;
}

export async function fetchRegistry(): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(ACP_REGISTRY_URL);
  } catch (cause) {
    throw new OperationalError(
      `Could not reach the ACP registry: ${cause instanceof Error ? cause.message : String(cause)}`,
      "Check your network connection. A harness already recorded in radius.json does not need the registry; only `init` reads it.",
    );
  }
  if (!response.ok) {
    throw new OperationalError(
      `The ACP registry responded ${response.status}.`,
      "Try again shortly; the registry is a static CDN document.",
    );
  }
  return response.json();
}

export function parseRegistry(document: unknown): z.output<typeof RegistryDocumentSchema> {
  const parsed = RegistryDocumentSchema.safeParse(document);
  if (!parsed.success) {
    throw new OperationalError(
      "The ACP registry document is not in the expected shape.",
      "This is a problem at the registry, not in your project.",
    );
  }
  return parsed.data;
}

export function listHarnessIds(registry: unknown): string[] {
  return parseRegistry(registry)
    .agents.map((agent) => agent.id)
    .sort();
}

/**
 * Translates one registry entry into the config shape. Deliberately copies
 * concrete URLs and digests rather than keeping a reference, so a build is
 * reproducible even as the registry moves beneath it — opencode shipped
 * 1.18.31 → 1.18.34 inside a single day.
 */
export function selectEntry(document: unknown, id: string): RegistryEntry {
  const registry = parseRegistry(document);
  const entry = registry.agents.find((candidate) => candidate.id === id);
  if (!entry) {
    const known = registry.agents.map((agent) => agent.id).sort();
    throw new UsageError(
      `No harness "${id}" in the ACP registry. ${known.length} available, including: ${known.slice(0, 8).join(", ")}…`,
    );
  }

  const common = {
    id: entry.id,
    name: entry.name ?? entry.id,
    version: entry.version ?? "0.0.0",
    license: entry.license,
    licenseUrl: entry.license_url,
  };

  const binary = entry.distribution?.binary;
  if (binary) {
    const platforms: Record<string, HarnessPlatformArtifact> = {};
    const commands = new Map<string, { cmd: string; args: string[] }>();
    for (const [registryKey, artifact] of Object.entries(binary)) {
      const key = PLATFORM_KEYS[registryKey];
      // An unknown platform key is skipped rather than failing the whole
      // entry: the registry may add platforms Radius has no name for yet.
      if (!key) continue;
      platforms[key] = {
        archive: artifact.archive,
        ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
      };
      if (artifact.cmd) {
        commands.set(key, { cmd: artifact.cmd, args: artifact.args ?? [] });
      }
    }
    if (Object.keys(platforms).length === 0) {
      throw new OperationalError(
        `The registry entry for "${id}" lists no platform Radius recognises.`,
      );
    }
    if (commands.size === 0) {
      throw new OperationalError(
        `The registry entry for "${id}" names no launch command.`,
      );
    }

    // Whichever launch command the most platforms agree on becomes the
    // default; the rest are recorded per platform. Previously the first
    // platform to iterate won and every difference was silently dropped —
    // which would have run `./opencode` on Windows.
    const tally = new Map<string, number>();
    for (const value of commands.values()) {
      const key = JSON.stringify(value);
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    const [majority] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const shared = JSON.parse(majority) as { cmd: string; args: string[] };
    for (const [platform, value] of commands) {
      if (JSON.stringify(value) === majority) continue;
      platforms[platform] = {
        ...platforms[platform]!,
        cmd: value.cmd,
        args: value.args,
      };
    }

    return {
      ...common,
      distribution: {
        kind: "binary",
        platforms,
        cmd: shared.cmd,
        args: shared.args,
      },
    };
  }

  for (const kind of ["npx", "uvx"] as const) {
    const pkg = entry.distribution?.[kind];
    if (!pkg) continue;
    return {
      ...common,
      distribution: { kind, package: pkg.package, args: pkg.args ?? [] },
    };
  }

  throw new OperationalError(
    `The registry entry for "${id}" has no distribution Radius can install.`,
    "Only binary, npx and uvx distributions are supported.",
  );
}
