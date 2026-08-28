import { RadiusPlatformClient, type PlatformIdentityResponse } from "@curve-ai/platform-client";

import {
  NativeRadiusCredentialStore,
  type RadiusCredentialStore,
} from "./credential-store.js";
import type { CliIo } from "./io.js";
import { RadiusProfileStore } from "./profiles.js";

export async function loginToRadius(options: {
  profile?: string;
  apiUrl?: string;
  token: string;
  profileStore?: RadiusProfileStore;
  credentialStore?: RadiusCredentialStore;
  fetch?: typeof globalThis.fetch;
  io: CliIo;
}): Promise<PlatformIdentityResponse> {
  const token = options.token.trim();
  if (!token) throw new Error("Radius access token is required");
  const profiles = options.profileStore ?? new RadiusProfileStore();
  if (options.apiUrl) {
    if (!options.profile) {
      throw new Error("--profile is required with --api-url");
    }
    await profiles.add(options.profile, options.apiUrl);
  }
  const target = await profiles.resolve(options.profile);
  const identity = await new RadiusPlatformClient({
    baseUrl: target.apiUrl,
    accessToken: token,
    fetch: options.fetch,
  }).identity();
  await (options.credentialStore ?? new NativeRadiusCredentialStore()).set(target, token);
  options.io.out(`Logged in to Radius profile ${target.name}`);
  options.io.out(`Account: ${identity.accountId}`);
  for (const organization of identity.organizations) {
    options.io.out(`${organization.slug}\t${organization.role}\t${organization.displayName}`);
  }
  return identity;
}

export async function logoutFromRadius(options: {
  profile?: string;
  profileStore?: RadiusProfileStore;
  credentialStore?: RadiusCredentialStore;
  io: CliIo;
}): Promise<boolean> {
  const target = await (options.profileStore ?? new RadiusProfileStore()).resolve(
    options.profile,
  );
  const deleted = await (
    options.credentialStore ?? new NativeRadiusCredentialStore()
  ).delete(target);
  options.io.out(
    deleted
      ? `Logged out of Radius profile ${target.name}`
      : `No stored credential for Radius profile ${target.name}`,
  );
  return deleted;
}
