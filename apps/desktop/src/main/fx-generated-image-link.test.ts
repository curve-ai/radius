import assert from "node:assert/strict";
import test from "node:test";

import { splitGeneratedImageLinks } from "../generated-image-link";
import { fxStateRelativeImagePath } from "./fx-generated-image-link";

test("splits fx generated-image links while preserving surrounding text", () => {
  assert.deepEqual(
    splitGeneratedImageLinks(
      "Here: [▧ Blue circle](sandbox:/opt/data/blue-circle.png).",
    ),
    [
      { kind: "text", text: "Here: " },
      {
        kind: "image",
        alt: "Blue circle",
        raw: "[▧ Blue circle](sandbox:/opt/data/blue-circle.png)",
        uri: "sandbox:/opt/data/blue-circle.png",
      },
      { kind: "text", text: "." },
    ],
  );
});

test("recognizes HTTPS generated-image links for renderer promotion", () => {
  assert.deepEqual(
    splitGeneratedImageLinks("[▧ Preview](https://example.com/image.png)"),
    [
      {
        kind: "image",
        alt: "Preview",
        raw: "[▧ Preview](https://example.com/image.png)",
        uri: "https://example.com/image.png",
      },
    ],
  );
});

test("accepts only normalized files beneath the fx state share", () => {
  assert.equal(
    fxStateRelativeImagePath("sandbox:/opt/data/output/generated.png"),
    "output/generated.png",
  );
  assert.equal(
    fxStateRelativeImagePath("sandbox:/opt/data/../secret.png"),
    null,
  );
  assert.equal(fxStateRelativeImagePath("sandbox:/etc/passwd"), null);
});
