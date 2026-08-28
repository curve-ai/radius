import assert from "node:assert/strict";
import test from "node:test";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import { startBrowserToolServer, type BrowserToolBridge } from "./index.js";

test("serves browser tools only with its run-scoped bearer token", async () => {
  const calls: string[] = [];
  const bridge: BrowserToolBridge = {
    async request(operation) {
      calls.push(operation);
      return { tabs: [] };
    },
  };
  const server = await startBrowserToolServer(bridge, {
    authorize: () => true,
  });
  try {
    const unauthorized = await fetch(server.localUrl, { method: "POST" });
    assert.equal(unauthorized.status, 401);

    const headers = Object.fromEntries(
      server.headers.map(({ name, value }) => [name, value]),
    );
    const client = new Client({ name: "radius-browser-test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.localUrl), {
        requestInit: { headers },
      }),
    );
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "browser_tabs_list"));
    const result = await client.callTool({
      name: "browser_tabs_list",
      arguments: {},
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(calls, ["tabs.list"]);
    await client.close();
  } finally {
    await server.close();
  }
});

test("reauthorizes each browser operation before dispatch", async () => {
  const bridge: BrowserToolBridge = {
    async request() {
      throw new Error("bridge must not be reached");
    },
  };
  const server = await startBrowserToolServer(bridge, {
    authorize: () => false,
  });
  try {
    const headers = Object.fromEntries(
      server.headers.map(({ name, value }) => [name, value]),
    );
    const client = new Client({ name: "radius-browser-test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.localUrl), {
        requestInit: { headers },
      }),
    );
    const result = await client.callTool({
      name: "browser_tabs_list",
      arguments: {},
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /BROWSER_TOOL_NOT_AUTHORIZED/);
    await client.close();
  } finally {
    await server.close();
  }
});
