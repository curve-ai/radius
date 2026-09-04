import assert from "node:assert/strict";
import { test } from "node:test";

import { organizationBaseUrl, readCloudSetupState } from "./cloud-setup-state";

function respond(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

test("swaps the leading hostname label for the organization's", () => {
  assert.equal(
    organizationBaseUrl("https://app.curvehq.sh", "northwind"),
    "https://northwind.curvehq.sh/",
  );
  assert.equal(
    organizationBaseUrl("http://app.localhost:8080", "northwind"),
    "http://northwind.localhost:8080/",
  );
});

test("reports being signed out rather than failing", async () => {
  const state = await readCloudSetupState(
    "https://app.curvehq.sh",
    respond(401, { error: "UNAUTHORIZED" }),
  );
  assert.equal(state.status, "signed-out");
});

test("waits while the workspace is still being provisioned", async () => {
  for (const lifecycleState of ["requested", "activating"]) {
    const state = await readCloudSetupState(
      "https://app.curvehq.sh",
      respond(200, {
        organization: {
          slug: "northwind",
          hostnameLabel: "northwind",
          lifecycleState,
        },
      }),
    );
    assert.equal(state.status, "provisioning");
  }
});

test("stops on a terminal setup failure", async () => {
  const state = await readCloudSetupState(
    "https://app.curvehq.sh",
    respond(200, {
      organization: { slug: "northwind", lifecycleState: "failed" },
    }),
  );
  assert.equal(state.status, "failed");
});

test("prefers the URL the API reports over a rebuilt host", async () => {
  const state = await readCloudSetupState(
    "http://app.localhost:8080",
    respond(200, {
      organization: {
        slug: "northwind",
        name: "Northwind",
        hostnameLabel: "northwind",
        lifecycleState: "ready",
        url: "http://northwind.localhost:8080",
      },
    }),
  );
  assert.equal(state.status, "ready");
  assert.deepEqual(state.status === "ready" ? state.workspace : null, {
    slug: "northwind",
    displayName: "Northwind",
    baseUrl: "http://northwind.localhost:8080/",
  });
});

test("falls back to the hostname label when the API reports no URL", async () => {
  const state = await readCloudSetupState(
    "https://app.curvehq.sh",
    respond(200, {
      organization: {
        slug: "northwind",
        name: "Northwind",
        hostnameLabel: "northwind",
        lifecycleState: "ready",
      },
    }),
  );
  assert.equal(
    state.status === "ready" ? state.workspace.baseUrl : null,
    "https://northwind.curvehq.sh/",
  );
});

test("waits when no organization has been created yet", async () => {
  const state = await readCloudSetupState(
    "https://app.curvehq.sh",
    respond(200, { organization: null }),
  );
  assert.equal(state.status, "no-organization");
});
