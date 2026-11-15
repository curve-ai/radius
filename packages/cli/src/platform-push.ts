import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import {
  AgentBuildReceiptSchema,
  type AgentBuildReceipt,
  type AgentManifest,
} from "@curve-ai/agent-contracts";
import { canonicalJson, pushAgentOciImage } from "@curve-ai/build";
import {
  RadiusPlatformError,
  type FinalizeAgentDeploymentResponse,
  type RadiusPlatformClient,
} from "@curve-ai/platform-client";

import { OperationalError, UsageError } from "./errors.js";

/** The platform calls an upload makes. */
export type PushPlatformClient = Pick<
  RadiusPlatformClient,
  "info" | "identity" | "prepareAgentDeployment" | "finalizeAgentDeployment"
>;

export interface PlatformPushResult {
  organization: string;
  environment: string;
  imageReference: string;
  imageDigest: `sha256:${string}`;
  finalized: FinalizeAgentDeploymentResponse;
}

/**
 * Reads the receipt `radius build` wrote: the named build, or the one
 * `.radius/builds/latest.json` points at.
 */
export async function loadBuildReceipt(
  root: string,
  buildDigest?: string,
): Promise<AgentBuildReceipt> {
  const builds = join(root, ".radius", "builds");
  let digest = buildDigest;
  if (digest === undefined) {
    const latest = await readJson(join(builds, "latest.json"));
    digest = (latest as { buildDigest?: unknown } | null)?.buildDigest as
      string | undefined;
    if (!digest) {
      throw new OperationalError(
        "No build to push in this project.",
        "Run `radius build` first.",
      );
    }
  }
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new UsageError(
      `--build must be a build digest (64 lowercase hex characters), not "${digest}".`,
    );
  }
  const receipt = await readJson(join(builds, digest, "receipt.json"));
  if (receipt === null) {
    throw new OperationalError(
      `No receipt for build ${digest} in this project.`,
      "Run `radius build`, or pass a --build digest listed under .radius/builds/.",
    );
  }
  return AgentBuildReceiptSchema.parse(receipt);
}

/**
 * Prepare, push with the upload's own credentials, finalize. The version is
 * not live until promoted.
 */
export async function pushBuildToPlatform(input: {
  client: PushPlatformClient;
  root: string;
  agent: string;
  receipt: AgentBuildReceipt;
  /** The manifest from the current config, to catch edits since the build. */
  manifest: AgentManifest;
  organization?: string;
  environment: string;
  onProgress?: (message: string) => void;
  pushImage?: typeof pushAgentOciImage;
}): Promise<PlatformPushResult> {
  const { client, receipt } = input;
  const progress = input.onProgress ?? (() => {});
  if (canonicalJson(receipt.manifest) !== canonicalJson(input.manifest)) {
    throw new OperationalError(
      `The agent config changed after build ${receipt.buildDigest.slice(0, 12)}.`,
      "Run `radius build` again, then `radius push`.",
    );
  }

  const info = await platform(() => client.info());
  if (
    !info.supportedAgentManifestVersions.includes(
      receipt.manifest.schemaVersion as never,
    )
  ) {
    throw new OperationalError(
      `Radius Platform ${info.platformVersion} does not accept agent manifest version ${receipt.manifest.schemaVersion}.`,
    );
  }
  const organization = input.organization ?? (await onlyOrganization(client));

  progress(`preparing upload to ${organization}/${input.environment}`);
  const prepare = (idempotencyKey: string) =>
    platform(() =>
      client.prepareAgentDeployment(
        {
          apiVersion: 1,
          organization,
          agent: input.agent,
          environment: input.environment,
          buildDigest: receipt.buildDigest,
          bundleSha256: receipt.bundleSha256,
          manifest: receipt.manifest,
        },
        idempotencyKey,
      ),
    );
  // The same build to the same place replays the same upload, so a re-run
  // does not create a second version.
  let prepared = await prepare(
    `prepare-${organization}-${receipt.buildDigest}-${input.environment}`,
  );
  // An expired upload is replaced; the new key comes from the old upload's id,
  // so a re-run replays it. Capped at 20 in case the clock is wrong.
  for (let attempt = 0; expired(prepared.credentials.expiresAt); attempt++) {
    if (attempt === 20) {
      throw new OperationalError(
        "The platform keeps returning upload credentials that have already expired.",
        "Check that this computer's clock is correct, then run `radius push` again.",
      );
    }
    prepared = await prepare(`prepare-after-${prepared.uploadId}`);
  }

  progress(`uploading ${prepared.imageReference}`);
  const layoutPath = isAbsolute(receipt.layoutPath)
    ? receipt.layoutPath
    : join(input.root, receipt.layoutPath);
  let imageDigest: `sha256:${string}`;
  try {
    imageDigest = await (input.pushImage ?? pushAgentOciImage)({
      build: { imageReference: receipt.imageReference, layoutPath },
      imageReference: prepared.imageReference,
      credentials: prepared.credentials,
    });
  } catch (error) {
    throw new OperationalError(
      `Uploading to ${prepared.credentials.registry} failed: ${errorMessage(error)}`,
      "Check that Docker is running and can reach the registry, then run `radius push` again.",
    );
  }

  progress("registering the version");
  const finalized = await platform(() =>
    client.finalizeAgentDeployment(
      input.agent,
      {
        apiVersion: 1,
        organization,
        uploadId: prepared.uploadId,
        imageDigest,
        sourceManifestDigest:
          receipt.sourceManifestDigest as `sha256:${string}`,
        bundleSha256: receipt.bundleSha256,
        sbomDigest: null,
        provenanceDigest: null,
        promote: false,
        expectedDeploymentRevision: null,
      },
      `finalize-${prepared.uploadId}-${imageDigest}`,
    ),
  );
  return {
    organization,
    environment: input.environment,
    imageReference: prepared.imageReference,
    imageDigest,
    finalized,
  };
}

// Leaves 30 seconds for the upload to start before the credentials stop working.
function expired(expiresAt: string): boolean {
  const time = Date.parse(expiresAt);
  return !Number.isFinite(time) || time <= Date.now() + 30_000;
}

async function onlyOrganization(client: PushPlatformClient): Promise<string> {
  const identity = await platform(() => client.identity());
  const [only, ...rest] = identity.organizations;
  if (!only || rest.length > 0) {
    throw new UsageError(
      "This access token belongs to more than one organization (or none). Pass --organization.",
    );
  }
  return only.slug;
}

// A platform failure is outside the CLI's control: report it with the
// platform's own message rather than as an internal error.
async function platform<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof RadiusPlatformError) {
      throw new OperationalError(`Radius Platform: ${error.message}`);
    }
    if (error instanceof TypeError) {
      throw new OperationalError(
        `Could not reach the Radius Platform: ${errorMessage(error)}`,
        "Check RADIUS_API_URL (or --api-url) and that the platform is running.",
      );
    }
    throw error;
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
