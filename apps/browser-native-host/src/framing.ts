const MAX_EXTENSION_MESSAGE_BYTES = 64 * 1024 * 1024;
const MAX_HOST_MESSAGE_BYTES = 1024 * 1024;

export class NativeMessageReader {
  #buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const messages: unknown[] = [];
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32LE(0);
      if (length === 0 || length > MAX_EXTENSION_MESSAGE_BYTES) {
        throw new Error("BROWSER_NATIVE_MESSAGE_SIZE_INVALID");
      }
      if (this.#buffer.length < 4 + length) break;
      const payload = this.#buffer.subarray(4, 4 + length);
      this.#buffer = this.#buffer.subarray(4 + length);
      messages.push(JSON.parse(payload.toString("utf8")));
    }
    return messages;
  }
}

export function frameNativeHostMessage(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length === 0 || payload.length > MAX_HOST_MESSAGE_BYTES) {
    throw new Error("BROWSER_NATIVE_RESPONSE_SIZE_INVALID");
  }
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}
