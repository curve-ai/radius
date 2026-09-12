// Offline schema generation only. No database is opened and no email is sent.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins/email-otp";
import { jwt } from "better-auth/plugins/jwt";
import { oauthProvider } from "@better-auth/oauth-provider";

export const auth = betterAuth({
  baseURL: "http://localhost:3100/api/auth",
  secret: "offline-schema-generation-only-not-a-runtime-secret",
  database: drizzleAdapter({} as never, { provider: "pg" }),
  plugins: [
    emailOTP({
      async sendVerificationOTP() {
        throw new Error("Schema generation does not send email");
      },
    }),
    jwt(),
    oauthProvider({ loginPage: "/sign-in", consentPage: "/consent" }),
  ],
});
