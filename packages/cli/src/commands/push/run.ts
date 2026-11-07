import { dirname, isAbsolute, resolve } from "node:path";

import { createAgentManifest } from "@curve-ai/build";
import { RadiusPlatformClient } from "@curve-ai/platform-client";

import { loadConfigFile } from "../../config.js";
import { emitJson, type RadiusContext } from "../../context.js";
import { UsageError } from "../../errors.js";
import { handler } from "../../handler.js";
import { loadBuildReceipt, pushBuildToPlatform } from "../../platform-push.js";

interface PushFlags {
  readonly build?: string;
  readonly environment: string;
  readonly organization?: string;
  readonly config?: string;
  readonly "api-url"?: string;
  readonly token?: string;
  readonly json: boolean;
}

async function run(this: RadiusContext, flags: PushFlags): Promise<void> {
  const context = this;
  // The project is the config's own directory, as in `radius build`.
  const explicit = flags.config
    ? isAbsolute(flags.config)
      ? flags.config
      : resolve(context.cwd, flags.config)
    : null;
  const root = explicit ? dirname(explicit) : context.cwd;
  const loaded = await loadConfigFile(root, explicit);
  if (loaded.deprecation) context.note(loaded.deprecation);
  const config = loaded.config;
  if (!config.agent) {
    throw new UsageError(
      "This config has no agent id, so it cannot be uploaded. Run `radius init` to mint one.",
    );
  }

  const apiUrl = flags["api-url"] ?? context.env.RADIUS_API_URL?.trim();
  const accessToken = flags.token ?? context.env.RADIUS_ACCESS_TOKEN?.trim();
  if (!apiUrl || !accessToken) {
    throw new UsageError(
      "radius push needs the platform address and an access token. Set RADIUS_API_URL and RADIUS_ACCESS_TOKEN, or pass --api-url and --token.",
    );
  }
  let client: RadiusPlatformClient;
  try {
    // Refuses plain HTTP except to this machine.
    client = new RadiusPlatformClient({ baseUrl: apiUrl, accessToken });
  } catch (error) {
    throw new UsageError(
      `${error instanceof Error ? error.message : String(error)}: ${apiUrl}`,
    );
  }

  const receipt = await loadBuildReceipt(root, flags.build);
  context.out(
    `pushing ${config.name} build ${receipt.buildDigest.slice(0, 12)}`,
  );
  const result = await pushBuildToPlatform({
    client,
    root,
    agent: config.agent,
    receipt,
    manifest: createAgentManifest(config),
    organization: flags.organization,
    environment: flags.environment,
    onProgress: (message) => context.out(`  ${message}`),
  });

  const deployment = result.finalized.agentDeployment;
  if (context.output === "json") {
    emitJson(context, {
      organization: result.organization,
      environment: result.environment,
      buildDigest: receipt.buildDigest,
      imageReference: result.imageReference,
      imageDigest: result.imageDigest,
      deploymentId: deployment.id,
      version: deployment.version,
      state: deployment.state,
      live: false,
    });
    return;
  }
  context.out(`  version      ${deployment.version}`);
  context.out(`  deployment   ${deployment.id}`);
  context.out(`  digest       ${result.imageDigest}`);
  context.out(`  state        ${deployment.state}`);
  context.out("");
  context.out(
    "Not live yet. Promote it from the agent's page in the Radius dashboard.",
  );
}

export default handler<PushFlags, []>(run);
