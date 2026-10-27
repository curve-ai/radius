import assert from "node:assert/strict";
import test from "node:test";
import { accountProfile } from "./account-profile";

test("preload profile contains only bounded presentation fields", () => {
  assert.deepEqual(
    accountProfile({
      displayName: " Alexey\n ",
      email: " alexey@example.com ",
      accessToken: "private",
      role: "owner",
    }),
    { displayName: "Alexey", email: "alexey@example.com" },
  );
  assert.deepEqual(accountProfile({ displayName: {}, email: 123 }), {
    displayName: null,
    email: null,
  });
  assert.equal(accountProfile(null), null);
  assert.equal(
    accountProfile({ displayName: "x".repeat(500) })?.displayName?.length,
    120,
  );
});
