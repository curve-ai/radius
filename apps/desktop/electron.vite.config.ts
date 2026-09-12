import { DesktopDistributionSchema } from "../../packages/platform-contracts/src/index";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  DEFAULT_DESKTOP_PLATFORM_URL,
  resolveDesktopPlatformUrl,
} from "./src/main/distribution";

const distributionPath = process.env.RADIUS_DISTRIBUTION_CONFIG;
const distribution = distributionPath
  ? DesktopDistributionSchema.parse(
      JSON.parse(readFileSync(distributionPath, "utf8")),
    )
  : null;
const platformUrl = resolveDesktopPlatformUrl(
  process.env.RADIUS_PLATFORM_URL ??
    distribution?.platformUrl ??
    DEFAULT_DESKTOP_PLATFORM_URL,
);
const bundleDefines = {
  __DESKTOP_DISTRIBUTION__: JSON.stringify(distribution),
  __DESKTOP_PLATFORM_URL__: JSON.stringify(platformUrl),
};

export default defineConfig({
  main: {
    define: bundleDefines,
    build: {
      externalizeDeps: {
        include: ["@libsql/client", "drizzle-orm"],
        exclude: [
          "@curve-ai/platform-client",
          "@curve-ai/platform-contracts",
          "@curve-ai/radius-browser-protocol",
          "@curve-ai/radius-browser-tools",
          "@curve-ai/radius-connector-protocol",
          "@curve-ai/radius-mcp-connector",
          "@curve-ai/radius-scheduler",
          "@curve-ai/radius-storage",
          "@curve-ai/radius-runtime",
          "@curve-ai/radius-sync-core",
          "@curve-ai/radius-sync-protocol",
          "@curve-ai/radius-tool-broker",
        ],
      },
    },
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
