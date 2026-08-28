import { AgentManifestSchema } from "@curve-ai/agent-contracts";
import { z } from "zod";

export const RADIUS_PLATFORM_API_VERSION = 1;

const uuid = z.string().uuid();
const nonempty = z.string().trim().min(1);
const timestamp = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const rawSha256 = z.string().regex(/^[a-f0-9]{64}$/);
const agentRef = z.string().regex(/^agent_[A-Za-z0-9_-]{6,64}$/);
const slug = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);
const cursor = z.string().trim().min(1).max(512).nullable();

export const DEVELOPER_TOKEN_SCOPES = [
  "organization.admin",
  "agent.read",
  "agent.write",
  "deployment.read",
  "deployment.write",
  "installation.read",
  "installation.write",
  "token.admin",
] as const;

export const DeveloperTokenScopeSchema = z.enum(DEVELOPER_TOKEN_SCOPES);

export const PlatformInfoResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  platformVersion: nonempty,
  deploymentModes: z.array(z.enum(["managed", "self_hosted"])).min(1),
  supportedAgentConfigVersions: z.array(z.literal(1)).min(1),
  supportedAgentManifestVersions: z.array(z.literal(1)).min(1),
  registryUpload: z.literal(true),
});

export const PLATFORM_ORGANIZATION_ROLES = [
  "owner",
  "admin",
  "developer",
  "viewer",
] as const;

export const PlatformOrganizationRoleSchema = z.enum(
  PLATFORM_ORGANIZATION_ROLES,
);

export const OrganizationMembershipLifecycleSchema = z.enum([
  "active",
  "suspended",
  "removed",
]);

export const PlatformOrganizationSummarySchema = z.object({
  id: uuid,
  slug,
  displayName: z.string().trim().min(1).max(120),
  role: PlatformOrganizationRoleSchema,
});

export const OrganizationMembershipSummarySchema = z.object({
  id: uuid,
  accountId: uuid,
  displayName: z.string().trim().min(1).max(120).nullable(),
  email: z.string().email().max(320).nullable(),
  role: PlatformOrganizationRoleSchema,
  lifecycleState: OrganizationMembershipLifecycleSchema,
  joinedAt: timestamp,
  updatedAt: timestamp,
  developerTokenCount: z.number().int().nonnegative(),
  current: z.boolean(),
});

export const ListOrganizationMembershipsResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  organization: slug,
  memberships: z.array(OrganizationMembershipSummarySchema),
});

export const UpdateOrganizationMembershipRequestSchema = z
  .object({
    apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
    role: PlatformOrganizationRoleSchema.optional(),
    lifecycleState: OrganizationMembershipLifecycleSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.role === undefined && request.lifecycleState === undefined) {
      context.addIssue({
        code: "custom",
        message: "A role or lifecycle state change is required",
      });
    }
  });

export const UpdateOrganizationMembershipResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  organization: slug,
  membership: OrganizationMembershipSummarySchema,
});

export const PlatformIdentityResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  accountId: uuid,
  organizations: z.array(PlatformOrganizationSummarySchema),
});

export const DeveloperTokenSummarySchema = z.object({
  id: uuid,
  label: z.string().trim().min(1).max(120),
  prefix: z.string().min(4).max(32),
  scopes: z.array(DeveloperTokenScopeSchema),
  createdAt: timestamp,
  lastUsedAt: timestamp.nullable(),
  expiresAt: timestamp.nullable(),
  revokedAt: timestamp.nullable(),
  current: z.boolean(),
});

export const ListDeveloperTokensResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  organization: slug,
  tokens: z.array(DeveloperTokenSummarySchema),
});

export const CreateDeveloperTokenRequestSchema = z
  .object({
    apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
    label: z.string().trim().min(1).max(120),
    scopes: z.array(DeveloperTokenScopeSchema).min(1).max(8),
    expiresAt: timestamp.nullable(),
  })
  .superRefine((request, context) => {
    if (new Set(request.scopes).size !== request.scopes.length) {
      context.addIssue({
        code: "custom",
        path: ["scopes"],
        message: "Developer-token scopes must be unique",
      });
    }
  });

export const CreateDeveloperTokenResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  token: DeveloperTokenSummarySchema,
  secret: z.string().regex(/^radius_pat_[A-Za-z0-9_-]{43}$/),
});

export const RevokeDeveloperTokenRequestSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
});

export const RevokeDeveloperTokenResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  token: DeveloperTokenSummarySchema,
});

export const AgentSummarySchema = z.object({
  agent: agentRef,
  name: z.string().trim().min(1).max(120),
  environments: z.array(
    z.object({
      name: slug,
      deployment: z
        .object({
          revision: z.number().int().positive(),
          agentDeploymentVersion: nonempty,
          imageDigest: sha256,
          state: z.enum(["verified", "quarantined"]),
        })
        .nullable(),
    }),
  ),
});

export const ListAgentsResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  organization: slug,
  agents: z.array(AgentSummarySchema),
});

export const PrepareAgentDeploymentRequestSchema = z
  .object({
    apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
    organization: slug,
    agent: agentRef,
    environment: slug,
    buildDigest: rawSha256,
    bundleSha256: rawSha256,
    manifest: AgentManifestSchema,
  })
  .superRefine((request, context) => {
    if (request.manifest.agent !== request.agent) {
      context.addIssue({
        code: "custom",
        path: ["manifest", "agent"],
        message: "Manifest agent must match the requested agent",
      });
    }
  });

export const PrepareAgentDeploymentResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  uploadId: uuid,
  imageReference: nonempty,
  credentials: z.object({
    registry: nonempty,
    username: nonempty,
    password: nonempty,
    expiresAt: timestamp,
  }),
});

export const FinalizeAgentDeploymentRequestSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  organization: slug,
  uploadId: uuid,
  imageDigest: sha256,
  sourceManifestDigest: sha256,
  bundleSha256: rawSha256,
  sbomDigest: sha256.nullable(),
  provenanceDigest: sha256.nullable(),
  promote: z.boolean(),
  expectedDeploymentRevision: z.number().int().positive().nullable(),
});

export const FinalizeAgentDeploymentResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  agentDeployment: z.object({
    id: uuid,
    version: nonempty,
    imageDigest: sha256,
    state: z.enum(["verified", "quarantined"]),
  }),
  environmentRevision: z
    .object({
      environment: slug,
      revision: z.number().int().positive(),
      agentDeploymentId: uuid,
    })
    .nullable(),
});

export const PromoteAgentDeploymentRequestSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  agentDeploymentId: uuid,
  expectedDeploymentRevision: z.number().int().positive().nullable(),
});

export const RollbackAgentDeploymentRequestSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  agentDeploymentId: uuid,
  expectedDeploymentRevision: z.number().int().positive(),
});

export const AgentEnvironmentChangeResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  environmentRevision: z.object({
    environment: slug,
    revision: z.number().int().positive(),
    agentDeploymentId: uuid,
    previousAgentDeploymentId: uuid.nullable(),
  }),
});

export const AgentDeploymentSummarySchema = z.object({
  id: uuid,
  version: nonempty,
  imageDigest: sha256,
  sourceManifestDigest: sha256,
  sbomDigest: sha256.nullable(),
  provenanceDigest: sha256.nullable(),
  minimumDesktopVersion: nonempty,
  runtimeProtocolVersion: z.number().int().positive(),
  state: z.enum(["verified", "quarantined"]),
  createdAt: timestamp,
});

export const ListAgentDeploymentsResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  agent: agentRef,
  agentDeployments: z.array(AgentDeploymentSummarySchema),
  nextCursor: cursor,
});

export const AgentEnvironmentRevisionSummarySchema = z.object({
  revision: z.number().int().positive(),
  action: z.enum(["deploy", "promote", "rollback", "revoke"]),
  agentDeploymentId: uuid.nullable(),
  agentDeploymentVersion: nonempty.nullable(),
  imageDigest: sha256.nullable(),
  previousAgentDeploymentId: uuid.nullable(),
  createdAt: timestamp,
});

export const ListAgentEnvironmentHistoryResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  agent: agentRef,
  environment: slug,
  currentRevision: z.number().int().nonnegative(),
  revisions: z.array(AgentEnvironmentRevisionSummarySchema),
  nextCursor: cursor,
});

export const RegisterClientInstallationRequestSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  organization: slug,
  clientInstanceId: uuid,
  physicalDevice: z.object({
    fingerprint: sha256,
    displayName: z.string().trim().min(1).max(120),
    assetTag: z.string().trim().min(1).max(120).nullable(),
    platform: z.string().trim().min(1).max(64),
    architecture: z.string().trim().min(1).max(64),
  }),
  observation: z
    .object({
      clientEventId: uuid,
      schemaVersion: z.literal(1),
      desktopVersion: nonempty,
      runtimeVersion: nonempty,
      runtimeProtocolVersion: z.number().int().positive(),
      state: z.enum(["ready", "degraded", "update_required", "error"]),
      errorCode: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]{1,127}$/)
        .nullable(),
      observedAt: timestamp,
    })
    .superRefine((observation, context) => {
      const requiresError = observation.state === "error";
      if (requiresError !== (observation.errorCode !== null)) {
        context.addIssue({
          code: "custom",
          path: ["errorCode"],
          message: "Only error observations require an error code",
        });
      }
    }),
});

export const RegisterClientInstallationResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  physicalDeviceId: uuid,
  clientInstallationId: uuid,
});

export const ReportAgentInstallationRequestSchema = z
  .object({
    apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
    agentDeploymentId: uuid,
    clientEventId: uuid,
    schemaVersion: z.literal(1),
    state: z.enum([
      "installing",
      "ready",
      "failed",
      "retained",
      "removed",
      "blocked_incompatible",
    ]),
    errorCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,127}$/)
      .nullable(),
    observedAt: timestamp,
  })
  .superRefine((observation, context) => {
    const requiresError = ["failed", "blocked_incompatible"].includes(
      observation.state,
    );
    if (requiresError !== (observation.errorCode !== null)) {
      context.addIssue({
        code: "custom",
        path: ["errorCode"],
        message:
          "Failed and incompatible observations require an error code; other states forbid one",
      });
    }
  });

export const ReportAgentInstallationResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  agentInstallationId: uuid,
  observationId: uuid,
});

const ClientInstallationObservationSummarySchema = z.object({
  desktopVersion: nonempty,
  runtimeVersion: nonempty,
  runtimeProtocolVersion: z.number().int().positive(),
  state: z.enum(["ready", "degraded", "update_required", "error"]),
  errorCode: nonempty.nullable(),
  observedAt: timestamp,
});

const AgentInstallationSummarySchema = z.object({
  id: uuid,
  agent: agentRef,
  lifecycleState: z.enum(["active", "removed"]),
  latestObservation: z
    .object({
      agentDeploymentId: uuid,
      agentDeploymentVersion: nonempty,
      state: z.enum([
        "installing",
        "ready",
        "failed",
        "retained",
        "removed",
        "blocked_incompatible",
      ]),
      errorCode: nonempty.nullable(),
      observedAt: timestamp,
    })
    .nullable(),
});

const ClientInstallationSummarySchema = z.object({
  id: uuid,
  clientInstanceId: uuid,
  lifecycleState: z.enum(["active", "suspended", "removed"]),
  latestObservation: ClientInstallationObservationSummarySchema.nullable(),
  agentInstallations: z.array(AgentInstallationSummarySchema),
});

export const ListInstallationsResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  organization: slug,
  physicalDevices: z.array(
    z.object({
      id: uuid,
      displayName: nonempty,
      assetTag: nonempty.nullable(),
      platform: nonempty,
      architecture: nonempty,
      lifecycleState: z.enum(["active", "suspended", "retired", "lost"]),
      clientInstallations: z.array(ClientInstallationSummarySchema),
    }),
  ),
});

export const PlatformErrorResponseSchema = z.object({
  apiVersion: z.literal(RADIUS_PLATFORM_API_VERSION),
  error: z.object({
    code: nonempty,
    message: nonempty,
    requestId: nonempty.nullable(),
  }),
});

export type PlatformInfoResponse = z.infer<typeof PlatformInfoResponseSchema>;
export type PlatformIdentityResponse = z.infer<
  typeof PlatformIdentityResponseSchema
>;
export type PlatformOrganizationRole = z.infer<
  typeof PlatformOrganizationRoleSchema
>;
export type OrganizationMembershipLifecycle = z.infer<
  typeof OrganizationMembershipLifecycleSchema
>;
export type OrganizationMembershipSummary = z.infer<
  typeof OrganizationMembershipSummarySchema
>;
export type ListOrganizationMembershipsResponse = z.infer<
  typeof ListOrganizationMembershipsResponseSchema
>;
export type UpdateOrganizationMembershipRequest = z.infer<
  typeof UpdateOrganizationMembershipRequestSchema
>;
export type UpdateOrganizationMembershipResponse = z.infer<
  typeof UpdateOrganizationMembershipResponseSchema
>;
export type DeveloperTokenScope = z.infer<typeof DeveloperTokenScopeSchema>;
export type DeveloperTokenSummary = z.infer<typeof DeveloperTokenSummarySchema>;
export type ListDeveloperTokensResponse = z.infer<
  typeof ListDeveloperTokensResponseSchema
>;
export type CreateDeveloperTokenRequest = z.infer<
  typeof CreateDeveloperTokenRequestSchema
>;
export type CreateDeveloperTokenResponse = z.infer<
  typeof CreateDeveloperTokenResponseSchema
>;
export type RevokeDeveloperTokenRequest = z.infer<
  typeof RevokeDeveloperTokenRequestSchema
>;
export type RevokeDeveloperTokenResponse = z.infer<
  typeof RevokeDeveloperTokenResponseSchema
>;
export type AgentSummary = z.infer<typeof AgentSummarySchema>;
export type ListAgentsResponse = z.infer<typeof ListAgentsResponseSchema>;
export type PrepareAgentDeploymentRequest = z.infer<
  typeof PrepareAgentDeploymentRequestSchema
>;
export type PrepareAgentDeploymentResponse = z.infer<
  typeof PrepareAgentDeploymentResponseSchema
>;
export type FinalizeAgentDeploymentRequest = z.infer<
  typeof FinalizeAgentDeploymentRequestSchema
>;
export type FinalizeAgentDeploymentResponse = z.infer<
  typeof FinalizeAgentDeploymentResponseSchema
>;
export type PromoteAgentDeploymentRequest = z.infer<
  typeof PromoteAgentDeploymentRequestSchema
>;
export type RollbackAgentDeploymentRequest = z.infer<
  typeof RollbackAgentDeploymentRequestSchema
>;
export type AgentEnvironmentChangeResponse = z.infer<
  typeof AgentEnvironmentChangeResponseSchema
>;
export type AgentDeploymentSummary = z.infer<
  typeof AgentDeploymentSummarySchema
>;
export type ListAgentDeploymentsResponse = z.infer<
  typeof ListAgentDeploymentsResponseSchema
>;
export type AgentEnvironmentRevisionSummary = z.infer<
  typeof AgentEnvironmentRevisionSummarySchema
>;
export type ListAgentEnvironmentHistoryResponse = z.infer<
  typeof ListAgentEnvironmentHistoryResponseSchema
>;
export type RegisterClientInstallationRequest = z.infer<
  typeof RegisterClientInstallationRequestSchema
>;
export type RegisterClientInstallationResponse = z.infer<
  typeof RegisterClientInstallationResponseSchema
>;
export type ReportAgentInstallationRequest = z.infer<
  typeof ReportAgentInstallationRequestSchema
>;
export type ReportAgentInstallationResponse = z.infer<
  typeof ReportAgentInstallationResponseSchema
>;
export type ListInstallationsResponse = z.infer<
  typeof ListInstallationsResponseSchema
>;
export type PlatformErrorResponse = z.infer<typeof PlatformErrorResponseSchema>;
