import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RadiusProfileStore } from "./profiles.js";

test("stores only normalized non-secret target profile data", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-profiles-"));
  const path = join(root, "profiles.json");
  const store = new RadiusProfileStore(path);
  await store.add("self_hosted", "http://127.0.0.1:3100/path");
  await store.add("cloud", "https://acme.curvehq.sh/workspace");
  await store.switch("cloud");

  const document = await store.list();
  assert.equal(document.active, "cloud");
  assert.deepEqual(document.profiles, {
    self_hosted: { apiUrl: "http://127.0.0.1:3100" },
    cloud: { apiUrl: "https://acme.curvehq.sh" },
  });
  const mode = (await stat(path)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("rejects insecure remote profile origins", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-profiles-http-"));
  const store = new RadiusProfileStore(join(root, "profiles.json"));
  await assert.rejects(
    store.add("unsafe", "http://platform.example.com"),
    /must use HTTPS/,
  );
});
