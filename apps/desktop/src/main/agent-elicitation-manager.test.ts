import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentElicitationError,
  AgentElicitationManager,
} from "./agent-elicitation-manager";

type ElicitationRequest = Parameters<AgentElicitationManager["handle"]>[1];

function request(value: unknown): ElicitationRequest {
  return value as ElicitationRequest;
}

test("exposes a bounded serializable form summary and returns accepted content", async () => {
  const manager = new AgentElicitationManager({
    createRequestId: () => "local-request",
    now: () => new Date("2026-09-01T12:00:00.000Z"),
  });
  const response = manager.handle(
    "session-a",
    request({
      mode: "form",
      sessionId: "session-a",
      toolCallId: "tool-1",
      message: "Choose deployment settings",
      _meta: { secret: "not-for-ui" },
      requestedSchema: {
        type: "object",
        title: "Deploy",
        description: "Select the target and retry count.",
        properties: {
          target: {
            type: "string",
            title: "Target",
            oneOf: [
              { const: "staging", title: "Staging" },
              { const: "production", title: "Production" },
            ],
          },
          retries: { type: "integer", minimum: 0, maximum: 3, default: 1 },
          checks: {
            type: "array",
            items: { type: "string", enum: ["typecheck", "test"] },
            minItems: 1,
          },
        },
        required: ["target", "checks"],
      },
    }),
    new AbortController().signal,
  );

  const [pending] = manager.listPending("session-a");
  assert.deepEqual(pending, {
    requestId: "local-request",
    sessionId: "session-a",
    mode: "form",
    message: "Choose deployment settings",
    toolCallId: "tool-1",
    createdAt: "2026-09-01T12:00:00.000Z",
    title: "Deploy",
    description: "Select the target and retry count.",
    fields: [
      {
        name: "target",
        type: "string",
        title: "Target",
        description: null,
        required: true,
        defaultValue: null,
        options: [
          { value: "staging", title: "Staging", description: null },
          { value: "production", title: "Production", description: null },
        ],
        format: null,
        minimum: null,
        maximum: null,
        minimumLength: null,
        maximumLength: null,
        pattern: null,
      },
      {
        name: "retries",
        type: "integer",
        title: null,
        description: null,
        required: false,
        defaultValue: 1,
        options: null,
        format: null,
        minimum: 0,
        maximum: 3,
        minimumLength: null,
        maximumLength: null,
        pattern: null,
      },
      {
        name: "checks",
        type: "array",
        title: null,
        description: null,
        required: true,
        defaultValue: null,
        options: [
          { value: "typecheck", title: "typecheck", description: null },
          { value: "test", title: "test", description: null },
        ],
        format: null,
        minimum: null,
        maximum: null,
        minimumLength: 1,
        maximumLength: null,
        pattern: null,
      },
    ],
  });
  assert.doesNotThrow(() => JSON.stringify(pending));
  assert.equal(JSON.stringify(pending).includes("not-for-ui"), false);

  manager.resolve({
    sessionId: "session-a",
    requestId: "local-request",
    response: {
      action: "accept",
      content: { target: "staging", retries: 2, checks: ["test"] },
    },
  });
  assert.deepEqual(await response, {
    action: "accept",
    content: { target: "staging", retries: 2, checks: ["test"] },
  });
  assert.deepEqual(manager.listPending("session-a"), []);
});

test("keeps invalid form responses pending for correction", async () => {
  const manager = new AgentElicitationManager({
    createRequestId: () => "validation-request",
  });
  const response = manager.handle(
    "session-a",
    request({
      mode: "form",
      sessionId: "session-a",
      message: "Provide a count",
      requestedSchema: {
        type: "object",
        properties: { count: { type: "integer", minimum: 1, maximum: 4 } },
        required: ["count"],
      },
    }),
    new AbortController().signal,
  );

  assert.throws(
    () =>
      manager.resolve({
        sessionId: "session-a",
        requestId: "validation-request",
        response: { action: "accept", content: { count: 2.5 } },
      }),
    (error) =>
      error instanceof AgentElicitationError &&
      error.code === "INVALID_RESPONSE",
  );
  assert.equal(manager.listPending("session-a").length, 1);

  manager.resolve({
    sessionId: "session-a",
    requestId: "validation-request",
    response: { action: "accept", content: { count: 3 } },
  });
  assert.deepEqual(await response, {
    action: "accept",
    content: { count: 3 },
  });
});

test("enforces safe string patterns in the authoritative response validator", async () => {
  const manager = new AgentElicitationManager({
    createRequestId: () => "pattern-request",
  });
  const response = manager.handle(
    "session-a",
    request({
      mode: "form",
      sessionId: "session-a",
      message: "Provide a reference",
      requestedSchema: {
        type: "object",
        properties: {
          reference: { type: "string", pattern: "^R-[0-9]+$" },
        },
        required: ["reference"],
      },
    }),
    new AbortController().signal,
  );

  assert.throws(
    () =>
      manager.resolve({
        sessionId: "session-a",
        requestId: "pattern-request",
        response: { action: "accept", content: { reference: "wrong" } },
      }),
    /does not match its requested pattern/,
  );
  manager.resolve({
    sessionId: "session-a",
    requestId: "pattern-request",
    response: { action: "accept", content: { reference: "R-42" } },
  });
  assert.deepEqual(await response, {
    action: "accept",
    content: { reference: "R-42" },
  });
});

test("rejects patterns with grouping before they reach the renderer", () => {
  const manager = new AgentElicitationManager({
    createRequestId: () => "unsafe-pattern-request",
  });
  assert.throws(
    () =>
      manager.handle(
        "session-a",
        request({
          mode: "form",
          sessionId: "session-a",
          message: "Provide a value",
          requestedSchema: {
            type: "object",
            properties: {
              value: { type: "string", pattern: "^(a+)+$" },
            },
          },
        }),
        new AbortController().signal,
      ),
    /Pattern for value is unsupported/,
  );
});

test("enforces session ownership for creation and resolution", async () => {
  const manager = new AgentElicitationManager({
    createRequestId: () => "scoped-request",
  });
  assert.throws(
    () =>
      manager.handle(
        "session-a",
        request({
          mode: "form",
          sessionId: "session-b",
          message: "Wrong session",
          requestedSchema: { type: "object" },
        }),
        new AbortController().signal,
      ),
    (error) =>
      error instanceof AgentElicitationError &&
      error.code === "SESSION_MISMATCH",
  );

  const response = manager.handle(
    "session-a",
    request({
      mode: "form",
      requestId: 42,
      message: "Request-scoped input",
      requestedSchema: { type: "object" },
    }),
    new AbortController().signal,
  );
  assert.throws(
    () =>
      manager.resolve({
        sessionId: "session-b",
        requestId: "scoped-request",
        response: { action: "decline" },
      }),
    (error) =>
      error instanceof AgentElicitationError && error.code === "NOT_PENDING",
  );
  manager.resolve({
    sessionId: "session-a",
    requestId: "scoped-request",
    response: { action: "decline" },
  });
  assert.deepEqual(await response, { action: "decline" });
});

test("handles URL acceptance and agent completion without retaining state", async () => {
  const ids = ["url-request", "completed-url-request"];
  const manager = new AgentElicitationManager({
    createRequestId: () => ids.shift()!,
  });
  const first = manager.handle(
    "session-a",
    request({
      mode: "url",
      sessionId: "session-a",
      elicitationId: "oauth-1",
      message: "Connect the account",
      url: "https://example.com/authorize?client=radius",
    }),
    new AbortController().signal,
  );
  assert.deepEqual(manager.listPending("session-a"), [
    {
      requestId: "url-request",
      sessionId: "session-a",
      mode: "url",
      message: "Connect the account",
      toolCallId: null,
      createdAt: manager.listPending("session-a")[0]!.createdAt,
      elicitationId: "oauth-1",
      url: "https://example.com/authorize?client=radius",
    },
  ]);
  manager.resolve({
    sessionId: "session-a",
    requestId: "url-request",
    response: { action: "accept" },
  });
  assert.deepEqual(await first, { action: "accept" });

  const second = manager.handle(
    "session-a",
    request({
      mode: "url",
      sessionId: "session-a",
      elicitationId: "oauth-2",
      message: "Finish connecting",
      url: "http://127.0.0.1:8181/callback",
    }),
    new AbortController().signal,
  );
  assert.equal(manager.completeUrl("session-a", "oauth-2"), true);
  assert.deepEqual(await second, { action: "accept" });
  assert.equal(manager.completeUrl("session-a", "oauth-2"), false);
});

test("abort and session cancellation clean pending requests", async () => {
  const ids = ["abort-request", "cancel-request"];
  const manager = new AgentElicitationManager({
    createRequestId: () => ids.shift()!,
  });
  const controller = new AbortController();
  const aborted = manager.handle(
    "session-a",
    request({
      mode: "form",
      sessionId: "session-a",
      message: "Wait",
      requestedSchema: { type: "object" },
    }),
    controller.signal,
  );
  controller.abort();
  assert.deepEqual(await aborted, { action: "cancel" });
  assert.deepEqual(manager.listPending("session-a"), []);

  const cancelled = manager.handle(
    "session-a",
    request({
      mode: "form",
      sessionId: "session-a",
      message: "Wait again",
      requestedSchema: { type: "object" },
    }),
    new AbortController().signal,
  );
  assert.equal(manager.cancelSession("session-a"), 1);
  assert.equal(manager.cancelSession("session-a"), 0);
  assert.deepEqual(await cancelled, { action: "cancel" });
});

test("rejects unsupported modes, unsafe URLs, and oversized summaries", () => {
  const manager = new AgentElicitationManager();
  const signal = new AbortController().signal;
  assert.throws(
    () =>
      manager.handle(
        "session-a",
        request({
          mode: "future",
          sessionId: "session-a",
          message: "Unknown",
        }),
        signal,
      ),
    /does not support this elicitation mode/,
  );
  assert.throws(
    () =>
      manager.handle(
        "session-a",
        request({
          mode: "url",
          sessionId: "session-a",
          elicitationId: "unsafe",
          message: "Open this",
          url: "javascript:alert(1)",
        }),
        signal,
      ),
    /must be HTTP or HTTPS without credentials/,
  );
  assert.throws(
    () =>
      manager.handle(
        "session-a",
        request({
          mode: "form",
          sessionId: "session-a",
          message: "x".repeat(4_097),
          requestedSchema: { type: "object" },
        }),
        signal,
      ),
    /message is too long/,
  );
});
