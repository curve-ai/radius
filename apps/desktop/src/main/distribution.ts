import {
  DesktopDistributionSchema,
  type DesktopDistribution,
} from "@curve-ai/platform-contracts";
import { validatedPlatformUrl } from "./platform-endpoint";

declare const __DESKTOP_DISTRIBUTION__: unknown;
declare const __DESKTOP_PLATFORM_URL__: unknown;

export const DEFAULT_DESKTOP_PLATFORM_URL = "http://localhost:3100/";

export function resolveDesktopPlatformUrl(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Desktop bundle Platform URL must be a string");
  }
  return validatedPlatformUrl(value).href;
}

/** Every desktop bundle has one immutable Platform origin. */
export function readDesktopPlatformUrl(): string {
  const input =
    typeof __DESKTOP_PLATFORM_URL__ === "undefined"
      ? DEFAULT_DESKTOP_PLATFORM_URL
      : __DESKTOP_PLATFORM_URL__;
  return resolveDesktopPlatformUrl(input);
}

export function readDistribution(): DesktopDistribution | null {
  const input =
    typeof __DESKTOP_DISTRIBUTION__ === "undefined"
      ? null
      : __DESKTOP_DISTRIBUTION__;
  if (input === null) return null;
  const config = DesktopDistributionSchema.parse(input);
  config.platformUrl = resolveDesktopPlatformUrl(config.platformUrl);
  return config;
}
