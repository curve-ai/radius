export interface RegistryManifestVerificationRequest {
  imageReference: string;
  expectedDigest: `sha256:${string}`;
}

export interface RegistryManifestVerificationResult {
  digest: `sha256:${string}`;
  mediaType: string | null;
  contentLength: number | null;
}

export interface RegistryManifestVerifier {
  verifyManifest(
    request: RegistryManifestVerificationRequest,
  ): Promise<RegistryManifestVerificationResult>;
}

export type RegistryVerificationErrorCode =
  | "INVALID_REFERENCE"
  | "REGISTRY_NOT_ALLOWED"
  | "AUTHENTICATION_REQUIRED"
  | "MANIFEST_NOT_FOUND"
  | "DIGEST_MISMATCH"
  | "REGISTRY_UNAVAILABLE";

export class RegistryVerificationError extends Error {
  constructor(
    readonly code: RegistryVerificationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RegistryVerificationError";
  }
}

export interface DistributionRegistryVerifierOptions {
  allowedRegistries: readonly string[];
  insecureRegistries?: readonly string[];
  registryEndpoints?: Readonly<Record<string, string>>;
  authorizationForRegistry?: (
    registry: string,
  ) => Promise<string | undefined> | string | undefined;
  fetch?: typeof globalThis.fetch;
  allowInsecureLoopback?: boolean;
}

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

export function createDistributionRegistryVerifier(
  options: DistributionRegistryVerifierOptions,
): RegistryManifestVerifier {
  const fetcher = options.fetch ?? globalThis.fetch;
  const allowed = new Set(options.allowedRegistries.map(normalizeRegistry));
  const explicitlyInsecure = new Set(
    (options.insecureRegistries ?? []).map(normalizeRegistry),
  );
  const endpoints = new Map(
    Object.entries(options.registryEndpoints ?? {}).map(([registry, endpoint]) => [
      normalizeRegistry(registry),
      normalizeRegistry(endpoint),
    ]),
  );
  if (allowed.size === 0) {
    throw new Error("At least one registry must be allowlisted");
  }

  return {
    async verifyManifest(request) {
      const parsed = parseImageReference(request.imageReference);
      if (!allowed.has(parsed.registry)) {
        throw new RegistryVerificationError(
          "REGISTRY_NOT_ALLOWED",
          `Registry ${parsed.registry} is not allowlisted`,
        );
      }
      const loopback = isLoopbackRegistry(parsed.registry);
      const endpoint = endpoints.get(parsed.registry) ?? parsed.registry;
      const insecure =
        loopback ||
        explicitlyInsecure.has(parsed.registry) ||
        explicitlyInsecure.has(endpoint);
      if (loopback && !options.allowInsecureLoopback) {
        throw new RegistryVerificationError(
          "REGISTRY_NOT_ALLOWED",
          "Loopback registry HTTP requires explicit development opt-in",
        );
      }
      const authorization = await options.authorizationForRegistry?.(
        parsed.registry,
      );
      let response: Response;
      try {
        response = await fetcher(
          `${insecure ? "http" : "https"}://${endpoint}/v2/${parsed.repository}/manifests/${request.expectedDigest}`,
          {
            method: "HEAD",
            headers: {
              accept: MANIFEST_ACCEPT,
              ...(authorization ? { authorization } : {}),
            },
          },
        );
      } catch (error) {
        throw new RegistryVerificationError(
          "REGISTRY_UNAVAILABLE",
          "Registry request failed",
          { cause: error },
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new RegistryVerificationError(
          "AUTHENTICATION_REQUIRED",
          "Registry rejected the configured worker identity",
        );
      }
      if (response.status === 404) {
        throw new RegistryVerificationError(
          "MANIFEST_NOT_FOUND",
          "Registry does not contain the expected manifest digest",
        );
      }
      if (!response.ok) {
        throw new RegistryVerificationError(
          "REGISTRY_UNAVAILABLE",
          `Registry returned HTTP ${response.status}`,
        );
      }

      const reportedDigest = response.headers.get("docker-content-digest");
      if (reportedDigest && reportedDigest !== request.expectedDigest) {
        throw new RegistryVerificationError(
          "DIGEST_MISMATCH",
          "Registry reported a different manifest digest",
        );
      }
      const contentLengthHeader = response.headers.get("content-length");
      const contentLength = contentLengthHeader
        ? Number.parseInt(contentLengthHeader, 10)
        : null;

      return {
        digest: request.expectedDigest,
        mediaType: response.headers.get("content-type"),
        contentLength:
          contentLength !== null && Number.isSafeInteger(contentLength)
            ? contentLength
            : null,
      };
    },
  };
}

function parseImageReference(imageReference: string): {
  registry: string;
  repository: string;
} {
  const trimmed = imageReference.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0) {
    throw new RegistryVerificationError(
      "INVALID_REFERENCE",
      "Image reference must include an explicit registry and repository",
    );
  }
  const registry = normalizeRegistry(trimmed.slice(0, slash));
  let repository = trimmed.slice(slash + 1);
  const at = repository.indexOf("@");
  if (at >= 0) repository = repository.slice(0, at);
  const lastSlash = repository.lastIndexOf("/");
  const colon = repository.lastIndexOf(":");
  if (colon > lastSlash) repository = repository.slice(0, colon);
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/i.test(repository)) {
    throw new RegistryVerificationError(
      "INVALID_REFERENCE",
      "Image repository is invalid",
    );
  }
  return { registry, repository };
}

function normalizeRegistry(registry: string): string {
  const normalized = registry.trim().toLowerCase();
  if (
    !/^(?:\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::\d{1,5})?$/.test(
      normalized,
    )
  ) {
    throw new RegistryVerificationError(
      "INVALID_REFERENCE",
      "Registry host is invalid",
    );
  }
  return normalized;
}

function isLoopbackRegistry(registry: string): boolean {
  const host = registry.replace(/:\d+$/, "");
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
}
