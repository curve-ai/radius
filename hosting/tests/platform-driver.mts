/**
 * Drives the Platform API for tests/integration.sh.
 *
 * The integration test checks the self-hosted stack, not a CLI, so it calls the
 * public client directly. `deploy` uploads the latest build receipt in the
 * current directory without rebuilding it. Takes RADIUS_API_URL and
 * RADIUS_ACCESS_TOKEN from the environment; any API refusal exits non-zero.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  AgentBuildReceiptSchema,
  type AgentBuildReceipt,
} from "@curve-ai/agent-contracts";
import { pushAgentOciImage } from "@curve-ai/build";
import {
  RadiusPlatformClient,
  type OrganizationMembershipLifecycle,
  type PlatformOrganizationRole,
} from "@curve-ai/platform-client";

const LIFECYCLE: Record<string, OrganizationMembershipLifecycle> = {
  suspend: "suspended",
  restore: "active",
  remove: "removed",
};

const client = new RadiusPlatformClient({
  baseUrl: requireEnv("RADIUS_API_URL"),
  accessToken: requireEnv("RADIUS_ACCESS_TOKEN"),
});
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    organization: { type: "string" },
    environment: { type: "string" },
    role: { type: "string" },
  },
});
const [command, action, membershipId] = positionals;

if (command === "members" && action === "list") {
  const memberships = await client.listOrganizationMemberships(organization());
  console.log(JSON.stringify(memberships));
} else if (command === "members" && action && membershipId) {
  await client.updateOrganizationMembership(
    organization(),
    membershipId,
    {
      apiVersion: 1,
      ...(action === "role"
        ? { role: values.role as PlatformOrganizationRole }
        : { lifecycleState: LIFECYCLE[action] }),
    },
    `membership.update.${randomUUID()}`,
  );
} else if (command === "deploy") {
  await deploy();
} else if (command === "deployments" && action === "list") {
  const { manifest } = await latestReceipt();
  console.log(
    JSON.stringify(await client.listAgentDeployments(agentOf(manifest))),
  );
} else {
  throw new Error(`Unknown platform-driver command: ${positionals.join(" ")}`);
}

async function deploy(): Promise<void> {
  const receipt = await latestReceipt();
  const agent = agentOf(receipt.manifest);
  const prepared = await client.prepareAgentDeployment(
    {
      apiVersion: 1,
      organization: organization(),
      agent,
      environment: values.environment ?? "production",
      buildDigest: receipt.buildDigest,
      bundleSha256: receipt.bundleSha256,
      manifest: receipt.manifest,
    },
    `prepare-${randomUUID()}`,
  );
  const imageDigest = await pushAgentOciImage({
    build: {
      imageReference: receipt.imageReference,
      layoutPath: resolve(receipt.layoutPath),
    },
    imageReference: prepared.imageReference,
    credentials: prepared.credentials,
  });
  const { agentDeployment } = await client.finalizeAgentDeployment(
    agent,
    {
      apiVersion: 1,
      organization: organization(),
      uploadId: prepared.uploadId,
      imageDigest,
      sourceManifestDigest: receipt.sourceManifestDigest,
      bundleSha256: receipt.bundleSha256,
      sbomDigest: null,
      provenanceDigest: null,
      promote: true,
      expectedDeploymentRevision: null,
    },
    `finalize-${prepared.uploadId}-${imageDigest}`,
  );
  console.log(`Deployment ID: ${agentDeployment.id}`);
  console.log(`Digest: ${agentDeployment.imageDigest}`);
}

async function latestReceipt(): Promise<AgentBuildReceipt> {
  const builds = join(".radius", "builds");
  const { buildDigest } = JSON.parse(
    await readFile(join(builds, "latest.json"), "utf8"),
  ) as { buildDigest: string };
  return AgentBuildReceiptSchema.parse(
    JSON.parse(
      await readFile(join(builds, buildDigest, "receipt.json"), "utf8"),
    ),
  );
}

function agentOf(manifest: AgentBuildReceipt["manifest"]): string {
  if (!manifest.agent) throw new Error("The build receipt names no agent");
  return manifest.agent;
}

function organization(): string {
  if (!values.organization) throw new Error("--organization is required");
  return values.organization;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
