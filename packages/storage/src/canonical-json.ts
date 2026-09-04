import { createHash } from "node:crypto";

// The canonical encoding lives in the protocol package: the desktop hashes a
// payload here and a server re-hashes it there, so a second copy of the
// encoder would be a silent way for the two to disagree.
export { canonicalJson } from "@curve-ai/radius-sync-protocol";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
