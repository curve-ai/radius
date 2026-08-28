import {
  type AgentEnvironmentChangeResponse,
  type PromoteAgentDeploymentRequest,
  type RollbackAgentDeploymentRequest,
} from "@curve-ai/platform-client";

import { loadAgentConfig } from "./config.js";
import type { CliIo } from "./io.js";
import { RadiusProfileStore } from "./profiles.js";
import { resolvePlatformTarget } from "./platform-target.js";

interface DeploymentPlatformClient {
  promoteAgentDeployment(
    agent: string,
    environment: string,
    request: PromoteAgentDeploymentRequest,
    idempotencyKey: string,
  ): Promise<AgentEnvironmentChangeResponse>;
  rollbackAgentDeployment(
    agent: string,
    environment: string,
    request: RollbackAgentDeploymentRequest,
    idempotencyKey: string,
  ): Promise<AgentEnvironmentChangeResponse>;
}

export interface ChangeAgentDeploymentOptions {
  action: "promote" | "rollback";
  root: string;
  agentDeploymentId: string;
  environment?: string;
  expectedDeploymentRevision?: number | null;
  configPath?: string;
  profile?: string;
  accessToken?: string;
  profileStore?: RadiusProfileStore;
  platformClient?: DeploymentPlatformClient;
  io: CliIo;
}

export async function changeAgentDeployment(
  options: ChangeAgentDeploymentOptions,
): Promise<void> {
  const { config } = await loadAgentConfig(options.root, options.configPath);
  if (!config.agent) {
    throw new Error("Promotion and rollback require a linked agent reference");
  }
  const environment = options.environment ?? "production";
  const expectedRevision = options.expectedDeploymentRevision ?? null;
  if (options.action === "rollback" && expectedRevision === null) {
    throw new Error("Rollback requires --expected-revision");
  }
  const client =
    options.platformClient ??
    (
      await resolvePlatformTarget({
        profile: options.profile,
        accessToken: options.accessToken,
        profileStore: options.profileStore,
      })
    ).client;
  const idempotencyKey = [
    options.action,
    config.agent,
    environment,
    options.agentDeploymentId,
    expectedRevision ?? 0,
  ].join(":");
  const response =
    options.action === "promote"
      ? await client.promoteAgentDeployment(
          config.agent,
          environment,
          {
            apiVersion: 1,
            agentDeploymentId: options.agentDeploymentId,
            expectedDeploymentRevision: expectedRevision,
          },
          idempotencyKey,
        )
      : await client.rollbackAgentDeployment(
          config.agent,
          environment,
          {
            apiVersion: 1,
            agentDeploymentId: options.agentDeploymentId,
            expectedDeploymentRevision: expectedRevision as number,
          },
          idempotencyKey,
        );

  options.io.out(
    `${options.action === "promote" ? "Promoted" : "Rolled back to"} deployment ${response.environmentRevision.agentDeploymentId}`,
  );
  options.io.out(
    `Environment: ${response.environmentRevision.environment} revision ${response.environmentRevision.revision}`,
  );
  if (response.environmentRevision.previousAgentDeploymentId) {
    options.io.out(
      `Previous deployment: ${response.environmentRevision.previousAgentDeploymentId}`,
    );
  }
}

export type { DeploymentPlatformClient };
