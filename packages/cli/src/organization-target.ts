import type { RadiusPlatformClient } from "@curve-ai/platform-client";

import { resolvePlatformTarget } from "./platform-target.js";
import { RadiusProfileStore } from "./profiles.js";

export async function resolveOrganizationTarget(options: {
  organization?: string;
  profile?: string;
  accessToken?: string;
  store?: RadiusProfileStore;
}): Promise<{ client: RadiusPlatformClient; organization: string }> {
  const { client } = await resolvePlatformTarget({
    profile: options.profile,
    accessToken: options.accessToken,
    profileStore: options.store,
  });
  const identity = await client.identity();
  if (options.organization) {
    if (
      !identity.organizations.some(
        (organization) => organization.slug === options.organization,
      )
    ) {
      throw new Error(
        `Organization ${options.organization} is not available to this credential`,
      );
    }
    return { client, organization: options.organization };
  }
  if (identity.organizations.length !== 1) {
    throw new Error(
      "--organization is required when the credential belongs to multiple organizations",
    );
  }
  return { client, organization: identity.organizations[0]!.slug };
}
