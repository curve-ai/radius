import { createHash } from "node:crypto";

import type { JsonValue } from "./index.js";

/**
 * The one canonical encoding both sides of sync hash.
 *
 * A writer hashes the payload it is about to send and a reader re-hashes the
 * payload it received, so the two implementations must agree byte for byte.
 * They agree by being the same function: this module is the only copy.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Canonical JSON requires finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(",")}}`;
}

export function payloadSha256(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
