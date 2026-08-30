import {
  canonicalJson,
  createAgentManifest,
  pushAgentOciImage,
} from "@curve-ai/build";
import {
  type FinalizeAgentDeploymentRequest,
  type FinalizeAgentDeploymentResponse,
  type PlatformInfoResponse,
  type PlatformIdentityResponse,
  type PrepareAgentDeploymentRequest,
  type PrepareAgentDeploymentResponse,
} from "@curve-ai/platform-client";

import { loadAgentConfig } from "./config.js";
import { loadBuildReceipt } from "./build.js";
import type { CliIo } from "./io.js";
import { RadiusProfileStore } from "./profiles.js";
import { resolvePlatformTarget } from "./platform-target.js";

interface DeploymentPlatformClient {
  info(signal?: AbortSignal): Promise<PlatformInfoResponse>;
  identity?(signal?: AbortSignal): Promise<PlatformIdentityResponse>;
  prepareAgentDeployment(
    request: PrepareAgentDeploymentRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<PrepareAgentDeploymentResponse>;
  finalizeAgentDeployment(
    agent: string,
    request: FinalizeAgentDeploymentRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<FinalizeAgentDeploymentResponse>;
}

import type { AgentOciBuildResult } from "./sandbox.js";

export interface DeployOptions {
  root: string;
  configPath?: string;
  buildReference?: string;
  environment?: string;
  organization?: string;
  profile?: string;
  promote?: boolean;
  expectedDeploymentRevision?: number | null;
  accessToken?: string;
  profileStore?: RadiusProfileStore;
  platformClient?: DeploymentPlatformClient;
  build?: AgentOciBuildResult;
  pushOci?: typeof pushAgentOciImage;
  io: CliIo;
}

export async function deployAgent(options: DeployOptions): Promise<void> {
  const { config } = await loadAgentConfig(options.root, options.configPath);
  const manifest = createAgentManifest(config);

  if (!config.agent) {
    throw new Error("Remote deployment requires a linked agent reference");
  }
  const loadedBuild = options.build
    ? { build: options.build, receipt: null, path: null }
    : await loadBuildReceipt(options.root, options.buildReference);
  const build = loadedBuild.build;
  if (canonicalJson(build.manifest) !== canonicalJson(manifest)) {
    throw new Error(
      "Radius config changed after the selected build; run radius build again",
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
  const info = await client.info();
  if (!info.supportedAgentManifestVersions.includes(manifest.schemaVersion)) {
    throw new Error(
      `Platform ${info.platformVersion} does not support manifest version ${manifest.schemaVersion}`,
    );
  }
  const organization =
    options.organization ?? (await inferOrganization(client));

  options.io.out(`Deploying verified build ${build.buildDigest}...`);
  const environment = options.environment ?? "production";
  const prepareKey = `prepare-${organization}-${build.buildDigest}-${environment}`;
  const prepared = await client.prepareAgentDeployment(
    {
      apiVersion: 1,
      organization,
      agent: config.agent,
      environment,
      buildDigest: build.buildDigest,
      bundleSha256: build.bundleSha256,
      manifest: build.manifest,
    },
    prepareKey,
  );
  assertCredentialsUsable(prepared.credentials.expiresAt);

  options.io.out(`Uploading ${prepared.imageReference}...`);
  const imageDigest = await (options.pushOci ?? pushAgentOciImage)({
    build,
    imageReference: prepared.imageReference,
    credentials: prepared.credentials,
  });

  const finalized = await client.finalizeAgentDeployment(
    config.agent,
    {
      apiVersion: 1,
      organization,
      uploadId: prepared.uploadId,
      imageDigest,
      sourceManifestDigest: build.imageDigest,
      bundleSha256: build.bundleSha256,
      sbomDigest: null,
      provenanceDigest: null,
      promote: options.promote ?? true,
      expectedDeploymentRevision: options.expectedDeploymentRevision ?? null,
    },
    `finalize-${prepared.uploadId}-${imageDigest}`,
  );

  options.io.out(`Deployment: ${finalized.agentDeployment.version}`);
  options.io.out(`Deployment ID: ${finalized.agentDeployment.id}`);
  options.io.out(`Digest: ${finalized.agentDeployment.imageDigest}`);
  options.io.out(`State: ${finalized.agentDeployment.state}`);
  if (finalized.environmentRevision) {
    options.io.out(
      `Environment: ${finalized.environmentRevision.environment} revision ${finalized.environmentRevision.revision}`,
    );
  }
}

async function inferOrganization(
  client: DeploymentPlatformClient,
): Promise<string> {
  if (!client.identity) {
    throw new Error("Remote deployment requires --organization");
  }
  const identity = await client.identity();
  if (identity.organizations.length !== 1) {
    throw new Error(
      "--organization is required when the credential belongs to multiple organizations",
    );
  }
  return identity.organizations[0]!.slug;
}

function assertCredentialsUsable(expiresAt: string): void {
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now() + 30_000) {
    throw new Error("Registry upload credentials expire too soon");
  }
}

export type { AgentOciBuildResult, DeploymentPlatformClient };
