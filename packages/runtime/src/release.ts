import { z } from "zod";

const sha256Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const positiveInteger = z.number().int().positive();

export const AgentReleaseDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    agentId: z.string().trim().min(1),
    providerId: z.string().trim().min(1),
    displayName: z.string().trim().min(1),
    releaseVersion: z.string().trim().min(1),
    protocol: z.object({
      kind: z.literal("acp-stdio"),
      version: positiveInteger,
    }),
    image: z.object({
      reference: z.string().trim().min(1),
      digest: sha256Digest,
      platform: z.enum(["linux/arm64", "linux/amd64"]),
      translation: z.enum(["none", "rosetta"]),
    }),
    process: z.object({
      arguments: z.array(z.string().min(1)).min(1),
      user: z.string().regex(/^\d+:\d+$/),
      statePath: z.literal("/opt/data"),
    }),
    resources: z.object({
      cpus: positiveInteger.max(8),
      memoryMb: positiveInteger.max(32_768),
      rootfsMb: positiveInteger.max(10_240),
      stateMb: positiveInteger.max(51_200),
      processLimit: positiveInteger.max(4_096),
      openFileLimit: positiveInteger.max(65_536),
    }),
    networkAllowlist: z.array(z.string().trim().min(1)).max(64),
    capabilities: z.array(z.string().trim().min(1)).max(256),
    authRequirements: z
      .array(
        z.object({
          key: z.string().trim().min(1),
          authority: z.object({
            key: z.string().trim().min(1),
            purpose: z.enum(["vendor_identity", "model_provider", "router"]),
            issuer: z.string().url().nullable(),
            displayName: z.string().trim().min(1),
          }),
          flow: z.object({
            key: z.string().trim().min(1),
            kind: z.enum([
              "oidc_pkce",
              "oauth_pkce",
              "device_authorization",
              "api_key",
              "vendor_token_exchange",
              "provider_native_oauth",
            ]),
            publicClientId: z.string().trim().min(1).nullable(),
            audience: z.string().trim().min(1).nullable(),
            deviceBindingSupported: z.boolean(),
          }),
          requirement: z.enum(["required", "optional"]),
          portability: z.enum(["device_only", "profile_binding"]),
          runtimeDelivery: z.enum([
            "agent_state_adapter",
            "short_lived_token",
            "host_handle",
          ]),
          custodyKinds: z
            .array(
              z.enum([
                "os_vault",
                "encrypted_agent_state",
                "managed_exchange",
                "none",
              ]),
            )
            .min(1),
          scopes: z.array(
            z.object({
              name: z.string().trim().min(1),
              requirement: z.enum(["required", "optional"]),
            }),
          ),
        }),
      )
      .max(16)
      .default([]),
    models: z
      .array(
        z.object({
          id: z.string().trim().min(1),
          label: z.string().trim().min(1),
        }),
      )
      .max(128)
      .default([]),
    defaultModelId: z.string().trim().min(1).nullable().default(null),
  })
  .superRefine((release, context) => {
    if (
      release.image.platform === "linux/amd64" &&
      release.image.translation !== "rosetta"
    ) {
      context.addIssue({
        code: "custom",
        path: ["image", "translation"],
        message: "linux/amd64 requires explicit Rosetta translation on macOS",
      });
    }
    if (
      release.image.platform === "linux/arm64" &&
      release.image.translation !== "none"
    ) {
      context.addIssue({
        code: "custom",
        path: ["image", "translation"],
        message: "linux/arm64 must not enable translation",
      });
    }
    if (
      release.defaultModelId &&
      !release.models.some((model) => model.id === release.defaultModelId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["defaultModelId"],
        message: "defaultModelId must identify a declared model",
      });
    }
    const authRequirementKeys = new Set<string>();
    for (const [index, requirement] of release.authRequirements.entries()) {
      if (authRequirementKeys.has(requirement.key)) {
        context.addIssue({
          code: "custom",
          path: ["authRequirements", index, "key"],
          message: "Authentication requirement keys must be unique",
        });
      }
      authRequirementKeys.add(requirement.key);
      if (
        new Set(requirement.custodyKinds).size !==
        requirement.custodyKinds.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["authRequirements", index, "custodyKinds"],
          message: "Authentication custody kinds must be unique",
        });
      }
      const scopeNames = requirement.scopes.map((scope) => scope.name);
      if (new Set(scopeNames).size !== scopeNames.length) {
        context.addIssue({
          code: "custom",
          path: ["authRequirements", index, "scopes"],
          message: "Authentication scope names must be unique",
        });
      }
    }
  });

export type AgentReleaseDescriptor = z.infer<
  typeof AgentReleaseDescriptorSchema
>;

export function parseAgentReleaseDescriptor(
  input: unknown,
): AgentReleaseDescriptor {
  return AgentReleaseDescriptorSchema.parse(input);
}

export function immutableImageReference(
  release: AgentReleaseDescriptor,
): string {
  return `${release.image.reference}@${release.image.digest}`;
}
