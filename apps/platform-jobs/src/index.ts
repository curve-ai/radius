import { hostname } from "node:os";

import {
  PlatformHealthcheckPayloadSchema,
  PlatformHealthcheckResultSchema,
  RADIUS_PLATFORM_JOB_NAMES,
  VerifyAgentDeploymentPayloadSchema,
  VerifyAgentDeploymentResultSchema,
  type PlatformJobEnvelope,
} from "@curve-ai/platform-job-contracts";
import type { RegistryManifestVerifier } from "@curve-ai/platform-providers";

export interface PlatformJobProcessorOptions {
  registryVerifier: RegistryManifestVerifier;
  now?: () => Date;
  workerId?: string;
}

export function createPlatformJobProcessor(
  options: PlatformJobProcessorOptions,
): (job: PlatformJobEnvelope) => Promise<unknown> {
  const now = options.now ?? (() => new Date());
  const workerId = options.workerId?.trim() || hostname();

  return async (job) => {
    switch (job.name) {
      case RADIUS_PLATFORM_JOB_NAMES.healthcheck: {
        const payload = PlatformHealthcheckPayloadSchema.parse(job.data);
        return PlatformHealthcheckResultSchema.parse({
          ok: true,
          version: 1,
          message: payload.message ?? "BullMQ is connected",
          completedAt: now().toISOString(),
          workerId,
        });
      }
      case RADIUS_PLATFORM_JOB_NAMES.verifyAgentDeployment: {
        const payload = VerifyAgentDeploymentPayloadSchema.parse(job.data);
        const verification = await options.registryVerifier.verifyManifest({
          imageReference: payload.imageReference,
          expectedDigest: payload.expectedImageDigest as `sha256:${string}`,
        });
        return VerifyAgentDeploymentResultSchema.parse({
          ok: true,
          version: 1,
          agentDeploymentId: payload.agentDeploymentId,
          imageDigest: verification.digest,
          mediaType: verification.mediaType,
          contentLength: verification.contentLength,
          verifiedAt: now().toISOString(),
          workerId,
        });
      }
    }
  };
}
