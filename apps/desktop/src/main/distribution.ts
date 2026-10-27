import {
  DesktopDistributionSchema,
  type DesktopDistribution,
} from "@curve-ai/platform-contracts";
import { validatedPlatformUrl } from "./platform-endpoint";

declare const __DESKTOP_DISTRIBUTION__: unknown;

export function readDistribution(): DesktopDistribution | null {
  const input =
    typeof __DESKTOP_DISTRIBUTION__ === "undefined"
      ? null
      : __DESKTOP_DISTRIBUTION__;
  if (input === null) return null;
  const config = DesktopDistributionSchema.parse(input);
  config.platformUrl = validatedPlatformUrl(config.platformUrl).href;
  return config;
}
