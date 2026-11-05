import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { runtimeCacheRoot, runtimeHostIsAvailable } from "./runtime-assets.js";

/**
 * The kernel is pinned in two places: the repo's own asset script reads
 * `runtime-assets.json`, and the CLI carries a copy so it can fetch without
 * a checkout. Two pins that can disagree will, so this is the test that
 * notices when the repo bumps the kernel and the CLI does not.
 */
test("the CLI's kernel pin matches the repo's", async () => {
  const repoManifest = join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "apps",
    "runtime-host-macos",
    "Config",
    "runtime-assets.json",
  );
  let manifest: {
    kernel: { archiveUrl: string; archiveSha256: string; binaryPath: string };
  };
  try {
    manifest = JSON.parse(await readFile(repoManifest, "utf8"));
  } catch {
    // Running against an installed CLI rather than a checkout; nothing to
    // compare against, and that is not a failure.
    return;
  }

  const source = await readFile(
    join(import.meta.dirname, "runtime-assets.ts"),
    "utf8",
  );
  assert.ok(
    source.includes(manifest.kernel.archiveSha256),
    `runtime-assets.ts does not pin the repo's kernel digest ${manifest.kernel.archiveSha256}`,
  );
  assert.ok(
    source.includes(manifest.kernel.archiveUrl),
    "runtime-assets.ts does not pin the repo's kernel URL",
  );
  assert.ok(
    source.includes(manifest.kernel.binaryPath),
    "runtime-assets.ts does not pin the repo's kernel member path",
  );
});

test("the cache sits under the user's own Radius directory", () => {
  // Shared with the harness cache on purpose: both are content-addressed
  // downloads the CLI owns, and a developer should have one place to clear.
  assert.match(runtimeCacheRoot(), /\.radius[/\\]runtime$/);
});

test("the download tier reports honestly whether it can serve a host", async () => {
  const { fetchRuntime } = await import("./runtime-assets.js");
  if (runtimeHostIsAvailable({})) {
    // Nothing to assert without spending a download; the pin being set is
    // itself the contract.
    return;
  }
  // Until a release carries the host, this tier must refuse in a way that
  // names the alternatives rather than failing opaquely.
  await assert.rejects(
    () => fetchRuntime(() => {}, {}),
    /no published runtime host to download yet/,
  );
});

test("an override must carry a digest, and both halves together", () => {
  assert.equal(runtimeHostIsAvailable({}), false);
  assert.equal(
    runtimeHostIsAvailable({
      RADIUS_RUNTIME_HOST_URL: "http://127.0.0.1:8000/host",
      RADIUS_RUNTIME_HOST_SHA256: "a".repeat(64),
    }),
    true,
  );
});

test("a half-set or malformed override fails loudly rather than being ignored", async () => {
  const { fetchRuntime } = await import("./runtime-assets.js");
  await assert.rejects(
    () => fetchRuntime(() => {}, { RADIUS_RUNTIME_HOST_URL: "http://x/y" }),
    /must be set together/,
  );
  await assert.rejects(
    () =>
      fetchRuntime(() => {}, {
        RADIUS_RUNTIME_HOST_URL: "http://x/y",
        RADIUS_RUNTIME_HOST_SHA256: "not-a-digest",
      }),
    /not a sha256 digest/,
  );
});
