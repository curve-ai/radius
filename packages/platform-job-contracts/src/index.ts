import { z } from "zod";

export const RADIUS_PLATFORM_JOB_VERSION = 1;
export const RADIUS_PLATFORM_JOBS_QUEUE = "radius-platform";

export const RADIUS_PLATFORM_JOB_NAMES = {
  healthcheck: "platform.healthcheck.v1",
  verifyAgentDeployment: "agent_deployment.verify.v1",
} as const;

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const agentRef = z.string().regex(/^agent_[A-Za-z0-9_-]{6,64}$/);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,240}$/);

export const PlatformHealthcheckPayloadSchema = z.object({
  version: z.literal(RADIUS_PLATFORM_JOB_VERSION),
  message: z.string().trim().min(1).max(240).optional(),
});

export const PlatformHealthcheckResultSchema = z.object({
  ok: z.literal(true),
  version: z.literal(RADIUS_PLATFORM_JOB_VERSION),
  message: z.string().trim().min(1).max(240),
  completedAt: timestamp,
  workerId: z.string().trim().min(1).max(255),
});

export const VerifyAgentDeploymentPayloadSchema = z.object({
  version: z.literal(RADIUS_PLATFORM_JOB_VERSION),
  idempotencyKey,
  organizationId: uuid,
  agent: agentRef,
  agentDeploymentId: uuid,
  imageReference: z.string().trim().min(1).max(1024),
  expectedImageDigest: sha256,
});

export const VerifyAgentDeploymentResultSchema = z.object({
  ok: z.literal(true),
  version: z.literal(RADIUS_PLATFORM_JOB_VERSION),
  agentDeploymentId: uuid,
  imageDigest: sha256,
  mediaType: z.string().trim().min(1).max(255).nullable(),
  contentLength: z.number().int().nonnegative().nullable(),
  verifiedAt: timestamp,
  workerId: z.string().trim().min(1).max(255),
});

export const PlatformJobEnvelopeSchema = z.discriminatedUnion("name", [
  z.object({
    name: z.literal(RADIUS_PLATFORM_JOB_NAMES.healthcheck),
    data: PlatformHealthcheckPayloadSchema,
  }),
  z.object({
    name: z.literal(RADIUS_PLATFORM_JOB_NAMES.verifyAgentDeployment),
    data: VerifyAgentDeploymentPayloadSchema,
  }),
]);

export type PlatformHealthcheckPayload = z.infer<
  typeof PlatformHealthcheckPayloadSchema
>;
export type PlatformHealthcheckResult = z.infer<
  typeof PlatformHealthcheckResultSchema
>;
export type VerifyAgentDeploymentPayload = z.infer<
  typeof VerifyAgentDeploymentPayloadSchema
>;
export type VerifyAgentDeploymentResult = z.infer<
  typeof VerifyAgentDeploymentResultSchema
>;
export type PlatformJobEnvelope = z.infer<typeof PlatformJobEnvelopeSchema>;
