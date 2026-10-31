/** Keep the real stdout for ACP and send everything else to stderr. */

import { Readable } from "node:stream";

export interface ProtocolStreams {
  readonly output: WritableStream<Uint8Array>;
  readonly input: ReadableStream<Uint8Array>;
}

/**
 * Detach the process stdout for protocol use.
 *
 * `process.stdout.write` is pointed at stderr, so `console.log`, loggers
 * bound to `process.stdout`, and anything else in this process that writes
 * through it cannot reach the ACP stream. `console` looks the method up on
 * each call, so this covers it too. The returned stream holds the only
 * reference to the original write.
 *
 * Unlike the Python adapter this cannot repoint file descriptor 1, which
 * Node has no API for: a child process spawned with `stdio: "inherit"` still
 * writes to the real stdout. Must run before any user module is imported.
 */
export function reserveProtocolStdout(): ProtocolStreams {
  const stdout = process.stdout;
  const write = stdout.write.bind(stdout) as (
    chunk: Uint8Array,
    callback: (error?: Error | null) => void,
  ) => boolean;
  const toStderr = process.stderr.write.bind(process.stderr);
  stdout.write = toStderr as typeof stdout.write;

  const output = new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        write(chunk, (error) => (error ? reject(error) : resolve()));
      });
    },
  });
  const input = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  return { output, input };
}
