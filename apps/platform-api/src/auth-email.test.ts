import assert from "node:assert/strict";
import test from "node:test";
import { createAuthEmailSender } from "./auth-email.js";

test("Resend delivers the requested code without allowing a custom API destination", async () => {
  let called = false;
  const send = createAuthEmailSender(
    {
      RESEND_API_KEY: "test-only-key",
      AUTH_EMAIL_FROM: "Radius <auth@example.com>",
    },
    (async (url, options) => {
      called = true;
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(options!.redirect, "error");
      const body = JSON.parse(options!.body as string);
      assert.deepEqual(body.to, ["tester@example.com"]);
      assert.ok(body.text.includes("012345"));
      assert.ok(!body.text.includes("test-only-key"));
      return Response.json({ id: "test-message" });
    }) as typeof fetch,
  );
  await send({ email: "tester@example.com", otp: "012345", type: "sign-in" });
  assert.ok(called);
});
test("delivery configuration and provider errors fail closed", async () => {
  assert.throws(
    () => createAuthEmailSender({ AUTH_EMAIL_FROM: "auth@example.com" }),
    /RESEND_API_KEY/,
  );
  assert.throws(() =>
    createAuthEmailSender({
      AUTH_EMAIL_FROM: "auth@example.com",
      RADIUS_AUTH_EMAIL_PROVIDER: "typo",
    }),
  );
  const send = createAuthEmailSender(
    { AUTH_EMAIL_FROM: "auth@example.com", RESEND_API_KEY: "test" },
    (async () =>
      new Response("private-provider-details", {
        status: 403,
      })) as unknown as typeof fetch,
  );
  await assert.rejects(
    send({ email: "tester@example.com", otp: "123456", type: "sign-in" }),
    /^Error: Auth email delivery failed$/,
  );
});
