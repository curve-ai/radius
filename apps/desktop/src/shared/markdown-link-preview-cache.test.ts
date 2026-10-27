import assert from "node:assert/strict";
import test from "node:test";

import type { MarkdownLinkPreviewResolution } from "../radius-api";
import {
  MarkdownLinkPreviewCache,
  markdownLinkOrigin,
} from "./markdown-link-preview-cache";

const ready: MarkdownLinkPreviewResolution = {
  state: "ready",
  faviconDataUrl: "data:image/png;base64,light",
  faviconDarkDataUrl: "data:image/png;base64,dark",
};

test("coalesces different same-origin links and synchronously reuses both icon variants", async () => {
  const calls: string[] = [];
  const cache = new MarkdownLinkPreviewCache(async (href) => {
    calls.push(href);
    return ready;
  });
  const first = cache.resolve("https://example.com/ticket/1?a=1#title");
  const second = cache.resolve("https://EXAMPLE.com:443/ticket/2");
  assert.equal(first, second);
  assert.deepEqual(await first, ready);
  assert.deepEqual(cache.get("https://example.com/ticket/3"), ready);
  assert.deepEqual(await cache.resolve("https://example.com/ticket/4"), ready);
  assert.equal(calls.length, 1);
  await cache.resolve("https://other.example.com/ticket/1");
  await cache.resolve("https://example.com:8443/ticket/1");
  assert.equal(calls.length, 3);
});

test("rejects unsafe schemes and credentials without cache reuse or invoking the loader", async () => {
  let calls = 0;
  const cache = new MarkdownLinkPreviewCache(async () => {
    calls += 1;
    return ready;
  });
  await cache.resolve("https://example.com");
  for (const href of [
    "http://example.com",
    "https://user:secret@example.com",
    "file:///tmp/file",
    "not a URL",
  ]) {
    assert.equal(markdownLinkOrigin(href), null);
    assert.equal(cache.get(href), undefined);
    assert.deepEqual(await cache.resolve(href), {
      state: "blocked",
      reason: "unsafe_url",
    });
  }
  assert.equal(calls, 1);
});

test("bounds eager loading across many origins and drains the queue after failures", async () => {
  const releases: (() => void)[] = [];
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const cache = new MarkdownLinkPreviewCache(async () => {
    calls += 1;
    const call = calls;
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active -= 1;
    if (call === 1) throw new Error("offline");
    return ready;
  });
  const pending = Array.from({ length: 12 }, (_, index) =>
    cache.resolve(`https://host${index}.example.com`),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 4);
  for (let batch = 0; batch < 3; batch += 1) {
    releases.splice(0).forEach((release) => release());
    await new Promise((resolve) => setImmediate(resolve));
  }
  const results = await Promise.all(pending);
  assert.equal(maximum, 4);
  assert.equal(calls, 12);
  assert.deepEqual(results[0], { state: "unavailable" });
  assert.deepEqual(results[11], ready);
});

test("caches failures briefly and retries after expiry; successful icons last longer", async () => {
  let now = 0;
  let calls = 0;
  const cache = new MarkdownLinkPreviewCache(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return ready;
    },
    () => now,
  );
  assert.deepEqual(await cache.resolve("https://example.com/1"), {
    state: "unavailable",
  });
  await cache.resolve("https://example.com/2");
  assert.equal(calls, 1);
  now = 60_001;
  assert.equal(cache.get("https://example.com/3"), undefined);
  assert.deepEqual(await cache.resolve("https://example.com/3"), ready);
  now += 60_001;
  await cache.resolve("https://example.com/4");
  assert.equal(calls, 2);
  now += 3_600_001;
  await cache.resolve("https://example.com/5");
  assert.equal(calls, 3);
});

test("a page with no usable icons does not suppress retries for an hour", async () => {
  let now = 0;
  let calls = 0;
  const cache = new MarkdownLinkPreviewCache(
    async () => {
      calls += 1;
      return { state: "ready", faviconDataUrl: null, faviconDarkDataUrl: null };
    },
    () => now,
  );
  await cache.resolve("https://example.com/1");
  now = 60_001;
  await cache.resolve("https://example.com/2");
  assert.equal(calls, 2);
});

test("evicts old origins and oversized entries from the bounded cache", async () => {
  const cache = new MarkdownLinkPreviewCache(async () => ready);
  for (let index = 0; index < 65; index += 1) {
    await cache.resolve(`https://host${index}.example.com`);
  }
  assert.equal(cache.get("https://host0.example.com"), undefined);
  assert.deepEqual(cache.get("https://host64.example.com/another-page"), ready);
  const oversized = new MarkdownLinkPreviewCache(async () => ({
    state: "ready",
    faviconDataUrl: "a".repeat(16 * 1024 * 1024),
    faviconDarkDataUrl: null,
  }));
  await oversized.resolve("https://example.com");
  assert.equal(oversized.get("https://example.com"), undefined);
});
