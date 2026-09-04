import "server-only";

import {
  RadiusPlatformClient,
  RadiusPlatformError,
} from "@curve-ai/platform-client";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { PlatformWebAuthMode } from "./platform-auth";
import { PLATFORM_ORGANIZATION_COOKIE } from "./platform-auth";

export type { PlatformWebAuthMode } from "./platform-auth";

export function platformApiUrl(): string {
  return process.env.RADIUS_PLATFORM_API_URL?.trim() || "http://127.0.0.1:3100";
}

async function requestOrigin(): Promise<{ host: string; protocol: string }> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  if (!host) throw new Error("Shared Platform requests require a host");
  const protocol =
    requestHeaders.get("x-forwarded-proto") ||
    (host.includes("localhost") ? "http" : "https");
  return { host, protocol };
}

export async function platformPublicApiUrl(): Promise<string> {
  const configured = process.env.RADIUS_PLATFORM_PUBLIC_API_URL?.trim();
  if (configured) return configured;
  if (process.env.RADIUS_PLATFORM_SHARED_ORIGINS === "true") {
    const { host, protocol } = await requestOrigin();
    return `${protocol}://${host}`;
  }
  return platformApiUrl();
}

export function platformWebAuthMode(): PlatformWebAuthMode {
  const mode = process.env.RADIUS_PLATFORM_AUTH_MODE?.trim() || "browser-session";
  if (mode !== "browser-session" && mode !== "development-token") {
    throw new Error("RADIUS_PLATFORM_AUTH_MODE must be browser-session or development-token");
  }
  return mode;
}

export function platformServerClient(): RadiusPlatformClient {
  const accessToken = process.env.RADIUS_PLATFORM_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    throw new Error(
      "RADIUS_PLATFORM_ACCESS_TOKEN is required in development-token mode",
    );
  }
  return new RadiusPlatformClient({
    baseUrl: platformApiUrl(),
    accessToken,
    allowInsecureHttp:
      process.env.RADIUS_PLATFORM_ALLOW_INSECURE_API === "true",
  });
}

export const getPlatformContext = cache(async () => {
  const mode = platformWebAuthMode();
  let client: RadiusPlatformClient;
  let identity;
  if (mode === "development-token") {
    client = platformServerClient();
    identity = await client.identity();
  } else {
    // Shared origins: the API derives the organization from the origin the
    // browser used, so forward it while talking to the API over the private
    // address. The organization host need not resolve from this server.
    const forwarded =
      process.env.RADIUS_PLATFORM_SHARED_ORIGINS === "true"
        ? await requestOrigin()
        : undefined;
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.toString();
    client = new RadiusPlatformClient({
      baseUrl: platformApiUrl(),
      cookie: cookieHeader,
      headers: forwarded
        ? {
            "x-forwarded-host": forwarded.host,
            "x-forwarded-proto": forwarded.protocol,
          }
        : undefined,
      allowInsecureHttp:
        process.env.RADIUS_PLATFORM_ALLOW_INSECURE_API === "true",
    });
    try {
      identity = await client.browserSessionIdentity();
    } catch (error) {
      if (error instanceof RadiusPlatformError && error.status === 401) {
        redirect("/login?return_to=/workspace");
      }
      if (
        error instanceof RadiusPlatformError &&
        error.status === 503 &&
        error.code === "OIDC_NOT_CONFIGURED"
      ) {
        redirect("/login?error=not_configured");
      }
      throw error;
    }
  }
  const selectedOrganization =
    (await cookies()).get(PLATFORM_ORGANIZATION_COOKIE)?.value;
  const organization =
    identity.organizations.find(
      (candidate) => candidate.slug === selectedOrganization,
    ) ?? identity.organizations[0];
  return {
    client,
    info: await client.info(),
    identity,
    organization,
    authMode: mode,
  };
});
