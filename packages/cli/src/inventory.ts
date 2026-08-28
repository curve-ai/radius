import {
  type ListAgentEnvironmentHistoryResponse,
  type ListAgentDeploymentsResponse,
  type PlatformPageOptions,
} from "@curve-ai/platform-client";

import { loadAgentConfig } from "./config.js";
import type { CliIo } from "./io.js";
import { RadiusProfileStore } from "./profiles.js";
import { resolvePlatformTarget } from "./platform-target.js";

interface InventoryPlatformClient {
  listAgentDeployments(
    agent: string,
    page?: PlatformPageOptions,
  ): Promise<ListAgentDeploymentsResponse>;
  listAgentEnvironmentHistory(
    agent: string,
    environment: string,
    page?: PlatformPageOptions,
  ): Promise<ListAgentEnvironmentHistoryResponse>;
}

interface InventoryOptions {
  root: string;
  configPath?: string;
  profile?: string;
  accessToken?: string;
  limit?: number;
  cursor?: string;
  json?: boolean;
  profileStore?: RadiusProfileStore;
  platformClient?: InventoryPlatformClient;
  io: CliIo;
}

export async function showAgentDeployments(
  options: InventoryOptions,
): Promise<void> {
  const { agent, client } = await resolveInventoryContext(options);
  const response = await client.listAgentDeployments(
    agent,
    pageOptions(options),
  );
  if (options.json) {
    options.io.out(JSON.stringify(response, null, 2));
    return;
  }
  if (response.agentDeployments.length === 0) {
    options.io.out(`No deployments for ${agent}.`);
  }
  for (const agentDeployment of response.agentDeployments) {
    options.io.out(
      [
        agentDeployment.version,
        agentDeployment.id,
        agentDeployment.state,
        agentDeployment.imageDigest,
        agentDeployment.createdAt,
      ].join("\t"),
    );
  }
  if (response.nextCursor)
    options.io.out(`Next cursor: ${response.nextCursor}`);
}

export async function showAgentEnvironmentHistory(
  options: InventoryOptions & { environment?: string },
): Promise<void> {
  const { agent, client } = await resolveInventoryContext(options);
  const environment = options.environment ?? "production";
  const response = await client.listAgentEnvironmentHistory(
    agent,
    environment,
    pageOptions(options),
  );
  if (options.json) {
    options.io.out(JSON.stringify(response, null, 2));
    return;
  }
  options.io.out(
    `${agent} ${environment}: current revision ${response.currentRevision}`,
  );
  if (response.revisions.length === 0) {
    options.io.out("No environment revisions.");
  }
  for (const revision of response.revisions) {
    options.io.out(
      [
        `r${revision.revision}`,
        revision.action,
        revision.agentDeploymentVersion ?? "revoked",
        revision.agentDeploymentId ?? "-",
        revision.createdAt,
      ].join("\t"),
    );
  }
  if (response.nextCursor)
    options.io.out(`Next cursor: ${response.nextCursor}`);
}

async function resolveInventoryContext(options: InventoryOptions): Promise<{
  agent: string;
  client: InventoryPlatformClient;
}> {
  const { config } = await loadAgentConfig(options.root, options.configPath);
  if (!config.agent) {
    throw new Error(
      "Deployment and environment inventory require a linked agent reference",
    );
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
  return { agent: config.agent, client };
}

function pageOptions(options: InventoryOptions): PlatformPageOptions {
  return {
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
  };
}

export type { InventoryPlatformClient };
