import { readFileSync } from "node:fs";

/** Read from the manifest so the two cannot drift. */
export const VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
