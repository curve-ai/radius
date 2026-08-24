import assert from "node:assert/strict";
import test from "node:test";

import { isThemePreference, resolveTheme } from "./theme";

test("recognizes supported theme preferences", () => {
  assert.equal(isThemePreference("system"), true);
  assert.equal(isThemePreference("light"), true);
  assert.equal(isThemePreference("dark"), true);
  assert.equal(isThemePreference("sepia"), false);
  assert.equal(isThemePreference(null), false);
});

test("resolves explicit light and dark preferences", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("resolves the system preference from the active color scheme", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});
