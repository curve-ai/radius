import assert from "node:assert/strict";
import test from "node:test";

import {
  messageMarkdownForCopy,
  normalizeMessageMarkdown,
  tableRowsAsMarkdown,
} from "./message-markdown-normalize";

test("normalizes the terminal table format emitted by local agents", () => {
  const markdown = [
    "Countries:",
    "Country │ Population │ Land per person",
    "────────┼────────────┼────────────────",
    "Russia  │ 144 million│ 113,700 m²",
    "Canada  │ 40 million │ 227,300 m²",
    "",
    "Figures are approximate.",
  ].join("\n");

  assert.equal(
    normalizeMessageMarkdown(markdown),
    [
      "Countries:",
      "| Country | Population | Land per person |",
      "| --- | --- | --- |",
      "| Russia | 144 million | 113,700 m² |",
      "| Canada | 40 million | 227,300 m² |",
      "",
      "Figures are approximate.",
    ].join("\n"),
  );
});

test("keeps terminal tables literal inside fenced code blocks", () => {
  const markdown = [
    "```text",
    "Name │ State",
    "─────┼──────",
    "API  │ Ready",
    "```",
  ].join("\n");

  assert.equal(normalizeMessageMarkdown(markdown), markdown);
});

test("promotes provider-prefixed source into a fenced code block", () => {
  assert.equal(
    normalizeMessageMarkdown(
      [
        "│ type RadiusMarkdown = {",
        "│   safe: true;",
        "│   components: string[];",
        "│ };",
      ].join("\n"),
    ),
    [
      "```typescript",
      "type RadiusMarkdown = {",
      "  safe: true;",
      "  components: string[];",
      "};",
      "```",
    ].join("\n"),
  );
});

test("groups provider-prefixed quote lines into one blockquote", () => {
  assert.equal(
    normalizeMessageMarkdown(
      ["│ “Belong anywhere.”", "│ — Airbnb tagline"].join("\n"),
    ),
    ["> “Belong anywhere.”", ">", "> — Airbnb tagline"].join("\n"),
  );
});

test("keeps plain labels faithful while normalizing explicit structures", () => {
  assert.equal(
    normalizeMessageMarkdown(
      [
        "Company and service links",
        "",
        "• [Google](https://google.com)",
        "• [Google Maps](https://maps.google.com)",
        "",
        "Sample quotes",
        "",
        "│ “Think different.”",
        "│ — Apple campaign tagline",
        "",
        "Company data",
        "",
        "Company │ Industry",
        "────────┼─────────",
        "Apple   │ Technology",
      ].join("\n"),
    ),
    [
      "Company and service links",
      "",
      "- [Google](https://google.com)",
      "- [Google Maps](https://maps.google.com)",
      "",
      "Sample quotes",
      "",
      "> “Think different.”",
      ">",
      "> — Apple campaign tagline",
      "",
      "Company data",
      "",
      "| Company | Industry |",
      "| --- | --- |",
      "| Apple | Technology |",
    ].join("\n"),
  );
});

test("preserves explicit Markdown headings before structured content", () => {
  for (let level = 1; level <= 6; level += 1) {
    const marker = "#".repeat(level);
    assert.equal(
      normalizeMessageMarkdown(
        [
          `${marker} In progress`,
          "",
          "These are implemented locally and tested.",
          "",
          "• Ready item",
        ].join("\n"),
      ),
      [
        `${marker} In progress`,
        "",
        "These are implemented locally and tested.",
        "",
        "- Ready item",
      ].join("\n"),
    );
  }
});

test("copies normalized lists without inventing headings", () => {
  assert.equal(
    messageMarkdownForCopy(
      [
        "Company and service links",
        "",
        "• [Google](https://google.com)",
        "• [Airbnb](https://airbnb.com)",
      ].join("\n"),
    ),
    [
      "Company and service links",
      "",
      "- [Google](https://google.com)",
      "- [Airbnb](https://airbnb.com)",
    ].join("\n"),
  );
});

test("turns provider bullet glyphs into vertical Markdown lists", () => {
  assert.equal(
    normalizeMessageMarkdown(
      [
        "Verified on staging",
        "",
        "• [TASK-101](https://linear.app/example/TASK-101) — Dropdown. • [TASK-102](https://linear.app/example/TASK-102) — Expansion.",
        "",
        "In progress",
        "",
        "These are implemented locally and tested.",
        "",
        "• [TASK-103](https://linear.app/example/TASK-103) — Empty categories.",
      ].join("\n"),
    ),
    [
      "Verified on staging",
      "",
      "- [TASK-101](https://linear.app/example/TASK-101) — Dropdown.",
      "- [TASK-102](https://linear.app/example/TASK-102) — Expansion.",
      "",
      "In progress",
      "",
      "These are implemented locally and tested.",
      "",
      "- [TASK-103](https://linear.app/example/TASK-103) — Empty categories.",
    ].join("\n"),
  );
});

test("normalizes provider bullet glyphs while output is streaming", () => {
  assert.equal(
    normalizeMessageMarkdown("• First item\n• Second item", {
      streaming: true,
    }),
    "- First item\n- Second item",
  );
});

test("does not infer section headings from plain labels", () => {
  assert.equal(
    normalizeMessageMarkdown(
      "Company data\n\nCompany │ Industry\n────────┼─────────\nApple │ Technology",
    ),
    "Company data\n\n| Company | Industry |\n| --- | --- |\n| Apple | Technology |",
  );
});

test("does not close a fence with a different marker or a shorter run", () => {
  const markdown = [
    "````text",
    "~~~",
    "Name │ State",
    "─────┼──────",
    "API  │ Ready",
    "```",
    "````",
  ].join("\n");

  assert.equal(normalizeMessageMarkdown(markdown), markdown);
});

test("leaves prose containing pipes unchanged without a separator rule", () => {
  const markdown = "Choose A | B when comparing two options.";

  assert.equal(normalizeMessageMarkdown(markdown), markdown);
});

test("progressively pads incomplete terminal rows while streaming", () => {
  const markdown = [
    "Country │ Population │ Area",
    "────────┼────────────┼─────",
    "Canada │ 40 mil",
  ].join("\n");

  assert.equal(
    normalizeMessageMarkdown(markdown, { streaming: true }),
    [
      "| Country | Population | Area |",
      "| --- | --- | --- |",
      "| Canada | 40 mil |  |",
    ].join("\n"),
  );
});

test("renders a header-only table as soon as its rule completes", () => {
  const markdown = ["Country │ Population", "────────┼───────────"].join("\n");

  assert.equal(
    normalizeMessageMarkdown(markdown, { streaming: true }),
    ["| Country | Population |", "| --- | --- |"].join("\n"),
  );
});

test("shares pipe escaping with copied Markdown tables", () => {
  assert.equal(
    tableRowsAsMarkdown([
      ["Name", "State"],
      ["A | B", "Ready"],
    ]),
    "| Name | State |\n| --- | --- |\n| A \\| B | Ready |",
  );
});

test("normalizes Radius directive titles without changing fenced source", () => {
  assert.equal(
    normalizeMessageMarkdown(
      [
        ":::note Safe callout",
        "Body",
        ":::",
        "```markdown",
        ":::note Literal source",
        "```",
      ].join("\n"),
    ),
    [
      ":::note[Safe callout]",
      "Body",
      ":::",
      "```markdown",
      ":::note Literal source",
      "```",
    ].join("\n"),
  );
});

test("promotes fx generated-image links without changing fenced source", () => {
  assert.equal(
    normalizeMessageMarkdown(
      [
        "Here is the image: [▧ Blue circle](sandbox:/Users/example/.codex/generated_images/circle.png).",
        "",
        "```markdown",
        "[▧ Literal](https://example.com/image.png)",
        "```",
      ].join("\n"),
    ),
    [
      "Here is the image: ",
      "",
      "![Blue circle](sandbox:/Users/example/.codex/generated_images/circle.png)",
      "",
      ".",
      "",
      "```markdown",
      "[▧ Literal](https://example.com/image.png)",
      "```",
    ].join("\n"),
  );
});

test("escapes numeric ratios before directive parsing", () => {
  assert.equal(
    normalizeMessageMarkdown("Create a 16:9 PNG image."),
    "Create a 16\\:9 PNG image.",
  );
});
