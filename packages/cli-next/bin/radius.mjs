#!/usr/bin/env node
/**
 * The entry point `npm link` / `bun link` installs.
 *
 * Runs the TypeScript sources directly rather than a build output, so a
 * linked CLI reflects an edit the moment it is saved — the thing a developer
 * working on Radius actually wants. `dist/bin.js` stays the entry point for a
 * published package, where starting fast matters more than reloading.
 *
 * Its reason for existing is narrower than it looks: without it, trying the
 * CLI meant hand-writing a shell script into ~/.local/bin that hardcoded a
 * repo path and a Node version. That is not an install, it is a workaround
 * everyone copies slightly differently.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const source = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "bin.ts");

try {
  const { tsImport } = await import("tsx/esm/api");
  await tsImport(source, import.meta.url);
} catch (error) {
  if (error?.code === "ERR_MODULE_NOT_FOUND" && /tsx/.test(String(error.message))) {
    process.stderr.write(
      "This CLI runs from source and needs its dependencies installed.\n" +
        "Run `bun install` in the Radius checkout, then try again.\n",
    );
    process.exit(70);
  }
  throw error;
}
