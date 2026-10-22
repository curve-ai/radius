import type { AgentConfig } from "@curve-ai/agent-contracts";

import { canonicalJson } from "./manifest.js";

/** The label the desktop importer reads the embedded template from. */
export const RELEASE_TEMPLATE_LABEL = "ai.curve.radius.release-template.v1";
export const VERSION_LABEL = "org.opencontainers.image.version";

/**
 * The digest the template claims for its own image.
 *
 * The template is embedded in the OCI config, which is hashed into the
 * manifest digest — so a template cannot carry the digest of the image it
 * lives in. The importer overwrites this field with the real manifest digest
 * on read (`bundled-agent-layout.ts`), which is what makes the circularity
 * tractable. It must still be a well-formed digest to satisfy the schema.
 */
const PLACEHOLDER_DIGEST = `sha256:${"0".repeat(64)}`;

/** Fixed defaults, per CUR-59. Not developer-owned. */
const PROCESS_LIMIT = 256;
const OPEN_FILE_LIMIT = 1024;
/** Headroom over the measured image size, so a guest has room to write. */
const ROOTFS_HEADROOM_MB = 128;

export interface ReleaseTemplateInput {
  readonly config: AgentConfig;
  readonly buildDigest: string;
  readonly imageReference: string;
  readonly platform: "linux/arm64" | "linux/amd64";
  readonly processArguments: readonly string[];
  /** Measured size of the image layers, in MB, before headroom. */
  readonly imageSizeMb: number;
}

/**
 * Builds the release descriptor the desktop imports, from config plus facts
 * known at build time.
 *
 * Reproducibility rule from CUR-59: nothing here may vary between builds of
 * identical input. Every value is derived from the config or the build digest
 * — no timestamps, no randomness, no host details.
 */
export function synthesiseReleaseTemplate(
  input: ReleaseTemplateInput,
): Record<string, unknown> {
  const { config } = input;
  if (!config.agent) {
    throw new Error(
      "This config has no agent id. Run `radius init` to assign one before building.",
    );
  }

  return {
    schemaVersion: 1,
    agentId: config.agent,
    // A locally built agent has no platform provider. CUR-59 fixes this
    // constant so the desktop can tell local builds from deployed releases.
    providerId: "local",
    displayName: config.name,
    releaseVersion: releaseVersionFor(config.version, input.buildDigest),
    protocol: { kind: "acp-stdio", version: 1 },
    image: {
      reference: input.imageReference,
      digest: PLACEHOLDER_DIGEST,
      platform: input.platform,
      // Translation is a property of the host, not of the artifact. A build
      // cannot know what will run it, so it never claims translation.
      translation: "none",
    },
    process: {
      arguments: [...input.processArguments],
      user: "10000:10000",
      statePath: "/opt/data",
    },
    resources: {
      cpus: config.resources.cpu,
      memoryMb: config.resources.memoryMb,
      rootfsMb: Math.max(1, Math.ceil(input.imageSizeMb) + ROOTFS_HEADROOM_MB),
      stateMb: config.resources.diskMb,
      processLimit: PROCESS_LIMIT,
      openFileLimit: OPEN_FILE_LIMIT,
    },
    networkAllowlist: [...config.networkAllowlist],
    // Flattened to `key.op`, matching what the dev path already registers.
    capabilities: config.capabilities.flatMap((capability) =>
      capability.operations.map((operation) => `${capability.key}.${operation}`),
    ),
    // Empty until CUR-47's auth layer lands; the field exists so adding it
    // later is additive rather than a schema change.
    authRequirements: [],
    models: [],
    defaultModelId: null,
  };
}

/**
 * `<config version>+<buildDigest[:16]>`.
 *
 * The semver half keeps major/minor expressible by the developer; the digest
 * half makes every changed build a new release with no manual bump, and ties
 * the version to the bytes so the two cannot drift.
 */
export function releaseVersionFor(
  version: string,
  buildDigest: string,
): string {
  return `${version}+${buildDigest.slice(0, 16)}`;
}

/** Canonical JSON, base64 — the encoding the importer decodes. */
export function encodeReleaseTemplate(
  template: Record<string, unknown>,
): string {
  return Buffer.from(canonicalJson(template), "utf8").toString("base64");
}

/** The labels an image must carry for the desktop to import it. */
export function releaseTemplateLabels(
  template: Record<string, unknown>,
): Record<string, string> {
  return {
    [VERSION_LABEL]: String(template.releaseVersion),
    [RELEASE_TEMPLATE_LABEL]: encodeReleaseTemplate(template),
  };
}
