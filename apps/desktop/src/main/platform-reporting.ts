import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";

import { RadiusPlatformClient } from "@curve-ai/platform-client";
import { app } from "electron";

import type { StorageContext } from "./storage";

const REPORT_TIMEOUT_MS = 15_000;

interface PlatformReportingConfig {
  apiUrl: string;
  accessToken: string;
  organization: string;
  allowInsecureHttp: boolean;
}

export async function reportPlatformClientInstallation(
  context: StorageContext,
): Promise<void> {
  const config = platformReportingConfig(process.env);
  if (!config) return;

  const client = new RadiusPlatformClient({
    baseUrl: config.apiUrl,
    accessToken: config.accessToken,
    allowInsecureHttp: config.allowInsecureHttp,
  });
  const clientEventId = randomUUID();
  const desktopVersion = app.getVersion();
  await client.registerClientInstallation(
    context.vault.clientInstanceId,
    {
      apiVersion: 1,
      organization: config.organization,
      clientInstanceId: context.vault.clientInstanceId,
      physicalDevice: {
        fingerprint: platformDeviceFingerprint(context.vault.publicKeyJwk),
        displayName: hostname().trim() || "Radius device",
        assetTag: null,
        platform: process.platform,
        architecture: process.arch,
      },
      observation: {
        clientEventId,
        schemaVersion: 1,
        desktopVersion,
        runtimeVersion:
          process.env.RADIUS_RUNTIME_VERSION?.trim() || desktopVersion,
        runtimeProtocolVersion: 1,
        state: "ready",
        errorCode: null,
        observedAt: new Date().toISOString(),
      },
    },
    `client-installation:${clientEventId}`,
    AbortSignal.timeout(REPORT_TIMEOUT_MS),
  );
}

export function platformReportingConfig(
  environment: NodeJS.ProcessEnv,
): PlatformReportingConfig | null {
  const apiUrl = environment.RADIUS_PLATFORM_API_URL?.trim();
  const accessToken = environment.RADIUS_PLATFORM_ACCESS_TOKEN?.trim();
  const organization = environment.RADIUS_PLATFORM_ORGANIZATION?.trim();
  const configured = [apiUrl, accessToken, organization].filter(Boolean).length;
  if (configured === 0) return null;
  if (configured !== 3) {
    throw new Error(
      "RADIUS_PLATFORM_API_URL, RADIUS_PLATFORM_ACCESS_TOKEN, and RADIUS_PLATFORM_ORGANIZATION must be configured together",
    );
  }
  return {
    apiUrl: apiUrl!,
    accessToken: accessToken!,
    organization: organization!,
    allowInsecureHttp:
      environment.RADIUS_PLATFORM_ALLOW_INSECURE_API === "true",
  };
}

export function platformDeviceFingerprint(publicKeyJwk: JsonWebKey): string {
  const canonicalKey = Object.fromEntries(
    Object.entries(publicKeyJwk).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalKey))
    .digest("hex")}`;
}
