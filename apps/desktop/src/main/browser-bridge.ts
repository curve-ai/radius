import {
  isBrowserBridgeEvent,
  isBrowserBridgeHello,
  isBrowserBridgeResponse,
  RADIUS_BROWSER_EXTENSION_ID,
  RADIUS_BROWSER_NATIVE_HOST,
  type BrowserBridgeOperation,
  type BrowserBridgeRequest,
  type BrowserProfileSummary,
} from "@curve-ai/radius-browser-protocol";
import type { BrowserToolBridge } from "@curve-ai/radius-browser-tools";
import { app, BrowserWindow, shell } from "electron";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";

import type { BrowserConnectionStatus } from "../radius-api";

const STATUS_CHANNEL = "radius:browser-status-changed";
const MAX_BRIDGE_LINE_BYTES = 64 * 1024 * 1024;

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ExtensionConnection {
  socket: Socket;
  profile: BrowserProfileSummary;
  buffer: string;
  controlledTabs: number;
}

interface BridgeConfiguration {
  version: 1;
  socketPath: string;
  token: string;
  extensionId: string;
}

class DesktopBrowserBridge implements BrowserToolBridge {
  readonly #pending = new Map<string, PendingRequest>();
  #server: Server | null = null;
  #connection: ExtensionConnection | null = null;
  #token = "";
  #socketPath = "";
  #extensionPath = "";
  #lastError: string | null = null;

  async start(): Promise<void> {
    if (process.platform !== "darwin" || this.#server) return;
    const browserRoot = path.join(app.getPath("userData"), "browser");
    await mkdir(browserRoot, { recursive: true, mode: 0o700 });
    this.#socketPath = path.join(browserRoot, "bridge.sock");
    await rm(this.#socketPath, { force: true });
    this.#token = randomBytes(32).toString("base64url");
    const configPath = path.join(browserRoot, "bridge.json");
    const configuration: BridgeConfiguration = {
      version: 1,
      socketPath: this.#socketPath,
      token: this.#token,
      extensionId: RADIUS_BROWSER_EXTENSION_ID,
    };
    await writeFile(configPath, JSON.stringify(configuration), {
      encoding: "utf8",
      mode: 0o600,
    });
    this.#extensionPath = browserExtensionPath();
    await registerNativeMessagingHost(configPath, browserRoot);

    this.#server = createServer((socket) => this.#accept(socket));
    await new Promise<void>((resolve, reject) => {
      this.#server?.once("error", reject);
      this.#server?.listen(this.#socketPath, () => {
        this.#server?.off("error", reject);
        resolve();
      });
    });
    await chmod(this.#socketPath, 0o600);
    this.#lastError = null;
    this.#emitStatus();
  }

  async stop(): Promise<void> {
    this.#connection?.socket.destroy();
    this.#connection = null;
    for (const request of this.#pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error("BROWSER_BRIDGE_STOPPED"));
    }
    this.#pending.clear();
    const server = this.#server;
    this.#server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (this.#socketPath) await rm(this.#socketPath, { force: true });
  }

  status(): BrowserConnectionStatus {
    if (process.platform !== "darwin") {
      return {
        state: "unsupported",
        extensionId: RADIUS_BROWSER_EXTENSION_ID,
        profile: null,
        controlledTabs: 0,
        errorCode: "BROWSER_PLATFORM_UNSUPPORTED",
      };
    }
    const connection = this.#connection;
    return {
      state: connection
        ? connection.profile.enabled
          ? "connected"
          : "paused"
        : this.#lastError
          ? "error"
          : "waiting_for_extension",
      extensionId: RADIUS_BROWSER_EXTENSION_ID,
      profile: connection
        ? {
            id: connection.profile.profileId,
            label: connection.profile.browserName,
          }
        : null,
      controlledTabs: connection?.controlledTabs ?? 0,
      errorCode: this.#lastError,
    };
  }

  async revealExtension(): Promise<boolean> {
    if (!this.#extensionPath) this.#extensionPath = browserExtensionPath();
    const error = await shell.openPath(this.#extensionPath);
    return error === "";
  }

  async request(
    operation: BrowserBridgeOperation,
    input: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<unknown> {
    const connection = this.#connection;
    if (!connection) throw new Error("BROWSER_EXTENSION_NOT_CONNECTED");
    if (!connection.profile.enabled) throw new Error("BROWSER_ACCESS_PAUSED");
    const id = randomUUID();
    const request: BrowserBridgeRequest = {
      type: "request",
      id,
      operation,
      input,
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        options.signal?.removeEventListener("abort", abort);
        reject(new Error("BROWSER_EXTENSION_TIMEOUT"));
      }, options.timeoutMs ?? 30_000);
      const abort = (): void => {
        clearTimeout(timeout);
        this.#pending.delete(id);
        reject(
          options.signal?.reason ?? new Error("BROWSER_REQUEST_CANCELLED"),
        );
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      this.#pending.set(id, {
        resolve: (value) => {
          options.signal?.removeEventListener("abort", abort);
          resolve(value);
        },
        reject: (error) => {
          options.signal?.removeEventListener("abort", abort);
          reject(error);
        },
        timeout,
      });
      connection.socket.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) return;
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        clearTimeout(pending.timeout);
        pending.reject(error);
      });
    });
  }

  #accept(socket: Socket): void {
    socket.setEncoding("utf8");
    let authenticated = false;
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_BRIDGE_LINE_BYTES) {
        socket.destroy(new Error("BROWSER_BRIDGE_MESSAGE_TOO_LARGE"));
        return;
      }
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          socket.destroy(new Error("BROWSER_BRIDGE_MESSAGE_INVALID"));
          return;
        }
        if (!authenticated) {
          authenticated = this.#authenticate(socket, message);
          if (!authenticated) socket.destroy();
          continue;
        }
        this.#handleMessage(socket, message);
      }
    });
    socket.once("error", (error) => {
      this.#lastError = error.message.slice(0, 200);
      this.#emitStatus();
    });
    socket.once("close", () => {
      if (this.#connection?.socket === socket) {
        this.#connection = null;
        for (const pending of this.#pending.values()) {
          clearTimeout(pending.timeout);
          pending.reject(new Error("BROWSER_EXTENSION_DISCONNECTED"));
        }
        this.#pending.clear();
        this.#emitStatus();
      }
    });
  }

  #authenticate(socket: Socket, message: unknown): boolean {
    if (!message || typeof message !== "object") return false;
    const value = message as Record<string, unknown>;
    return (
      value.type === "authenticate" &&
      value.token === this.#token &&
      value.origin === `chrome-extension://${RADIUS_BROWSER_EXTENSION_ID}/` &&
      socket.remoteAddress === undefined
    );
  }

  #handleMessage(socket: Socket, message: unknown): void {
    if (isBrowserBridgeHello(message)) {
      if (this.#connection && this.#connection.socket !== socket) {
        this.#connection.socket.destroy();
      }
      this.#connection = {
        socket,
        profile: message.profile,
        buffer: "",
        controlledTabs: 0,
      };
      this.#lastError = null;
      this.#emitStatus();
      return;
    }
    if (isBrowserBridgeResponse(message)) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error || "BROWSER_REQUEST_FAILED"));
      return;
    }
    if (!isBrowserBridgeEvent(message)) return;
    const connection = this.#connection;
    if (!connection || connection.socket !== socket) return;
    if (message.event === "tab.changed" && message.data.controlled === true) {
      connection.controlledTabs += 1;
    }
    if (
      message.event === "tab.closed" ||
      message.event === "control.released"
    ) {
      connection.controlledTabs = Math.max(0, connection.controlledTabs - 1);
    }
    if (
      message.event === "profile.changed" &&
      typeof message.data.enabled === "boolean"
    ) {
      connection.profile.enabled = message.data.enabled;
    }
    this.#emitStatus();
  }

  #emitStatus(): void {
    const status = this.status();
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(STATUS_CHANNEL, status);
    }
  }
}

export const browserBridge = new DesktopBrowserBridge();

export async function initializeBrowserBridge(): Promise<void> {
  await browserBridge.start();
}

export function getBrowserConnectionStatus(): BrowserConnectionStatus {
  return browserBridge.status();
}

export async function revealBrowserExtension(): Promise<boolean> {
  return browserBridge.revealExtension();
}

export async function stopBrowserBridge(): Promise<void> {
  await browserBridge.stop();
}

export const BROWSER_STATUS_CHANNEL = STATUS_CHANNEL;

function browserExtensionPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "browser-extension")
    : path.resolve(app.getAppPath(), "../browser-extension/dist");
}

function browserNativeHostScriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "browser-native-host/index.cjs")
    : path.resolve(app.getAppPath(), "../browser-native-host/dist/index.cjs");
}

async function registerNativeMessagingHost(
  configPath: string,
  browserRoot: string,
): Promise<void> {
  const wrapperPath = path.join(browserRoot, "native-host.sh");
  const wrapper = [
    "#!/bin/sh",
    `export RADIUS_BROWSER_BRIDGE_CONFIG=${shellQuote(configPath)}`,
    `export ELECTRON_RUN_AS_NODE=1`,
    `exec ${shellQuote(process.execPath)} ${shellQuote(
      browserNativeHostScriptPath(),
    )} "$@"`,
    "",
  ].join("\n");
  await writeFile(wrapperPath, wrapper, { encoding: "utf8", mode: 0o700 });
  await chmod(wrapperPath, 0o700);
  const manifest = JSON.stringify({
    name: RADIUS_BROWSER_NATIVE_HOST,
    description: "Radius authenticated browser bridge",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${RADIUS_BROWSER_EXTENSION_ID}/`],
  });
  const applicationSupport = path.join(
    os.homedir(),
    "Library/Application Support",
  );
  for (const relative of [
    "Google/Chrome/NativeMessagingHosts",
    "Microsoft Edge/NativeMessagingHosts",
  ]) {
    const directory = path.join(applicationSupport, relative);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(directory, `${RADIUS_BROWSER_NATIVE_HOST}.json`),
      manifest,
      { encoding: "utf8", mode: 0o600 },
    );
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
