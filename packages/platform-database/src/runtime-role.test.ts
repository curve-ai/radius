import assert from "node:assert/strict";
import test from "node:test";
import { runtimeRoleCredentials } from "./runtime-role.js";

const administrator = "postgresql://radius:admin@localhost:5432/radius";
const runtime = "postgresql://radius_runtime:p%27ass%3Aword@localhost/radius";
test("runtime role configuration decodes credentials and normalizes default port", () => {
  assert.deepEqual(runtimeRoleCredentials(runtime, administrator), {
    role: "radius_runtime",
    password: "p'ass:word",
  });
});
test("runtime role configuration rejects target, identity and query overrides", () => {
  for (const candidate of [
    runtime.replace("localhost", "elsewhere"),
    runtime.replace("/radius", "/other"),
    runtime.replace("radius_runtime", "radius"),
    "postgresql://radius_runtime@localhost/radius",
    `${runtime}?user=radius`,
    `${runtime}?host=elsewhere`,
    `${runtime}?options=-crole=radius`,
  ]) {
    assert.throws(() => runtimeRoleCredentials(candidate, administrator));
  }
  assert.throws(() => runtimeRoleCredentials(runtime, runtime));
});
