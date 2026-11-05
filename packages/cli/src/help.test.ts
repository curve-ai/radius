import assert from "node:assert/strict";
import { test } from "node:test";

import { expandHelpCommand } from "./help.js";

test("`radius help` asks for the same list as `radius --help`", () => {
  assert.deepEqual(expandHelpCommand(["help"]), ["--help"]);
});

test("`radius help <command>` asks for that command's help", () => {
  assert.deepEqual(expandHelpCommand(["help", "app", "install"]), [
    "app",
    "install",
    "--help",
  ]);
});

test("other invocations pass through untouched", () => {
  assert.deepEqual(expandHelpCommand([]), []);
  assert.deepEqual(expandHelpCommand(["check", "--json"]), ["check", "--json"]);
});
