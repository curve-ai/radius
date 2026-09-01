import assert from "node:assert/strict";
import test from "node:test";

import {
  extractLinkMetadata,
  isPublicIpAddress,
  resolveMarkdownLinkPreview,
  resolveMarkdownMedia,
} from "./markdown-resource";

test("blocks private and reserved Markdown resource addresses", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.168.0.1",
    "198.18.0.1",
    "203.0.113.1",
    "224.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
});

test("allows public Markdown resource addresses", () => {
  assert.equal(isPublicIpAddress("1.1.1.1"), true);
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});

test("extracts bounded link metadata without hydrating markup", () => {
  const metadata = extractLinkMetadata(`
    <html>
      <head>
        <title>Fallback title</title>
        <meta property="og:title" content="Radius &amp; Markdown">
        <meta property="og:description" content="A &lt;safe&gt; preview">
        <meta property="og:site_name" content="Example">
        <meta property="og:image" content="/preview.png">
        <link rel="icon" href="/favicon.png">
        <link rel="icon" media="(prefers-color-scheme: dark)" href="/favicon-dark.png">
        <link rel="icon" media="(prefers-color-scheme: light)" href="/favicon-light.png">
      </head>
    </html>
  `);

  assert.deepEqual(metadata, {
    title: "Radius & Markdown",
    description: "A preview",
    iconDarkUrl: "/favicon-dark.png",
    iconLightUrl: "/favicon-light.png",
    iconUrl: "/favicon.png",
    siteName: "Example",
    imageUrl: "/preview.png",
  });
});

test("extracts metadata from a truncated HTML head", () => {
  assert.deepEqual(
    extractLinkMetadata(`
      <head>
        <title>Large documentation page</title>
        <link rel="shortcut icon" href="/favicon-16x16.png">
    `),
    {
      title: "Large documentation page",
      description: null,
      iconDarkUrl: null,
      iconLightUrl: null,
      iconUrl: "/favicon-16x16.png",
      siteName: null,
      imageUrl: null,
    },
  );
});

test("prefers a declared raster touch icon over ICO and SVG variants", () => {
  assert.equal(
    extractLinkMetadata(`
      <link rel="icon" href="/favicon.ico" sizes="any">
      <link rel="icon" href="/favicon.svg" type="image/svg+xml">
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" type="image/png">
    `).iconUrl,
    "/apple-touch-icon.png",
  );
});

test("rejects unsafe Markdown media and preview URLs before fetching", async () => {
  assert.deepEqual(await resolveMarkdownMedia("http://example.com/image.png"), {
    state: "blocked",
    reason: "unsafe_url",
  });
  assert.deepEqual(await resolveMarkdownMedia("https://127.0.0.1/image.png"), {
    state: "blocked",
    reason: "unsafe_url",
  });
  assert.deepEqual(await resolveMarkdownMedia("https://[::1]/image.png"), {
    state: "blocked",
    reason: "unsafe_url",
  });
  assert.deepEqual(
    await resolveMarkdownLinkPreview("https://user:secret@example.com"),
    { state: "blocked", reason: "unsafe_url" },
  );
});
