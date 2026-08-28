import {
  createDistributionRegistryVerifier,
  RegistryVerificationError,
  type RegistryManifestVerificationResult,
  type RegistryManifestVerifier,
} from "@curve-ai/platform-providers";

import { PlatformApiError } from "./app.js";

export type PlatformRegistryFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function createPlatformRegistryVerifier(options: {
  registry: string;
  registryVerification: string;
  allowInsecureRegistryVerification: boolean;
  username: string;
  password: string;
  fetch?: PlatformRegistryFetch;
}): RegistryManifestVerifier {
  const verificationIsLoopback = isLoopbackRegistry(
    options.registryVerification,
  );
  const verifier = createDistributionRegistryVerifier({
    allowedRegistries: [options.registry],
    registryEndpoints:
      options.registryVerification === options.registry
        ? undefined
        : { [options.registry]: options.registryVerification },
    insecureRegistries:
      options.allowInsecureRegistryVerification || verificationIsLoopback
        ? [options.registry, options.registryVerification]
        : [],
    allowInsecureLoopback:
      options.allowInsecureRegistryVerification ||
      isLoopbackRegistry(options.registry),
    authorizationForRegistry: () =>
      `Basic ${Buffer.from(`${options.username}:${options.password}`).toString("base64")}`,
    fetch: options.fetch as typeof globalThis.fetch | undefined,
  });

  return {
    async verifyManifest(request): Promise<RegistryManifestVerificationResult> {
      try {
        return await verifier.verifyManifest(request);
      } catch (error) {
        if (
          error instanceof RegistryVerificationError &&
          error.code === "DIGEST_MISMATCH"
        ) {
          throw new PlatformApiError(
            409,
            "REGISTRY_DIGEST_MISMATCH",
            "Registry reported a different image digest",
          );
        }
        if (
          error instanceof RegistryVerificationError &&
          error.code === "REGISTRY_UNAVAILABLE" &&
          error.cause instanceof Error
        ) {
          throw error.cause;
        }
        throw new PlatformApiError(
          409,
          "REGISTRY_MANIFEST_MISSING",
          "Registry does not contain the finalized image digest",
        );
      }
    },
  };
}

function isLoopbackRegistry(registry: string): boolean {
  const host = registry.replace(/:\d+$/, "");
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
}
