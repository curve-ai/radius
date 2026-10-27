import { z } from "zod";

export const RADIUS_AGENT_CONFIG_VERSION = 1;
export const RADIUS_AGENT_MANIFEST_VERSION = 1;

const nonempty = z.string().trim().min(1);
const positiveInteger = z.number().int().positive();
const agentRef = z.string().regex(/^agent_[A-Za-z0-9_-]{6,64}$/);
const semanticVersion = z
  .string()
  .regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/);
const capabilitySegment = /^[a-z][a-z0-9_-]*$/;
const environmentVariable = /^[A-Za-z_][A-Za-z0-9_]*$/;
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export const RelativeProjectPathSchema = nonempty.superRefine(
  (value, context) => {
    if (value.startsWith("/") || value.startsWith("\\")) {
      context.addIssue({
        code: "custom",
        message: "Path must be relative to the project root",
      });
    }
    if (value.includes("\\")) {
      context.addIssue({
        code: "custom",
        message: "Path must use POSIX separators",
      });
    }
    if (value.split("/").some((segment) => segment === "..")) {
      context.addIssue({
        code: "custom",
        message: "Path must not escape the project root",
      });
    }
  },
);

export const CapabilityRequestSchema = z
  .object({
    key: nonempty.refine(
      (value) =>
        value.split(".").every((segment) => capabilitySegment.test(segment)),
      "Capability keys must contain lowercase dotted identifier segments",
    ),
    operations: z.array(nonempty).min(1),
    requirement: z.enum(["required", "optional"]).default("required"),
  })
  .superRefine((value, context) => {
    if (new Set(value.operations).size !== value.operations.length) {
      context.addIssue({
        code: "custom",
        path: ["operations"],
        message: "Capability operations must be unique",
      });
    }
  });

export const TypeScriptRuntimeConfigSchema = z.object({
  kind: z.literal("typescript"),
  entrypoint: RelativeProjectPathSchema,
  node: z.string().regex(/^\d+$/).default("22"),
});

export const PythonRuntimeConfigSchema = z.object({
  kind: z.literal("python"),
  module: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.]*$/),
  python: z.string().regex(/^3\.\d+$/),
  lockfile: RelativeProjectPathSchema.default("uv.lock"),
});

export const CommandRuntimeConfigSchema = z.object({
  kind: z.literal("command"),
  command: z.array(nonempty).min(1),
});

/**
 * Where a third-party harness comes from. Mirrors the ACP registry's own
 * distribution shapes so `init` can copy a registry entry in verbatim.
 *
 * A discriminated union rather than a literal, so a later `oci` or `git`
 * distribution lands additively.
 */
export const HarnessPlatformArtifactSchema = z.object({
  /** Absolute URL, or a path relative to the project root. */
  archive: nonempty,
  /** Required for URLs, optional for in-repo paths, where `build` computes it. */
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  /**
   * Overrides the distribution's `cmd`/`args` for this platform. Real
   * harnesses differ here — opencode ships `./opencode` everywhere and
   * `./opencode.exe` on Windows — so one command for all platforms cannot be
   * the only option. Additive and optional: a single-command harness omits it.
   */
  cmd: nonempty.optional(),
  args: z.array(nonempty).optional(),
});

/**
 * Keyed by Radius platform identifiers (`linux/arm64`, `darwin/arm64`, …),
 * NOT the registry's own (`linux-aarch64`, `darwin-aarch64`). `init` translates.
 */
export const HarnessBinaryDistributionSchema = z
  .object({
    kind: z.literal("binary"),
    platforms: z.record(nonempty, HarnessPlatformArtifactSchema),
    cmd: nonempty,
    args: z.array(nonempty).default([]),
  })
  .superRefine((value, context) => {
    // Enforced here rather than at spawn time, so a config carrying an
    // unverifiable archive for a platform this machine cannot run is still
    // rejected. A remote artifact without a digest is not pinned at all.
    for (const [platform, artifact] of Object.entries(value.platforms)) {
      if (/^https?:\/\//.test(artifact.archive) && !artifact.sha256) {
        context.addIssue({
          code: "custom",
          path: ["platforms", platform, "sha256"],
          message: `A URL archive must carry sha256 (${platform})`,
        });
      }
    }
  });

/** Exact version required: `name@1.2.3`. A floating range is not reproducible. */
const pinnedPackage = nonempty.regex(
  /@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/,
  "Harness packages must pin an exact version",
);

/**
 * `npx` and `uvx` are separate members with literal discriminants rather than
 * one member with `kind: z.enum(["npx","uvx"])`. A union-typed discriminant
 * cannot be narrowed away by a negative check, so the enum form forces casts
 * at every consumer.
 */
export const HarnessNpxDistributionSchema = z.object({
  kind: z.literal("npx"),
  package: pinnedPackage,
  args: z.array(nonempty).default([]),
});

export const HarnessUvxDistributionSchema = z.object({
  kind: z.literal("uvx"),
  package: pinnedPackage,
  args: z.array(nonempty).default([]),
});

export const HarnessDistributionSchema = z.discriminatedUnion("kind", [
  HarnessBinaryDistributionSchema,
  HarnessNpxDistributionSchema,
  HarnessUvxDistributionSchema,
]);

/**
 * A toolchain the project's own code needs inside the image.
 *
 * A harness is often not the whole agent. An opencode project's tools are
 * TypeScript wrappers around Python scripts, so the image needs both — and
 * `typescript` and `python` runtime kinds are mutually exclusive by
 * construction, so neither could express it. A discriminated union rather
 * than an enum so a later `go` or `ruby` toolchain lands additively.
 *
 * `lockfile` is required, not optional: a toolchain installed from a range
 * makes `buildDigest` vary between builds of identical config.
 */
export const PythonToolchainSchema = z.object({
  kind: z.literal("python"),
  version: z.string().regex(/^3\.\d+$/),
  lockfile: RelativeProjectPathSchema.default("uv.lock"),
});

export const NodeToolchainSchema = z.object({
  kind: z.literal("node"),
  version: z.string().regex(/^\d+$/).default("22"),
  lockfile: RelativeProjectPathSchema,
  /**
   * Where the lockfile's dependencies are installed, relative to the project.
   * Defaults to the lockfile's own directory, which is what opencode wants:
   * its plugin dependencies live beside `.opencode/bun.lock`, not at the root.
   */
  installIn: RelativeProjectPathSchema.optional(),
});

export const HarnessToolchainSchema = z.discriminatedUnion("kind", [
  PythonToolchainSchema,
  NodeToolchainSchema,
]);

export const HarnessRuntimeConfigSchema = z
  .object({
    kind: z.literal("harness"),
    /** The ACP registry id this was populated from, for provenance. */
    registryId: nonempty.optional(),
    distribution: HarnessDistributionSchema,
    license: nonempty.optional(),
    licenseUrl: nonempty.optional(),
    /**
     * The project's own files to ship alongside the harness.
     *
     * There is no import graph to walk: a harness discovers its agents,
     * tools and skills by reading directories at runtime, and agents are
     * markdown. Empty means the harness is the whole agent — true for fx,
     * goose and gemini — and the image carries nothing but the binary.
     *
     * A trailing `/` ships a directory; anything else is one file.
     */
    include: z.array(RelativeProjectPathSchema).default([]),
    /**
     * Where `include` is staged in the image, and what HOME becomes.
     *
     * Harnesses read their configuration from HOME rather than from the
     * working directory, so a tree staged anywhere else is present and
     * unread. Defaults to the state path every Radius image already uses.
     */
    configRoot: z
      .string()
      .regex(
        /^\/[A-Za-z0-9._\-/]*[A-Za-z0-9._-]$/,
        "configRoot must be an absolute POSIX path",
      )
      .default("/opt/data"),
    toolchains: z.array(HarnessToolchainSchema).default([]),
  })
  .superRefine((value, context) => {
    const kinds = value.toolchains.map((toolchain) => toolchain.kind);
    if (new Set(kinds).size !== kinds.length) {
      context.addIssue({
        code: "custom",
        path: ["toolchains"],
        message: "Each toolchain kind may appear at most once",
      });
    }
    // A toolchain installs from files the image does not have unless they were
    // shipped. Caught here rather than at build time, where the failure is a
    // container-build error nobody can read.
    for (const [index, toolchain] of value.toolchains.entries()) {
      const covered = value.include.some((entry) =>
        entry.endsWith("/")
          ? toolchain.lockfile.startsWith(entry)
          : toolchain.lockfile === entry,
      );
      if (!covered) {
        context.addIssue({
          code: "custom",
          path: ["toolchains", index, "lockfile"],
          message: `${toolchain.lockfile} is not covered by runtime.include, so the image cannot install from it`,
        });
      }
    }
  });

export const AgentRuntimeConfigSchema = z.discriminatedUnion("kind", [
  TypeScriptRuntimeConfigSchema,
  PythonRuntimeConfigSchema,
  CommandRuntimeConfigSchema,
  HarnessRuntimeConfigSchema,
]);

export const AgentResourceConfigSchema = z.object({
  cpu: positiveInteger.max(8).default(2),
  memoryMb: positiveInteger.max(32_768).default(4096),
  diskMb: positiveInteger.max(51_200).default(5120),
});

export const AgentDevelopmentConfigSchema = z.object({
  endpoint: z
    .string()
    .url()
    .superRefine((value, context) => {
      const endpoint = new URL(value);
      if (endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") {
        context.addIssue({
          code: "custom",
          message: "Development ACP endpoints must use WebSocket",
        });
      }
      if (!loopbackHosts.has(endpoint.hostname)) {
        context.addIssue({
          code: "custom",
          message: "Development ACP endpoints must be loopback-only",
        });
      }
    }),
  authorizationEnv: z
    .string()
    .regex(environmentVariable)
    .nullable()
    .default(null),
});

export const AgentConfigSchema = z
  .object({
    schemaVersion: z.literal(RADIUS_AGENT_CONFIG_VERSION).default(1),
    agent: agentRef.nullable().default(null),
    /**
     * Developer-owned semver. Combined with the build digest it forms the
     * release version, so major/minor stay expressible without a manual bump
     * for every rebuild.
     */
    version: semanticVersion.default("0.0.0"),
    name: z.string().trim().min(1).max(120),
    runtime: AgentRuntimeConfigSchema,
    development: AgentDevelopmentConfigSchema.optional(),
    capabilities: z.array(CapabilityRequestSchema).default([]),
    networkAllowlist: z.array(nonempty).default([]),
    resources: AgentResourceConfigSchema.default({
      cpu: 2,
      memoryMb: 4096,
      diskMb: 5120,
    }),
    minimumDesktopVersion: semanticVersion.default("0.0.1"),
  })
  .superRefine((value, context) => {
    const capabilityKeys = value.capabilities.map(
      (capability) => capability.key,
    );
    if (new Set(capabilityKeys).size !== capabilityKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "Capability keys must be unique",
      });
    }
    if (
      new Set(value.networkAllowlist).size !== value.networkAllowlist.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["networkAllowlist"],
        message: "Network allowlist entries must be unique",
      });
    }
  });

export const AgentManifestSchema = z.object({
  schemaVersion: z.literal(RADIUS_AGENT_MANIFEST_VERSION),
  agent: agentRef.nullable(),
  name: z.string().trim().min(1).max(120),
  protocol: z.object({
    kind: z.literal("acp-stdio"),
    version: z.literal(1),
  }),
  runtime: AgentRuntimeConfigSchema,
  capabilities: z.array(CapabilityRequestSchema),
  networkAllowlist: z.array(nonempty),
  resources: AgentResourceConfigSchema,
  minimumDesktopVersion: semanticVersion,
});

export type AgentConfigInput = z.input<typeof AgentConfigSchema>;
export type AgentConfig = z.output<typeof AgentConfigSchema>;
export type AgentManifest = z.output<typeof AgentManifestSchema>;
export type AgentRuntimeConfig = z.output<typeof AgentRuntimeConfigSchema>;
export type HarnessRuntimeConfig = z.output<typeof HarnessRuntimeConfigSchema>;
export type HarnessDistribution = z.output<typeof HarnessDistributionSchema>;
export type HarnessPlatformArtifact = z.output<
  typeof HarnessPlatformArtifactSchema
>;
export type HarnessToolchain = z.output<typeof HarnessToolchainSchema>;
export type CapabilityRequest = z.output<typeof CapabilityRequestSchema>;

export const AgentBuildReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  buildDigest: z.string().regex(/^[a-f0-9]{64}$/),
  imageReference: z.string().trim().min(1),
  sourceManifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
  layoutPath: RelativeProjectPathSchema,
  contextPath: RelativeProjectPathSchema,
  manifest: AgentManifestSchema,
  /**
   * What the layout carries, so a downstream step does not have to reopen the
   * image to find out what was just built. Optional, because a receipt written
   * before this existed is still a valid receipt.
   */
  release: z
    .object({
      /** `<config version>+<buildDigest[:16]>`. */
      version: z.string().trim().min(1),
      /** Whether the OCI config carries the embedded release template. */
      templateEmbedded: z.boolean(),
      /** Where the bundled-agent index entry sits, relative to the project. */
      indexPath: RelativeProjectPathSchema,
    })
    .optional(),
  verifiedAt: z.string().datetime(),
  verification: z.object({
    kind: z.literal("microvm-acp"),
    platform: z.enum(["linux/arm64", "linux/amd64"]),
    /**
     * Whether the check actually ran.
     *
     * A build can legitimately produce a layout without booting it — the
     * developer asked to skip it, or this machine has no runtime to boot it
     * with. Saying so is the difference between a receipt and a claim.
     * Defaults true so a receipt written before this field existed still
     * means what it said.
     */
    verified: z.boolean().default(true),
    /** Why it did not run, when it did not. */
    skippedBecause: z.string().trim().min(1).optional(),
    /** What the agent advertised, which is the useful half of the evidence. */
    advertisedAgents: z.array(z.string()).optional(),
  }),
});

export type AgentBuildReceipt = z.infer<typeof AgentBuildReceiptSchema>;
