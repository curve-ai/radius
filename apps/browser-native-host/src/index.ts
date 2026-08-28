import { readFileSync } from "node:fs";
import { createConnection } from "node:net";

import { frameNativeHostMessage, NativeMessageReader } from "./framing.js";

interface BridgeConfiguration {
  version: 1;
  socketPath: string;
  token: string;
  extensionId: string;
}

const configPath = process.env.RADIUS_BROWSER_BRIDGE_CONFIG?.trim();
if (!configPath) fail("RADIUS_BROWSER_BRIDGE_CONFIG is not configured");

const configuration = parseConfiguration(
  JSON.parse(readFileSync(configPath, "utf8")),
);
const callerOrigin = process.argv
  .slice(2)
  .find((value) => value.startsWith("chrome-extension://"));
const expectedOrigin = `chrome-extension://${configuration.extensionId}/`;
if (callerOrigin !== expectedOrigin) {
  fail("The browser extension origin is not authorized");
}

const socket = createConnection(configuration.socketPath);
const nativeReader = new NativeMessageReader();
let socketBuffer = "";

socket.setEncoding("utf8");
socket.once("connect", () => {
  socket.write(
    `${JSON.stringify({
      type: "authenticate",
      token: configuration.token,
      origin: callerOrigin,
    })}\n`,
  );
});
socket.on("data", (chunk: string) => {
  socketBuffer += chunk;
  if (socketBuffer.length > 2 * 1024 * 1024) {
    fail("The Radius browser bridge response is too large");
  }
  for (;;) {
    const newline = socketBuffer.indexOf("\n");
    if (newline < 0) break;
    const line = socketBuffer.slice(0, newline);
    socketBuffer = socketBuffer.slice(newline + 1);
    if (!line) continue;
    process.stdout.write(frameNativeHostMessage(JSON.parse(line)));
  }
});
socket.once("error", (error) => fail(error.message));
socket.once("close", () => process.exit(0));

process.stdin.on("data", (chunk: Buffer) => {
  try {
    for (const message of nativeReader.push(chunk)) {
      socket.write(`${JSON.stringify(message)}\n`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
});
process.stdin.once("end", () => socket.end());
process.stdin.once("error", (error) => fail(error.message));

function parseConfiguration(value: unknown): BridgeConfiguration {
  if (!value || typeof value !== "object") {
    fail("The Radius browser bridge configuration is invalid");
  }
  const item = value as Partial<BridgeConfiguration>;
  if (
    item.version !== 1 ||
    typeof item.socketPath !== "string" ||
    !item.socketPath ||
    typeof item.token !== "string" ||
    item.token.length < 32 ||
    typeof item.extensionId !== "string" ||
    !/^[a-p]{32}$/.test(item.extensionId)
  ) {
    fail("The Radius browser bridge configuration is invalid");
  }
  return item as BridgeConfiguration;
}

function fail(message: string): never {
  process.stderr.write(`[radius-browser-host] ${message}\n`);
  process.exit(1);
}
