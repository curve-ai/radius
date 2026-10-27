import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_VERSION, agent, methods } from "@agentclientprotocol/sdk";
import { createRadiusAuthentication } from "./authentication.js";
import { serveDevelopmentAgent } from "./dev-server.js";
import {
  connectAcpRuntime,
  AcpAuthenticationRequiredError,
} from "./session.js";
import { acpStreamFromWebSocket } from "./websocket.js";

const handlers = {
  onPermissionRequest: async () => ({ outcome: "cancelled" as const }),
};

function createSecuredAgent() {
  const auth = createRadiusAuthentication(async ({ accessToken }) => {
    if (accessToken !== "vendor-token") throw new Error("Rejected token");
  });
  return agent({ name: "direct-acp-agent" })
    .onConnect((connection) => {
      void connection.closed.then(() => auth.clear());
    })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      authMethods: auth.authMethods,
    }))
    .onRequest(methods.agent.authenticate, ({ params, signal }) =>
      auth.authenticate(params, signal),
    )
    .onRequest(methods.agent.session.new, () => {
      auth.requireCredential();
      return { sessionId: "session" };
    })
    .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
      auth.requireCredential();
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "session_info_update",
          title: "ACP generated title",
        },
      });
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Authenticated query completed" },
        },
      });
      return { stopReason: "end_turn" };
    });
}

test("direct ACP agents retain streaming, titles, and per-connection Radius authentication", async () => {
  const server = await serveDevelopmentAgent(createSecuredAgent, {
    port: 0,
    authorization: "Bearer development-secret",
  });
  let title: string | null = null;
  const runtime = await connectAcpRuntime(
    acpStreamFromWebSocket(server.endpoint, "Bearer development-secret"),
    {
      cwd: "/tmp/radius-acp-test",
      handlers: {
        ...handlers,
        onUpdate: ({ update }) => {
          if (update.sessionUpdate === "session_info_update")
            title = update.title ?? null;
        },
      },
      onAuthenticate: async () => ({
        methodId: "radius-oauth",
        credential: {
          accessToken: "vendor-token",
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
      }),
    },
  );
  try {
    assert.equal(
      (await runtime.prompt("hello")).text,
      "Authenticated query completed",
    );
    assert.equal(title, "ACP generated title");
    await assert.rejects(
      connectAcpRuntime(
        acpStreamFromWebSocket(server.endpoint, "Bearer development-secret"),
        { cwd: "/tmp/other", handlers },
      ),
      AcpAuthenticationRequiredError,
    );
    await assert.rejects(
      connectAcpRuntime(
        acpStreamFromWebSocket(server.endpoint, "Bearer development-secret"),
        {
          cwd: "/tmp/other",
          handlers,
          onAuthenticate: async () => ({
            methodId: "radius-oauth",
            credential: {
              accessToken: "wrong-token",
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
            },
          }),
        },
      ),
      /Authentication required/i,
    );
    assert.equal(
      (await runtime.prompt("still authenticated")).text,
      "Authenticated query completed",
    );
  } finally {
    runtime.close();
    await server.close();
  }
});

test("development transport rejects the wrong bearer and non-loopback hosts", async () => {
  const server = await serveDevelopmentAgent(createSecuredAgent, {
    port: 0,
    authorization: "Bearer expected",
  });
  try {
    const response = await fetch(server.endpoint.replace("ws:", "http:"));
    assert.equal(response.status, 404);
    await assert.rejects(
      connectAcpRuntime(
        acpStreamFromWebSocket(server.endpoint, "Bearer wrong"),
        { cwd: "/tmp/other", handlers },
      ),
    );
  } finally {
    await server.close();
  }
  await assert.rejects(
    serveDevelopmentAgent(createSecuredAgent, { hostname: "0.0.0.0" }),
    /loopback/,
  );
});

test("Radius authentication rejects expired credentials and clears failed reauthentication", async (t) => {
  const auth = createRadiusAuthentication(async ({ accessToken }) => {
    if (accessToken !== "valid") throw new Error();
  });
  const now = Date.now();
  const signal = new AbortController().signal;
  const params = (
    accessToken: string,
    expiresAt = new Date(now + 60_000).toISOString(),
  ) => ({
    methodId: "radius-oauth",
    _meta: { "ai.radius/auth": { accessToken, expiresAt } },
  });
  await assert.rejects(
    auth.authenticate(params("valid", new Date(now - 1).toISOString()), signal),
  );
  await auth.authenticate(params("valid"), signal);
  assert.equal(auth.requireCredential().accessToken, "valid");
  await assert.rejects(auth.authenticate(params("invalid"), signal));
  assert.throws(() => auth.requireCredential());
  await auth.authenticate(params("valid"), signal);
  t.mock.method(Date, "now", () => now + 60_001);
  assert.throws(() => auth.requireCredential());
});
