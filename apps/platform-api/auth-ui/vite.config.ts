import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/auth-ui/",
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../platform-web", import.meta.url)),
      "@geist-regular": join(
        dirname(require.resolve("geist/font/sans")),
        "fonts/geist-sans/Geist-Regular.woff2",
      ),
    },
  },
  esbuild: { jsx: "automatic" },
  build: { outDir: "../dist/auth-ui", emptyOutDir: true },
});
