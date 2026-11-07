import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { AgentBuildReceiptSchema } from "@curve-ai/agent-contracts";
import { canonicalJson, createAgentManifest } from "@curve-ai/build";
import type {
  FinalizeAgentDeploymentRequest,
  FinalizeAgentDeploymentResponse,
  PrepareAgentDeploymentRequest,
} from "@curve-ai/platform-client";

import { OperationalError, UsageError } from "./errors.js";
import {
  loadBuildReceipt,
  pushBuildToPlatform,
  type PushPlatformClient,
} from "./platform-push.js";

const config = {
  schemaVersion: 1,
  agent: "agent_abcdef12",
  name: "Push Project",
  runtime: {
    kind: "harness",
    distribution: {
      kind: "binary",
      cmd: "./opencode",
      args: ["acp"],
      platforms: {
        "linux/arm64": {
          archive: "https://example.invalid/opencode.tar.gz",
          sha256: "a".repeat(64),
        },
      },
    },
  },
};
const manifest = createAgentManifest(config as never);
const buildDigest = "b".repeat(64);
const receipt = AgentBuildReceiptSchema.parse({
  schemaVersion: 1,
  buildDigest,
  imageReference: "radius.local/agent_abcdef12/agent:build",
  sourceManifestDigest: `sha256:${"c".repeat(64)}`,
  bundleSha256: "d".repeat(64),
  layoutPath: `.radius/builds/${buildDigest}/oci-layout`,
  contextPath: `.radius/builds/${buildDigest}/context`,
  manifest,
  verifiedAt: "2026-11-04T12:00:00.000Z",
  verification: { kind: "microvm-acp", platform: "linux/arm64" },
});
const uploadId = "0b6f3c1e-8a1f-4a43-9a7e-2f9c1d4b5e6a";
const imageDigest = `sha256:${"e".repeat(64)}` as const;

function fakePlatform(organizations = ["acme"]) {
  const calls: {
    prepare?: { request: PrepareAgentDeploymentRequest; key: string };
    finalize?: { agent: string; request: FinalizeAgentDeploymentRequest };
  } = {};
  const client: PushPlatformClient = {
    info: async () =>
      ({
        apiVersion: 1,
        platformVersion: "0.0.1",
        supportedAgentManifestVersions: [1],
      }) as never,
    identity: async () =>
      ({ organizations: organizations.map((slug) => ({ slug })) }) as never,
    prepareAgentDeployment: async (request, key) => {
      calls.prepare = { request, key };
      return {
        apiVersion: 1,
        uploadId,
        imageReference: "registry.example.com/agent_abcdef12/agent:upload",
        credentials: {
          registry: "registry.example.com",
          username: `upload-${uploadId}`,
          password: "per-upload-secret",
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        },
      };
    },
    finalizeAgentDeployment: async (agent, request) => {
      calls.finalize = { agent, request };
      return {
        agentDeployment: {
          id: "f".repeat(8),
          version: "1.0.0",
          state: "ready",
          imageDigest,
        },
        environmentRevision: null,
      } as unknown as FinalizeAgentDeploymentResponse;
    },
  };
  return { client, calls };
}

test("prepares, pushes with the upload's own credentials, and finalizes without promoting", async () => {
  const { client, calls } = fakePlatform();
  let pushed: unknown;
  const result = await pushBuildToPlatform({
    client,
    root: "/project",
    agent: "agent_abcdef12",
    receipt,
    manifest,
    environment: "production",
    pushImage: async (options) => {
      pushed = options;
      return imageDigest;
    },
  });

  assert.equal(result.organization, "acme");
  assert.equal(calls.prepare?.key, `prepare-acme-${buildDigest}-production`);
  assert.equal(calls.prepare?.request.buildDigest, buildDigest);
  assert.deepEqual(pushed, {
    build: {
      imageReference: receipt.imageReference,
      layoutPath: join("/project", receipt.layoutPath),
    },
    imageReference: "registry.example.com/agent_abcdef12/agent:upload",
    credentials: {
      registry: "registry.example.com",
      username: `upload-${uploadId}`,
      password: "per-upload-secret",
      expiresAt: (pushed as { credentials: { expiresAt: string } }).credentials
        .expiresAt,
    },
  });
  assert.equal(calls.finalize?.agent, "agent_abcdef12");
  assert.equal(calls.finalize?.request.promote, false);
  assert.equal(calls.finalize?.request.imageDigest, imageDigest);
  assert.equal(
    calls.finalize?.request.sourceManifestDigest,
    receipt.sourceManifestDigest,
  );
});

test("refuses a build whose manifest no longer matches the config", async () => {
  const { client, calls } = fakePlatform();
  await assert.rejects(
    pushBuildToPlatform({
      client,
      root: "/project",
      agent: "agent_abcdef12",
      receipt,
      manifest: { ...manifest, name: "Renamed" },
      environment: "production",
      pushImage: async () => imageDigest,
    }),
    (error) =>
      error instanceof OperationalError &&
      /radius build/.test(error.nextAction ?? ""),
  );
  assert.equal(calls.prepare, undefined);
});

test("asks for --organization when the token has several", async () => {
  const { client } = fakePlatform(["acme", "globex"]);
  await assert.rejects(
    pushBuildToPlatform({
      client,
      root: "/project",
      agent: "agent_abcdef12",
      receipt,
      manifest,
      environment: "production",
      pushImage: async () => imageDigest,
    }),
    (error) =>
      error instanceof UsageError && /--organization/.test(error.message),
  );
});

test("reports an upload failure as an operational error and does not finalize", async () => {
  const { client, calls } = fakePlatform();
  await assert.rejects(
    pushBuildToPlatform({
      client,
      root: "/project",
      agent: "agent_abcdef12",
      receipt,
      manifest,
      organization: "acme",
      environment: "production",
      pushImage: async () => {
        throw new Error(
          "Docker would upload to registry.example.com over plain HTTP.",
        );
      },
    }),
    (error) =>
      error instanceof OperationalError && /plain HTTP/.test(error.message),
  );
  assert.equal(calls.finalize, undefined);
});

test("replaces an expired upload with a new one instead of failing", async () => {
  const { client } = fakePlatform();
  const keys: string[] = [];
  const replay = client.prepareAgentDeployment;
  client.prepareAgentDeployment = async (request, key) => {
    keys.push(key);
    const prepared = await replay(request, key);
    // The first key replays an upload that expired an hour ago.
    return keys.length === 1
      ? {
          ...prepared,
          uploadId: "expired-upload",
          credentials: {
            ...prepared.credentials,
            expiresAt: new Date(Date.now() - 60 * 60_000).toISOString(),
          },
        }
      : prepared;
  };
  let pushedWith: string | undefined;
  const result = await pushBuildToPlatform({
    client,
    root: "/project",
    agent: "agent_abcdef12",
    receipt,
    manifest,
    environment: "production",
    pushImage: async (options) => {
      pushedWith = options.credentials.username;
      return imageDigest;
    },
  });

  assert.deepEqual(keys, [
    `prepare-acme-${buildDigest}-production`,
    "prepare-after-expired-upload",
  ]);
  assert.equal(pushedWith, `upload-${uploadId}`);
  assert.equal(result.finalized.agentDeployment.version, "1.0.0");
});

test("loads the latest receipt, or a named one", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-push-test-"));
  const directory = join(root, ".radius", "builds", buildDigest);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "receipt.json"), canonicalJson(receipt));
  await writeFile(
    join(root, ".radius", "builds", "latest.json"),
    canonicalJson({ schemaVersion: 1, buildDigest }),
  );

  assert.equal((await loadBuildReceipt(root)).buildDigest, buildDigest);
  assert.equal(
    (await loadBuildReceipt(root, buildDigest)).buildDigest,
    buildDigest,
  );
  await assert.rejects(
    loadBuildReceipt(root, "a".repeat(64)),
    OperationalError,
  );
  await assert.rejects(loadBuildReceipt(root, "not-a-digest"), UsageError);
});

test("asks for a build when the project has none", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-push-test-"));
  await assert.rejects(
    loadBuildReceipt(root),
    (error) =>
      error instanceof OperationalError &&
      /radius build/.test(error.nextAction ?? ""),
  );
});
