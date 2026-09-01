import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ActivityIndicator } from "./activity-indicator";

test("renders the nine-pixel activity pattern with an accessible label", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityIndicator, { label: "Loading more connectors" }),
  );

  assert.match(html, /role="status"/);
  assert.match(html, /aria-label="Loading more connectors"/);
  assert.equal(html.match(/radius-thinking-pixel/g)?.length, 9);
});

test("stays decorative when a nearby status already owns the announcement", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityIndicator, { active: false }),
  );

  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /data-active="false"/);
  assert.doesNotMatch(html, /role="status"/);
});
