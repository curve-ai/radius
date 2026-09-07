import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

void React;
(globalThis as typeof globalThis & { React: typeof React }).React = React;

import type { PendingAgentElicitation } from "../../../../radius-api";
import { AgentElicitationPanel } from "./agent-elicitation";
import {
  createAgentElicitationDraft,
  validateAgentElicitationDraft,
} from "./agent-elicitation-form";

const formRequest: Extract<PendingAgentElicitation, { mode: "form" }> = {
  requestId: "request-1",
  sessionId: "session-1",
  mode: "form",
  message: "Choose how this task should continue.",
  toolCallId: null,
  createdAt: "2026-09-01T12:00:00.000Z",
  title: "Task settings",
  description: "Review these values before sending them to the agent.",
  fields: [
    {
      name: "email",
      type: "string",
      title: "Email address",
      description: "Used for this task only.",
      required: true,
      defaultValue: null,
      options: null,
      format: "email",
      minimum: null,
      maximum: null,
      minimumLength: 3,
      maximumLength: 100,
      pattern: null,
    },
    {
      name: "environment",
      type: "string",
      title: "Environment",
      description: null,
      required: true,
      defaultValue: "staging",
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
      name: "attempts",
      type: "integer",
      title: "Attempts",
      description: null,
      required: true,
      defaultValue: 2,
      options: null,
      format: null,
      minimum: 1,
      maximum: 4,
      minimumLength: null,
      maximumLength: null,
      pattern: null,
    },
    {
      name: "checks",
      type: "array",
      title: "Checks",
      description: null,
      required: true,
      defaultValue: ["test"],
      options: [
        { value: "typecheck", title: "Typecheck", description: null },
        { value: "test", title: "Tests", description: null },
      ],
      format: null,
      minimum: null,
      maximum: null,
      minimumLength: 1,
      maximumLength: 2,
      pattern: null,
    },
    {
      name: "notify",
      type: "boolean",
      title: "Notify me",
      description: "Show a notification when complete.",
      required: false,
      defaultValue: true,
      options: null,
      format: null,
      minimum: null,
      maximum: null,
      minimumLength: null,
      maximumLength: null,
      pattern: null,
    },
    {
      name: "reference",
      type: "string",
      title: "Reference",
      description: null,
      required: false,
      defaultValue: null,
      options: null,
      format: null,
      minimum: null,
      maximum: null,
      minimumLength: null,
      maximumLength: null,
      pattern: "^R-[0-9]+$",
    },
    {
      name: "optionalFlag",
      type: "boolean",
      title: "Optional flag",
      description: null,
      required: false,
      defaultValue: null,
      options: null,
      format: null,
      minimum: null,
      maximum: null,
      minimumLength: null,
      maximumLength: null,
      pattern: null,
    },
  ],
};

test("creates a form draft from ACP defaults", () => {
  assert.deepEqual(createAgentElicitationDraft(formRequest), {
    email: "",
    environment: "staging",
    attempts: "2",
    checks: ["test"],
    notify: true,
    reference: "",
    optionalFlag: null,
  });
});

test("validates required, typed, ranged, and selected values before review", () => {
  const invalid = validateAgentElicitationDraft(formRequest, {
    email: "not-an-email",
    environment: "unknown",
    attempts: "2.5",
    checks: [],
    notify: true,
    reference: "bad",
    optionalFlag: null,
  });
  assert.equal(invalid.content, null);
  assert.deepEqual(Object.keys(invalid.errors).sort(), [
    "attempts",
    "checks",
    "email",
    "environment",
    "reference",
  ]);

  assert.deepEqual(
    validateAgentElicitationDraft(formRequest, {
      email: "alexey@example.com",
      environment: "production",
      attempts: "3",
      checks: ["typecheck", "test"],
      notify: false,
      reference: "R-42",
      optionalFlag: null,
    }),
    {
      content: {
        email: "alexey@example.com",
        environment: "production",
        attempts: 3,
        checks: ["typecheck", "test"],
        notify: false,
        reference: "R-42",
      },
      errors: {},
    },
  );
});

test("renders labeled compact controls and review-first actions", () => {
  const markup = renderToStaticMarkup(
    React.createElement(AgentElicitationPanel, {
      requests: [formRequest],
      loading: false,
      error: null,
      onRefresh: () => undefined,
      onResolve: async () => undefined,
    }),
  );

  assert.match(markup, /Task settings/);
  assert.match(markup, /<label for="/);
  assert.match(markup, /type="email"/);
  assert.match(markup, /<select/);
  assert.match(markup, /type="number"/);
  assert.match(markup, /type="checkbox"/);
  assert.match(markup, /role="switch"/);
  assert.match(markup, />Review</);
  assert.match(markup, />Decline</);
  assert.match(markup, />Cancel</);
  assert.doesNotMatch(markup, /Send response/);
});

test("shows the complete URL and requires an explicit open action", () => {
  const urlRequest: PendingAgentElicitation = {
    requestId: "request-url",
    sessionId: "session-1",
    mode: "url",
    message: "Authorize this account.",
    toolCallId: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    elicitationId: "oauth-1",
    url: "https://accounts.example.com/oauth/authorize?client_id=radius",
  };
  const markup = renderToStaticMarkup(
    React.createElement(AgentElicitationPanel, {
      requests: [urlRequest],
      loading: false,
      error: null,
      onRefresh: () => undefined,
      onResolve: async () => undefined,
    }),
  );

  assert.match(markup, /accounts\.example\.com/);
  assert.match(
    markup,
    /https:\/\/accounts\.example\.com\/oauth\/authorize\?client_id=radius/,
  );
  assert.match(markup, /Open and continue/);
  assert.doesNotMatch(markup, /<iframe|<link|<img/);
});

test("renders explicit loading and refresh-error states", () => {
  const loading = renderToStaticMarkup(
    React.createElement(AgentElicitationPanel, {
      requests: [],
      loading: true,
      error: null,
      onRefresh: () => undefined,
      onResolve: async () => undefined,
    }),
  );
  assert.match(loading, /aria-label="Loading requested input"/);

  const error = renderToStaticMarkup(
    React.createElement(AgentElicitationPanel, {
      requests: [],
      loading: false,
      error: "Unavailable",
      onRefresh: () => undefined,
      onResolve: async () => undefined,
    }),
  );
  assert.match(error, /Requested input could not be loaded/);
  assert.match(error, /Try again/);
});
