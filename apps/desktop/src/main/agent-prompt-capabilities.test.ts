import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentReleaseDescriptor,
  DevelopmentAgentConnection,
} from "@curve-ai/radius-runtime";

import {
  developmentPromptCapabilitiesKey,
  releasePromptCapabilitiesKey,
  sameAgentPromptCapabilities,
} from "./agent-prompt-capabilities";

test("versions release capability caches by immutable image digest", () => {
  const release = {
    providerId: "provider",
    agentId: "agent",
    image: { digest: `sha256:${"a".repeat(64)}` },
  } as AgentReleaseDescriptor;
  const updated = {
    ...release,
    image: { ...release.image, digest: `sha256:${"b".repeat(64)}` },
  };
  assert.notEqual(
    releasePromptCapabilitiesKey(release),
    releasePromptCapabilitiesKey(updated),
  );
});

test("versions development capability caches by registration", () => {
  const connection = {
    agentId: "agent_test",
    endpoint: "ws://127.0.0.1:4000",
    registeredAt: "2026-09-02T12:00:00.000Z",
  } as DevelopmentAgentConnection;
  assert.notEqual(
    developmentPromptCapabilitiesKey(connection),
    developmentPromptCapabilitiesKey({
      ...connection,
      registeredAt: "2026-09-02T12:01:00.000Z",
    }),
  );
});

test("detects capability changes before notifying renderer callers", () => {
  const current = { image: true, audio: false, embeddedContext: true };
  assert.equal(sameAgentPromptCapabilities(current, { ...current }), true);
  assert.equal(
    sameAgentPromptCapabilities(current, { ...current, audio: true }),
    false,
  );
});
