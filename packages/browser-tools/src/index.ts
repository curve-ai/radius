import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

import {
  isRecord,
  type BrowserBridgeOperation,
} from "@curve-ai/radius-browser-protocol";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const GUEST_HOST = "192.168.64.1";
const GUEST_ADDRESS = "192.168.64.2";
const TOOL_TIMEOUT_MS = 30_000;

export interface BrowserToolBridge {
  request(
    operation: BrowserBridgeOperation,
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<unknown>;
}

export interface BrowserToolAuthorization {
  authorize(
    operation: BrowserBridgeOperation,
    input: Record<string, unknown>,
  ): boolean | Promise<boolean>;
}

export interface BrowserToolServer {
  url: string;
  localUrl: string;
  headers: Array<{ name: string; value: string }>;
  close(): Promise<void>;
}

export async function startBrowserToolServer(
  bridge: BrowserToolBridge,
  authorization: BrowserToolAuthorization,
): Promise<BrowserToolServer> {
  const token = randomBytes(32).toString("base64url");
  const handler = createMcpHandler(() =>
    createBrowserMcpServer(bridge, authorization),
  );
  const nodeHandler = toNodeHandler(handler);
  let server: Server;
  server = createServer((request, response) => {
    const remoteAddress = normalizeAddress(request.socket.remoteAddress);
    if (remoteAddress !== GUEST_ADDRESS && remoteAddress !== "127.0.0.1") {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (request.headers.origin) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      response
        .writeHead(401, { "www-authenticate": "Bearer" })
        .end("Unauthorized");
      return;
    }
    if (!request.url?.startsWith("/mcp")) {
      response.writeHead(404).end("Not found");
      return;
    }
    void nodeHandler(request, response);
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 64;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    await handler.close();
    throw new Error("BROWSER_TOOL_SERVER_ADDRESS_UNAVAILABLE");
  }
  const port = address.port;
  return {
    url: `http://${GUEST_HOST}:${port}/mcp`,
    localUrl: `http://127.0.0.1:${port}/mcp`,
    headers: [{ name: "Authorization", value: `Bearer ${token}` }],
    async close() {
      await handler.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function createBrowserMcpServer(
  bridge: BrowserToolBridge,
  authorization: BrowserToolAuthorization,
): McpServer {
  const server = new McpServer({ name: "radius-browser", version: "0.0.1" });

  server.registerTool(
    "browser_tabs_list",
    {
      description:
        "List usable tabs in the Chrome profile connected to Radius. The result contains titles, URLs, active state, and opaque tab IDs.",
      inputSchema: z.object({}),
    },
    async () =>
      textResult(await callBridge(bridge, authorization, "tabs.list", {})),
  );
  server.registerTool(
    "browser_tabs_create",
    {
      description:
        "Create a normal tab in the connected Chrome profile. The tab shares that profile's authenticated website state.",
      inputSchema: z.object({
        url: z.string().max(8_192).optional(),
        active: z.boolean().optional(),
      }),
    },
    async (input) =>
      textResult(await callBridge(bridge, authorization, "tabs.create", input)),
  );
  server.registerTool(
    "browser_tabs_activate",
    {
      description:
        "Bring one connected Chrome tab to the foreground. Use only when the user needs to see or take over the tab.",
      inputSchema: z.object({ tabId: tabIdSchema }),
    },
    async (input) =>
      textResult(
        await callBridge(bridge, authorization, "tabs.activate", input),
      ),
  );
  server.registerTool(
    "browser_tabs_close",
    {
      description: "Close one Chrome tab by its opaque Radius tab ID.",
      inputSchema: z.object({ tabId: tabIdSchema }),
    },
    async (input) =>
      textResult(await callBridge(bridge, authorization, "tabs.close", input)),
  );
  server.registerTool(
    "browser_navigate",
    {
      description:
        "Navigate a connected Chrome tab to an HTTP or HTTPS URL. Existing authentication in the Chrome profile remains available.",
      inputSchema: z.object({
        tabId: tabIdSchema,
        url: z.string().min(1).max(8_192),
      }),
    },
    async (input) =>
      textResult(
        await callBridge(bridge, authorization, "page.navigate", input),
      ),
  );
  server.registerTool(
    "browser_snapshot",
    {
      description:
        "Read the visible accessibility structure of a Chrome tab. Interactive and meaningful elements include page-scoped references for later actions.",
      inputSchema: z.object({ tabId: tabIdSchema }),
    },
    async (input) => {
      const result = await callBridge(
        bridge,
        authorization,
        "page.snapshot",
        input,
      );
      if (!isRecord(result) || typeof result.snapshot !== "string") {
        throw new Error("BROWSER_SNAPSHOT_INVALID");
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `${tabHeader(result.tab)}\n\n${result.snapshot}`.slice(
              0,
              300 * 1024,
            ),
          },
        ],
      };
    },
  );
  server.registerTool(
    "browser_click",
    {
      description:
        "Click a current element reference from browser_snapshot, or a viewport coordinate when the page has no usable accessibility target.",
      inputSchema: z
        .object({
          tabId: tabIdSchema,
          ref: z.string().min(1).max(80).optional(),
          x: z.number().finite().nonnegative().optional(),
          y: z.number().finite().nonnegative().optional(),
        })
        .refine(
          (value) =>
            Boolean(value.ref) ||
            (typeof value.x === "number" && typeof value.y === "number"),
          { message: "Provide either ref or both x and y" },
        ),
    },
    async (input) =>
      textResult(await callBridge(bridge, authorization, "page.click", input)),
  );
  server.registerTool(
    "browser_type",
    {
      description:
        "Replace the value of a current editable element reference and optionally submit it with Enter.",
      inputSchema: z.object({
        tabId: tabIdSchema,
        ref: z.string().min(1).max(80),
        text: z.string().max(100_000),
        submit: z.boolean().optional(),
      }),
    },
    async (input) =>
      textResult(await callBridge(bridge, authorization, "page.type", input)),
  );
  server.registerTool(
    "browser_key",
    {
      description:
        "Press one supported navigation or editing key in a connected Chrome tab.",
      inputSchema: z.object({
        tabId: tabIdSchema,
        key: z.string().min(1).max(40),
      }),
    },
    async (input) =>
      textResult(await callBridge(bridge, authorization, "page.key", input)),
  );
  server.registerTool(
    "browser_scroll",
    {
      description:
        "Scroll a connected Chrome tab by viewport pixel deltas. Positive deltaY scrolls down.",
      inputSchema: z.object({
        tabId: tabIdSchema,
        deltaX: z.number().finite().min(-10_000).max(10_000).optional(),
        deltaY: z.number().finite().min(-10_000).max(10_000).optional(),
        x: z.number().finite().nonnegative().optional(),
        y: z.number().finite().nonnegative().optional(),
      }),
    },
    async (input) =>
      textResult(await callBridge(bridge, authorization, "page.scroll", input)),
  );
  server.registerTool(
    "browser_screenshot",
    {
      description:
        "Capture the current visible viewport of a connected Chrome tab as a JPEG image.",
      inputSchema: z.object({ tabId: tabIdSchema }),
    },
    async (input) => {
      const result = await callBridge(
        bridge,
        authorization,
        "page.screenshot",
        input,
      );
      if (
        !isRecord(result) ||
        result.mediaType !== "image/jpeg" ||
        typeof result.data !== "string"
      ) {
        throw new Error("BROWSER_SCREENSHOT_INVALID");
      }
      return {
        content: [
          {
            type: "image" as const,
            data: result.data,
            mimeType: "image/jpeg",
          },
        ],
      };
    },
  );
  server.registerTool(
    "browser_wait",
    {
      description:
        "Wait briefly for a page transition or asynchronous interface update.",
      inputSchema: z.object({
        seconds: z.number().finite().min(0).max(10),
      }),
    },
    async ({ seconds }) => {
      await assertAuthorized(authorization, "browser.status", {});
      await new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
      return { content: [{ type: "text" as const, text: "Wait completed." }] };
    },
  );

  return server;
}

const tabIdSchema = z.string().regex(/^tab-\d+$/);

async function callBridge(
  bridge: BrowserToolBridge,
  authorization: BrowserToolAuthorization,
  operation: BrowserBridgeOperation,
  input: Record<string, unknown>,
): Promise<unknown> {
  await assertAuthorized(authorization, operation, input);
  return bridge.request(operation, input, { timeoutMs: TOOL_TIMEOUT_MS });
}

async function assertAuthorized(
  authorization: BrowserToolAuthorization,
  operation: BrowserBridgeOperation,
  input: Record<string, unknown>,
): Promise<void> {
  if (!(await authorization.authorize(operation, input))) {
    throw new Error("BROWSER_TOOL_NOT_AUTHORIZED");
  }
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value).slice(0, 256 * 1024),
      },
    ],
  };
}

function tabHeader(value: unknown): string {
  if (!isRecord(value)) return "Chrome tab";
  const title = typeof value.title === "string" ? value.title : "Chrome tab";
  const url = typeof value.url === "string" ? value.url : "";
  return url ? `${title}\n${url}` : title;
}

function normalizeAddress(value: string | undefined): string {
  if (!value) return "";
  return value.startsWith("::ffff:") ? value.slice(7) : value;
}
