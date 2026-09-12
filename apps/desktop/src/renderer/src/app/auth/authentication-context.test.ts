import assert from "node:assert/strict";
import test from "node:test";
import { accountInitials, accountLabel } from "./authentication-context";

test("account footer uses verified name or email rather than a workspace placeholder", () => {
  assert.equal(
    accountLabel({
      displayName: "Alexey Shishlyannikov",
      email: "alexey@example.com",
    }),
    "Alexey Shishlyannikov",
  );
  assert.equal(
    accountLabel({ displayName: "", email: "alexey@example.com" }),
    "alexey@example.com",
  );
  assert.equal(accountLabel(null), "Your account");
  assert.equal(accountInitials("Alexey Shishlyannikov"), "AS");
  assert.equal(accountInitials("shishlyannikov.dev@gmail.com"), "S");
  assert.equal(accountInitials("Élodie"), "É");
});
