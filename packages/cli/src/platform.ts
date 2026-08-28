import { RadiusPlatformClient } from "@curve-ai/platform-client";

import type { CliIo } from "./io.js";
import { resolvePlatformTarget } from "./platform-target.js";
import { RadiusProfileStore } from "./profiles.js";

export async function showPlatformInfo(options: {
  profile?: string;
  store?: RadiusProfileStore;
  io: CliIo;
}): Promise<void> {
  const target = await (options.store ?? new RadiusProfileStore()).resolve(
    options.profile,
  );
  const info = await new RadiusPlatformClient({
    baseUrl: target.apiUrl,
  }).info();
  options.io.out(`Profile: ${target.name}`);
  options.io.out(`API: ${target.apiUrl}`);
  options.io.out(`Platform version: ${info.platformVersion}`);
  options.io.out(`Deployment modes: ${info.deploymentModes.join(", ")}`);
}

export async function showIdentity(options: {
  profile?: string;
  accessToken?: string;
  store?: RadiusProfileStore;
  io: CliIo;
}): Promise<void> {
  const { client, target } = await resolvePlatformTarget({
    profile: options.profile,
    accessToken: options.accessToken,
    profileStore: options.store,
  });
  const identity = await client.identity();
  options.io.out(`Profile: ${target.name}`);
  options.io.out(`Account: ${identity.accountId}`);
  for (const organization of identity.organizations) {
    options.io.out(
      `${organization.slug}\t${organization.role}\t${organization.displayName}`,
    );
  }
}
