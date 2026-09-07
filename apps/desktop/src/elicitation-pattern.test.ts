import assert from "node:assert/strict";
import test from "node:test";

import {
  compileElicitationPattern,
  matchesElicitationPattern,
} from "./elicitation-pattern";

test("matches bounded non-grouping elicitation patterns", () => {
  assert.equal(matchesElicitationPattern("^R-[0-9]+$", "R-42"), true);
  assert.equal(matchesElicitationPattern("^R-[0-9]+$", "wrong"), false);
  assert.equal(matchesElicitationPattern("^[()]$", "("), true);
});

test("rejects grouping, backreferences, and oversized pattern inputs", () => {
  assert.throws(
    () => compileElicitationPattern("^(a+)+$"),
    /ELICITATION_PATTERN_UNSUPPORTED/,
  );
  assert.throws(
    () => compileElicitationPattern("^([a-z]+)\\1$"),
    /ELICITATION_PATTERN_UNSUPPORTED/,
  );
  assert.equal(matchesElicitationPattern("^a+$", "a".repeat(4_097)), false);
});
