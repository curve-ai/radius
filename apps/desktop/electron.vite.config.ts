import { DesktopDistributionSchema } from "../../packages/platform-contracts/src/index";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const distributionPath = process.env.RADIUS_DISTRIBUTION_CONFIG;
const distribution = distributionPath
  ? DesktopDistributionSchema.parse(
      JSON.parse(readFileSync(distributionPath, "utf8")),
    )
  : null;
const cloudDefines = {
  __DESKTOP_DISTRIBUTION__: JSON.stringify(distribution),
  __CLOUD_URL__: JSON.stringify(
    process.env.CLOUD_URL ?? "https://app.curvehq.sh",
  ),
};

export default defineConfig({
  main: {
    define: cloudDefines,
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
    define: cloudDefines,
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
