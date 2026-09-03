import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pull cursors are signed so a client cannot walk another membership's change
 * log by editing the sequence it sends back.
 */
function cursorSecret(): string {
  const secret = process.env.RADIUS_SYNC_CURSOR_SECRET?.trim();
  if (!secret) throw new Error("RADIUS_SYNC_CURSOR_SECRET is required");
  return secret;
}

function signature(value: string): Buffer {
  return createHmac("sha256", cursorSecret()).update(value).digest();
}

export function encodeCursor(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("INVALID_CURSOR");
  }
  const value = String(sequence);
  return `${value}.${signature(value).toString("base64url")}`;
}

export function decodeCursor(cursor: string): number {
  const [value, encodedSignature, extra] = cursor.split(".");
  const sequence = Number(value);
  if (
    !value ||
    !encodedSignature ||
    extra ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    String(sequence) !== value
  ) {
    throw new Error("INVALID_CURSOR");
  }
  const actual = Buffer.from(encodedSignature, "base64url");
  const expected = signature(value);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("INVALID_CURSOR");
  }
  return sequence;
}
