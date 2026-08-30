import { createServer, type Server } from "node:http";

import {
  createNodeHttpHandler,
  createNodeWebSocketUpgradeHandler,
} from "@agentclientprotocol/sdk/experimental/node";
import { AcpServer } from "@agentclientprotocol/sdk/experimental/server";
import { WebSocketServer } from "ws";

import type { RadiusAgent } from "./index.js";

export interface RadiusAgentDevelopmentServerOptions {
  hostname?: string;
  port?: number;
  path?: string;
  authorization?: string | null;
}

export interface RadiusAgentDevelopmentServer {
  endpoint: string;
  close(): Promise<void>;
}

export async function serveDevelopmentAgent(
  agent: RadiusAgent,
  options: RadiusAgentDevelopmentServerOptions = {},
): Promise<RadiusAgentDevelopmentServer> {
  const hostname = options.hostname ?? "127.0.0.1";
  if (!isLoopbackHost(hostname)) {
    throw new Error("Radius development agents must listen on loopback");
  }
  const route = normalizeAcpPath(options.path ?? "/acp");
  const acpServer = new AcpServer({ agent: agent.app });
  const httpHandler = createNodeHttpHandler(acpServer);
  const webSocketServer = new WebSocketServer({ noServer: true });
  const upgrade = createNodeWebSocketUpgradeHandler(acpServer, webSocketServer);
  const httpServer = createServer((request, response) => {
    if (
      !requestMatches(request.url, route) ||
      !authorized(request.headers.authorization, options.authorization)
    ) {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not Found");
      return;
    }
    httpHandler(request, response);
  });
  httpServer.on("upgrade", (request, socket, head) => {
    if (
      !requestMatches(request.url, route) ||
      !authorized(request.headers.authorization, options.authorization)
    ) {
      socket.destroy();
      return;
    }
    upgrade(request, socket, head);
  });
  await listen(httpServer, options.port ?? 7331, hostname);
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Radius development agent did not bind a TCP address");
  }
  return {
    endpoint: `ws://${formatHost(hostname)}:${address.port}${route}`,
    close: async () => {
      await acpServer.close();
      await closeWebSocketServer(webSocketServer);
      await closeHttpServer(httpServer);
    },
  };
}

function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

function normalizeAcpPath(value: string): string {
  const route = value.startsWith("/") ? value : `/${value}`;
  if (route.includes("?") || route.includes("#")) {
    throw new Error("ACP development path cannot contain a query or fragment");
  }
  return route;
}

function requestMatches(url: string | undefined, route: string): boolean {
  return new URL(url ?? "/", "http://127.0.0.1").pathname === route;
}

function authorized(
  actual: string | undefined,
  expected: string | null | undefined,
): boolean {
  return !expected || actual === expected;
}

function formatHost(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[")
    ? `[${hostname}]`
    : hostname;
}

async function listen(
  server: Server,
  port: number,
  hostname: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) client.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function closeHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
