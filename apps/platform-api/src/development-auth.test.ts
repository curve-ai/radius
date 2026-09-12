import assert from "node:assert/strict";
import test from "node:test";
import { isLocalDevelopmentAuth } from "./development-auth.js";

const local = {
  RADIUS_LOCAL_DEVELOPMENT: "true",
  NODE_ENV: "development",
  HOST: "127.0.0.1",
  DATABASE_URL:
    "postgresql://radius:password@127.0.0.1:5442/radius_development",
};
test("development owner bootstrap cannot activate on a production or shared database", () => {
  assert.equal(isLocalDevelopmentAuth(local), true);
  assert.equal(isLocalDevelopmentAuth({}), false);
  for (const override of [
    { NODE_ENV: "production" },
    { HOST: "0.0.0.0" },
    { RADIUS_PLATFORM_SHARED_ORIGINS: "true" },
    { DATABASE_URL: "postgresql://radius:password@remote/radius_development" },
    { DATABASE_URL: "postgresql://radius:password@127.0.0.1/radius_cloud" },
  ]) {
    assert.throws(
      () => isLocalDevelopmentAuth({ ...local, ...override }),
      /isolated/,
    );
  }
});
