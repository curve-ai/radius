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

export const AgentRuntimeConfigSchema = z.discriminatedUnion("kind", [
  TypeScriptRuntimeConfigSchema,
  PythonRuntimeConfigSchema,
  CommandRuntimeConfigSchema,
]);

export const AgentResourceConfigSchema = z.object({
  cpu: positiveInteger.max(8).default(2),
  memoryMb: positiveInteger.max(32_768).default(4096),
  diskMb: positiveInteger.max(51_200).default(5120),
});

export const AgentConfigSchema = z
  .object({
    schemaVersion: z.literal(RADIUS_AGENT_CONFIG_VERSION).default(1),
    agent: agentRef.nullable().default(null),
    name: z.string().trim().min(1).max(120),
    runtime: AgentRuntimeConfigSchema,
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
export type CapabilityRequest = z.output<typeof CapabilityRequestSchema>;
