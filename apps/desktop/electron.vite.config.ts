import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        include: ["@libsql/client", "drizzle-orm"],
        exclude: [
          "@curve-ai/radius-scheduler",
          "@curve-ai/radius-storage",
          "@curve-ai/radius-sync-core",
          "@curve-ai/radius-sync-protocol",
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
