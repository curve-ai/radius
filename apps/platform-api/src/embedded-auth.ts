import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins/email-otp";
import { jwt } from "better-auth/plugins/jwt";
import { oauthProvider } from "@better-auth/oauth-provider";
import {
  embeddedAuthSchema,
  type PlatformDatabase,
} from "@curve-ai/platform-database";
import type { NativeOAuthConfiguration } from "@curve-ai/platform-contracts";
import { eq } from "drizzle-orm";
import { createAuthEmailSender, type AuthEmailSender } from "./auth-email.js";
import { embeddedAuthSecret, embeddedAuthUrl } from "./embedded-auth-config.js";

export function createEmbeddedAuth(options: {
  database: PlatformDatabase;
  environment: NodeJS.ProcessEnv;
  sendEmail?: AuthEmailSender;
}) {
  const { environment, database } = options;
  const issuer = embeddedAuthUrl(environment);
  const sendEmail = options.sendEmail ?? createAuthEmailSender(environment);
  const failedDeliveries = new WeakSet<Request>();
  const googleId = environment.GOOGLE_CLIENT_ID;
  const googleSecret = environment.GOOGLE_CLIENT_SECRET;
  if (Boolean(googleId) !== Boolean(googleSecret))
    throw new Error(
      "Google auth requires both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
    );
  return betterAuth({
    appName: "Radius",
    baseURL: issuer,
    basePath: "/api/auth",
    secret: embeddedAuthSecret(environment),
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: embeddedAuthSchema,
    }),
    trustedOrigins: [new URL(issuer).origin],
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
    advanced: {
      cookiePrefix: "radius-auth",
      useSecureCookies: issuer.startsWith("https:"),
    },
    session: { storeSessionInDatabase: true },
    socialProviders:
      googleId && googleSecret
        ? { google: { clientId: googleId, clientSecret: googleSecret } }
        : {},
    disabledPaths: ["/token"],
    // Better Auth intentionally swallows background email errors. Make the
    // synchronous OTP form honest without exposing provider diagnostics.
    hooks: {
      after: createAuthMiddleware(async (context) => {
        if (context.request && failedDeliveries.delete(context.request))
          throw new APIError("SERVICE_UNAVAILABLE", {
            message: "Sign-in email could not be sent. Please try again.",
          });
      }),
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/sign-in/email-otp": { window: 60, max: 5 },
      },
    },
    plugins: [
      emailOTP({
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: "hashed",
        sendVerificationOTP: async (message, context) => {
          try {
            await sendEmail(message);
          } catch (error) {
            if (context?.request) failedDeliveries.add(context.request);
            else throw error;
          }
        },
      }),
      jwt({ jwt: { issuer } }),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
        grantTypes: ["authorization_code", "refresh_token"],
        // Covers the interactive login/consent window, not session lifetime.
        codeExpiresIn: 15 * 60,
        scopes: ["openid", "profile", "email", "offline_access"],
        customIdTokenClaims: ({ user, scopes }) => ({
          ...(scopes.includes("email")
            ? { email: user.email, email_verified: user.emailVerified }
            : {}),
          ...(scopes.includes("profile") ? { name: user.name } : {}),
        }),
      }),
    ],
  });
}

/** Server-owned registration only, after migrations; no dynamic client grants. */
export async function registerEmbeddedClients(
  database: PlatformDatabase,
  configurations: NativeOAuthConfiguration[],
): Promise<void> {
  const { oauthClient, oauthResource, oauthClientResource } =
    embeddedAuthSchema;
  await database.transaction(async (transaction) => {
    for (const config of configurations) {
      const values = {
        clientId: config.clientId,
        name: config.displayName,
        redirectUris: [config.redirectUri],
        scopes: config.scopes,
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "none",
        requirePKCE: true,
        skipConsent: false,
        updatedAt: new Date(),
      };
      const existing = await transaction
        .select()
        .from(oauthClient)
        .where(eq(oauthClient.clientId, config.clientId));
      // Never take ownership of a confidential or user-created client.
      if (existing[0] && (existing[0].clientSecret || existing[0].userId))
        throw new Error(
          "Native client ID conflicts with an existing auth client",
        );
      await transaction
        .insert(oauthClient)
        .values({
          id: randomUUID(),
          disabled: false,
          createdAt: new Date(),
          ...values,
        })
        .onConflictDoUpdate({ target: oauthClient.clientId, set: values });
      await transaction
        .insert(oauthResource)
        .values({
          id: randomUUID(),
          identifier: config.resource,
          name: config.displayName,
          allowedScopes: config.scopes,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing({ target: oauthResource.identifier });
      await transaction
        .insert(oauthClientResource)
        .values({
          id: randomUUID(),
          clientId: config.clientId,
          resourceId: config.resource,
          createdAt: new Date(),
        })
        .onConflictDoNothing();
    }
  });
}
