import assert from "node:assert/strict";
import test from "node:test";

import {
  platformDeviceFingerprint,
  platformReportingConfig,
} from "./platform-reporting";

test("requires the complete optional Platform reporting configuration", () => {
  assert.equal(platformReportingConfig({}), null);
  assert.throws(
    () =>
      platformReportingConfig({
        RADIUS_PLATFORM_API_URL: "https://platform.example.com",
      }),
    /must be configured together/,
  );
  assert.throws(
    () =>
      platformReportingConfig({
        RADIUS_PLATFORM_API_URL: "https://platform.example.com",
        RADIUS_PLATFORM_ACCESS_TOKEN: "secret",
        RADIUS_PLATFORM_ORGANIZATION: "development",
      }),
    /RADIUS_RUNTIME_VERSION must be configured together/,
  );
  assert.deepEqual(
    platformReportingConfig({
      RADIUS_PLATFORM_API_URL: "https://platform.example.com",
      RADIUS_PLATFORM_ACCESS_TOKEN: "secret",
      RADIUS_PLATFORM_ORGANIZATION: "development",
      RADIUS_RUNTIME_VERSION: "0.1.0",
    }),
    {
      apiUrl: "https://platform.example.com",
      accessToken: "secret",
      organization: "development",
      runtimeVersion: "0.1.0",
      allowInsecureHttp: false,
    },
  );
});

test("derives a stable non-secret physical-device fingerprint", () => {
  const first = platformDeviceFingerprint({
    kty: "OKP",
    crv: "Ed25519",
    x: "public-key",
  });
  const second = platformDeviceFingerprint({
    x: "public-key",
    crv: "Ed25519",
    kty: "OKP",
  });
  assert.equal(first, second);
  assert.match(first, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(first, /public-key/);
});
