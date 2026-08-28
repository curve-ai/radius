import { RadiusPlatformClient } from "@curve-ai/platform-client";

import { resolvePlatformAccessToken } from "./credential-store.js";
import { RadiusProfileStore } from "./profiles.js";

export async function resolvePlatformTarget(options: {
  profile?: string;
  accessToken?: string;
  profileStore?: RadiusProfileStore;
}): Promise<{
  client: RadiusPlatformClient;
  target: Awaited<ReturnType<RadiusProfileStore["resolve"]>>;
}> {
  const target = await (
    options.profileStore ?? new RadiusProfileStore()
  ).resolve(options.profile);
  return {
    target,
    client: new RadiusPlatformClient({
      baseUrl: target.apiUrl,
      accessToken: await resolvePlatformAccessToken(
        target,
        options.accessToken,
      ),
    }),
  };
}
