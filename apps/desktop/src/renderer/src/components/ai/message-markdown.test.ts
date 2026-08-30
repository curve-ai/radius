import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "@renderer/components/ui/tooltip";
import { MessageMarkdown } from "./message-markdown";

Object.assign(globalThis, { React });

function render(markdown: string, fullWidthTables = false): string {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(MessageMarkdown, { fullWidthTables, markdown }),
    ),
  );
}

function renderStreaming(markdown: string): string {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(MessageMarkdown, {
        fullWidthTables: true,
        markdown,
        streaming: true,
      }),
    ),
  );
}

test("renders common Markdown and safe external links", () => {
  const html = render("**Strong** and [Radius](https://example.com).\n\n- One");

  assert.match(html, /<strong[^>]*>Strong<\/strong>/);
  assert.match(html, /<ul[^>]*>/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noreferrer"/);
});

test("removes unsafe link protocols", () => {
  const html = render("[Unsafe](javascript:alert('no'))");

  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /<script/);
});

test("renders deliberate CommonMark, task-list, and definition components", () => {
  const html = render(
    [
      "#### Four",
      "##### Five",
      "###### Six",
      "",
      "*Emphasis* and ~~removed~~.",
      "",
      "- [x] Complete",
      "- [ ] Pending",
      "",
      "Term",
      ": Definition text",
    ].join("\n"),
  );

  assert.match(html, /<h4[^>]*>Four<\/h4>/);
  assert.match(html, /<h5[^>]*>Five<\/h5>/);
  assert.match(html, /<h6[^>]*>Six<\/h6>/);
  assert.match(html, /<em[^>]*>Emphasis<\/em>/);
  assert.match(html, /<del[^>]*>removed<\/del>/);
  assert.match(html, /type="checkbox"[^>]*disabled=""[^>]*checked=""/);
  assert.match(html, /<dl[^>]*>/);
  assert.match(html, /<dt[^>]*>Term<\/dt>/);
  assert.match(html, /<dd[^>]*>Definition text\s*<\/dd>/);
});

test("renders code blocks with language, copy, and expand controls", () => {
  const html = render("```typescript\nconst ready = true;\n```");

  assert.match(html, />typescript</);
  assert.match(html, /const ready = true;/);
  assert.match(html, /aria-label="Copy code"/);
  assert.match(html, /aria-label="Expand code"/);
  assert.doesNotMatch(html, /radius-message-markdown-code/);
});

test("keeps streaming code readable without unstable controls", () => {
  const html = renderStreaming("```typescript\nconst partial = tr");

  assert.match(html, /const partial = tr/);
  assert.doesNotMatch(html, /aria-label="Copy code"/);
  assert.doesNotMatch(html, /aria-label="Expand code"/);
});

test("renders math without trusting HTML-capable TeX commands", () => {
  const html = render("Inline $E = mc^2$.\n\n$$\n\\int_0^1 x^2 dx\n$$");

  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
  assert.doesNotMatch(html, /<script/);
});

test("renders Radius callouts and disclosures while preserving unknown directives", () => {
  const html = render(
    [
      ":::note Safe callout",
      "Body **text**.",
      ":::",
      "",
      ":::details More information",
      "Hidden body.",
      ":::",
      "",
      ":::custom[Unknown]",
      "Readable body.",
      ":::",
    ].join("\n"),
  );

  assert.match(html, /role="note"/);
  assert.match(html, />Safe callout</);
  assert.match(html, /<details[^>]*>/);
  assert.match(html, /<summary[^>]*>More information<\/summary>/);
  assert.match(html, /:::custom/);
  assert.match(html, /Readable body/);
});

test("keeps footnotes message-local and keyboard-targetable", () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(
        "div",
        null,
        createElement(MessageMarkdown, {
          markdown: "First[^1].\n\n[^1]: One",
        }),
        createElement(MessageMarkdown, {
          markdown: "Second[^1].\n\n[^1]: Two",
        }),
      ),
    ),
  );
  const ids = Array.from(html.matchAll(/id="(radius-[^"]*-fn-1)"/g)).map(
    (match) => match[1],
  );

  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  assert.match(html, /data-footnotes="true"/);
  assert.doesNotMatch(html, /id="footnote-label"/);
});

test("offers bounded media and opt-in standalone link previews", () => {
  const html = render(
    [
      "![Remote image](https://example.com/image.png)",
      "",
      "https://example.com/article",
    ].join("\n"),
  );

  assert.match(html, /Remote image/);
  assert.match(html, /Preview link/);
  assert.doesNotMatch(html, /src="https:\/\/example.com\/image.png"/);
});

test("keeps Mermaid inert while its bounded renderer loads", () => {
  const html = render("```mermaid\nflowchart LR\n  A --> B\n```");

  assert.match(html, /Rendering diagram/);
  assert.doesNotMatch(html, /<svg/);
});

test("renders GFM tables with the optional full-canvas breakout class", () => {
  const markdown = "| Name | State |\n| --- | --- |\n| Runtime | Ready |";
  const constrained = render(markdown);
  const expanded = render(markdown, true);

  assert.match(expanded, /<table/);
  assert.match(expanded, /<th[^>]*>Name<\/th>/);
  assert.doesNotMatch(constrained, /radius-message-table-breakout/);
  assert.match(expanded, /radius-message-table-breakout/);
  assert.match(expanded, /data-slot="table"/);
  assert.match(expanded, /h-11 px-3/);
  assert.match(expanded, /px-3 py-2.5/);
  assert.match(expanded, /hover:bg-transparent/);
  assert.match(expanded, /aria-label="Copy table"/);
  assert.match(expanded, /aria-label="Expand table"/);
  assert.match(expanded, /radius-message-table-layout/);
  assert.match(expanded, /pr-8/);
  assert.match(expanded, /size-6/);
  assert.match(expanded, /\[&amp;&gt;svg\]:size-3!/);
});

test("normalizes terminal tables before rendering the shadcn table", () => {
  const html = render(
    [
      "Country │ Population",
      "────────┼───────────",
      "Canada  │ 40 million",
    ].join("\n"),
    true,
  );

  assert.match(html, /data-slot="table"/);
  assert.match(html, /<th[^>]*>Country<\/th>/);
  assert.match(html, /<td[^>]*>Canada<\/td>/);
  assert.doesNotMatch(html, /────────/);
});

test("does not hydrate raw HTML from agent Markdown", () => {
  const html = render("Before <script>alert('no')</script> after");

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /alert\(&#x27;no&#x27;\)/);
  assert.match(html, /Before/);
  assert.match(html, /after/);
});

test("renders incomplete streaming table cells instead of waiting for completion", () => {
  const html = renderStreaming(
    [
      "Country │ Population │ Area",
      "────────┼────────────┼─────",
      "Canada │ 40 mil",
    ].join("\n"),
  );

  assert.match(html, /<td[^>]*>Canada<\/td>/);
  assert.match(html, /<td[^>]*>40 mil<\/td>/);
  assert.doesNotMatch(html, /aria-label="Copy table"/);
  assert.doesNotMatch(html, /aria-label="Expand table"/);
});
