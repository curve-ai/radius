import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "@renderer/components/ui/tooltip";
import { MessageImage, MessageImageUnavailable } from "./message-image";

Object.assign(globalThis, { React });

function renderImage(size: "assistant" | "user" = "assistant"): string {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(MessageImage, {
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        alt: "Preview",
        size,
      }),
    ),
  );
}

test("keeps generated images accessible without inventing a visible caption", () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(MessageImage, {
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        alt: "Generated image",
        caption: null,
      }),
    ),
  );

  assert.match(html, /<img[^>]*alt="Generated image"/);
  assert.doesNotMatch(html, /<figcaption/);
});

test("uses compact assistant and smaller user thumbnail bounds", () => {
  const assistant = renderImage();
  assert.match(assistant, /max-h-32 max-w-60/);
  assert.match(assistant, /aria-label="Expand image"/);
  assert.match(assistant, /cursor-zoom-in/);
  assert.match(assistant, /right-1\.5 top-1\.5/);
  assert.doesNotMatch(assistant, /pr-8/);
  assert.match(renderImage("user"), /max-h-24 max-w-40/);
});

test("collapses unavailable remote images into a muted source link", () => {
  const html = renderToStaticMarkup(
    createElement(MessageImageUnavailable, {
      alt: "Remote preview",
      href: "https://example.com/image.png",
      reason: "Image is unavailable",
    }),
  );

  assert.match(html, /href="https:\/\/example.com\/image.png"/);
  assert.match(html, /text-muted-foreground/);
  assert.match(html, /hover:underline/);
  assert.match(html, />Remote preview<\/span>/);
  assert.doesNotMatch(html, /h-32|w-60|border-border|bg-muted/);
});

test("keeps remote image resolution deferred during streaming", () => {
  const html = renderToStaticMarkup(
    createElement(MessageImage, {
      src: "https://example.com/image.png",
      alt: "Remote preview",
      resolveEnabled: false,
    }),
  );

  assert.match(html, /data-image-resolution="deferred"/);
  assert.doesNotMatch(html, /<img/);
});
