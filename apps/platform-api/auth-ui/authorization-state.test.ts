import assert from "node:assert/strict";
import test from "node:test";
import { authorizationLinkExpired } from "./authorization-state";

test("expired native links are explained before requesting another email", () => {
  assert.equal(
    authorizationLinkExpired("?client_id=radius&exp=100", 100_000),
    true,
  );
  assert.equal(
    authorizationLinkExpired("?client_id=radius&exp=101", 100_000),
    false,
  );
  assert.equal(
    authorizationLinkExpired("?client_id=radius&exp=invalid", 100_000),
    true,
  );
  assert.equal(authorizationLinkExpired("?client_id=radius", 100_000), true);
  assert.equal(authorizationLinkExpired("", 100_000), false);
});
