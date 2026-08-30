import assert from "node:assert/strict";
import test from "node:test";

import {
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
