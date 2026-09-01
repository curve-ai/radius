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
  assert.match(html, /mt-\[0\.3125rem\]/);
  assert.match(html, /<dl[^>]*>/);
  assert.match(html, /<dt[^>]*>Term<\/dt>/);
  assert.match(html, /<dd[^>]*>Definition text\s*<\/dd>/);
});

test("gives heading levels a clear compact hierarchy", () => {
  const html = render(
    [
      "# One",
      "",
      "## Two",
      "",
      "### Three",
      "",
      "#### Four",
      "",
      "##### Five",
      "",
      "###### Six",
    ].join("\n"),
  );

  assert.match(html, /<h1[^>]*text-2xl/);
  assert.match(html, /<h2[^>]*text-xl/);
  assert.match(html, /<h3[^>]*text-lg/);
  assert.match(html, /<h4[^>]*text-base/);
  assert.match(html, /<h5[^>]*text-sm/);
  assert.match(html, /<h6[^>]*text-xs/);
});

test("uses the shadcn typography recipe for blockquotes", () => {
  const html = render("> A compact quote.");

  assert.match(html, /<blockquote[^>]*border-l-2[^>]*italic/);
  assert.match(html, /<p[^>]*>A compact quote\.<\/p>/);
});

test("renders provider quote groups without inventing section headings", () => {
  const html = render(
    ["Sample quotes", "", "│ “Belong anywhere.”", "│ — Airbnb tagline"].join(
      "\n",
    ),
  );

  assert.match(html, /<p[^>]*>Sample quotes<\/p>/);
  assert.doesNotMatch(html, /<h[1-6][^>]*>Sample quotes<\/h[1-6]>/);
  assert.equal((html.match(/<blockquote/g) ?? []).length, 1);
  assert.equal((html.match(/<p/g) ?? []).length, 3);
  assert.match(html, /Airbnb tagline/);
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
  assert.match(html, /data-streaming="true"/);
  assert.doesNotMatch(html, /aria-label="Copy code"/);
  assert.doesNotMatch(html, /aria-label="Expand code"/);
});

test("keeps streaming Mermaid as plain source until completion", () => {
  const html = renderStreaming("```mermaid\nflowchart LR\n  Prompt --");

  assert.match(html, /flowchart LR/);
  assert.match(html, /data-streaming="true"/);
  assert.doesNotMatch(html, /Rendering diagram/);
  assert.doesNotMatch(html, /aria-label="Expand diagram"/);
});

test("renders math without trusting HTML-capable TeX commands", () => {
  const html = render("Inline $E = mc^2$.\n\n$$\n\\int_0^1 x^2 dx\n$$");

  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
  assert.doesNotMatch(html, /<script/);
});

test("keeps math literal while the message is streaming", () => {
  const html = renderStreaming("Inline $E = mc^2$.");

  assert.match(html, /\$E = mc\^2\$/);
  assert.doesNotMatch(html, /class="katex/);
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

test("keeps ratios and other colon prose out of directive rendering", () => {
  const html = render("Create a 16:9 PNG image.");

  assert.match(html, /Create a 16:9 PNG image\./);
  assert.doesNotMatch(html, /:::9/);
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

test("renders bounded media and hover-underlined transcript links", () => {
  const html = render(
    [
      "![Remote image](https://example.com/image.png)",
      "",
      "https://example.com/article",
    ].join("\n"),
  );

  assert.match(html, /Remote image/);
  assert.match(html, /no-underline/);
  assert.match(html, /hover:underline/);
  assert.doesNotMatch(html, /src="https:\/\/example.com\/image.png"/);
});

test("keeps authored link labels and omits a globe fallback while streaming", () => {
  const html = renderStreaming("[Google Drive](https://drive.google.com)");

  assert.match(html, />Google Drive<\/span>/);
  assert.doesNotMatch(html, /<svg/);
  assert.doesNotMatch(html, /Google Drive -/);
});

test("defers remote image resolution while streaming", () => {
  const html = renderStreaming(
    "![Remote image](https://example.com/image.png)",
  );

  assert.match(html, /data-image-resolution="deferred"/);
  assert.doesNotMatch(html, /src="https:\/\/example.com\/image.png"/);
});

test("does not restyle the current last paragraph during appends", () => {
  const html = renderStreaming("First paragraph.\n\nSecond paragraph.");

  assert.doesNotMatch(html, /last:mb-0/);
  assert.equal((html.match(/class="mb-3"/g) ?? []).length, 2);
});

test("removes trailing paragraph space after a message completes", () => {
  const html = render("Who are you?");

  assert.match(html, /class="mb-3 last:mb-0"/);
});

test("renders project file links with their file-type icon", () => {
  const html = render("[message-markdown.tsx](/tmp/message-markdown.tsx:42)");

  assert.match(html, /data-file-icon="react"/);
  assert.match(html, /href="\/tmp\/message-markdown.tsx:42"/);
  assert.doesNotMatch(html, /target="_blank"/);
});

test("renders an inline image with its Markdown alt text as a caption", () => {
  const html = render(
    "![Generated preview](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB)",
  );

  assert.match(html, /<img[^>]*alt="Generated preview"/);
  assert.match(html, /<figcaption[^>]*>Generated preview<\/figcaption>/);
});

test("groups consecutive Markdown images into a wrapping gallery", () => {
  const source = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
  const html = render(`![First](${source})\n![Second](${source})`);

  assert.match(html, /flex-wrap/);
  assert.equal((html.match(/<figure/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<p[^>]*>\s*<figure/);
});

test("renders fx generated-image links as images with their label as alt text", () => {
  const html = render(
    "Here it is: [▧ Blue circle](sandbox:/Users/example/.codex/generated_images/circle.png).",
  );

  assert.doesNotMatch(html, /<a[^>]*>▧/);
  assert.match(html, /<figcaption[^>]*>Blue circle<\/figcaption>/);
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
  assert.match(expanded, /w-fit/);
  assert.match(expanded, /min-w-full/);
  assert.match(expanded, /w-max/);
  assert.match(expanded, /table-auto/);
  assert.doesNotMatch(expanded, /<table[^>]*class="[^"]*w-full/);
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

test("renders provider bullet glyphs as separate list items", () => {
  const html = render(
    "• [TASK-101](https://linear.app/example/TASK-101) — Dropdown. • [TASK-102](https://linear.app/example/TASK-102) — Expansion.",
  );

  assert.match(html, /<ul/);
  assert.equal((html.match(/<li/g) ?? []).length, 2);
  assert.match(html, /gap-0/);
  assert.match(html, /leading-5/);
  assert.doesNotMatch(html, />\s*•\s*</);
});

test("renders an authored heading without exposing its hash markers", () => {
  const html = render(
    "### In progress\n\nThese are implemented locally.\n\n• Ready item",
  );

  assert.match(html, /<h3[^>]*>In progress<\/h3>/);
  assert.doesNotMatch(html, /### In progress/);
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
