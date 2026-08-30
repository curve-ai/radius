import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  withPlatformTransaction,
  type PlatformPool,
  type PlatformPoolClient,
} from "@curve-ai/platform-database";
import type { PlatformIdentityResponse } from "@curve-ai/platform-contracts";
import { PlatformOrganizationSlugSchema } from "@curve-ai/platform-contracts";

import type { OidcIdentityClaims } from "./oidc.js";

export interface OidcProvisioningPolicy {
  organizationSlug: string;
  role: "owner" | "admin" | "developer" | "viewer";
  allowedEmails: ReadonlySet<string>;
  allowedEmailDomains: ReadonlySet<string>;
  bootstrapAccountId?: string;
  allowUnprovisionedIdentities: boolean;
  sessionTtlSeconds: number;
}

export interface CreatedBrowserSession {
  sessionId: string;
  sessionToken: string;
  expiresAt: string;
  identity: PlatformIdentityResponse;
}

export interface AuthenticatedBrowserSession {
  sessionId: string;
  accountIdentityId: string;
  identity: PlatformIdentityResponse;
}

export function normalizeOidcProvisioningPolicy(options: {
  organizationSlug: string;
  role?: string;
  allowedEmails?: readonly string[];
  allowedEmailDomains?: readonly string[];
  bootstrapAccountId?: string;
  allowUnprovisionedIdentities?: boolean;
  sessionTtlSeconds?: number;
}): OidcProvisioningPolicy {
  const organizationSlug = options.organizationSlug.trim().toLowerCase();
  if (!PlatformOrganizationSlugSchema.safeParse(organizationSlug).success) {
    throw new Error("OIDC organization slug is invalid");
  }
  const role = options.role ?? "viewer";
  if (
    !(["owner", "admin", "developer", "viewer"] as const).includes(
      role as never,
    )
  ) {
    throw new Error("OIDC auto-join role is invalid");
  }
  const allowedEmails = new Set(
    (options.allowedEmails ?? [])
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  const allowedEmailDomains = new Set(
    (options.allowedEmailDomains ?? [])
      .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean),
  );
  const allowUnprovisionedIdentities =
    options.allowUnprovisionedIdentities !== false;
  if (
    allowUnprovisionedIdentities &&
    allowedEmails.size === 0 &&
    allowedEmailDomains.size === 0
  ) {
    throw new Error("OIDC provisioning requires an email or domain allowlist");
  }
  for (const email of allowedEmails) {
    if (!/^[^@\s]+@[^@\s]+$/.test(email))
      throw new Error("OIDC allowed email is invalid");
  }
  for (const domain of allowedEmailDomains) {
    if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(domain)) {
      throw new Error("OIDC allowed email domain is invalid");
    }
  }
  const sessionTtlSeconds = options.sessionTtlSeconds ?? 8 * 60 * 60;
  if (
    !Number.isSafeInteger(sessionTtlSeconds) ||
    sessionTtlSeconds < 5 * 60 ||
    sessionTtlSeconds > 30 * 24 * 60 * 60
  ) {
    throw new Error(
      "OIDC session TTL must be between five minutes and 30 days",
    );
  }
  if (
    options.bootstrapAccountId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      options.bootstrapAccountId,
    )
  ) {
    throw new Error("OIDC bootstrap account ID is invalid");
  }
  return {
    organizationSlug,
    role: role as OidcProvisioningPolicy["role"],
    allowedEmails,
    allowedEmailDomains,
    bootstrapAccountId: options.bootstrapAccountId,
    allowUnprovisionedIdentities,
    sessionTtlSeconds,
  };
}

export async function provisionOidcBrowserSession(
  pool: PlatformPool,
  claims: OidcIdentityClaims,
  policy: OidcProvisioningPolicy,
): Promise<CreatedBrowserSession> {
  return withPlatformTransaction(pool, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`oidc:${claims.issuer}:${claims.subject}`],
    );
    const organization = await client.query<{ organization_id: string }>(
      `SELECT organization_id FROM radius_platform.organizations
       WHERE slug = $1 AND lifecycle_state = 'active'`,
      [policy.organizationSlug],
    );
    const organizationId = organization.rows[0]?.organization_id;
    if (!organizationId)
      throw new Error("OIDC target organization does not exist");

    const existing = await client.query<{
      account_identity_id: string;
      account_id: string;
    }>(
      `
        SELECT account_identity_id, account_id
        FROM radius_platform.account_identities
        WHERE issuer = $1 AND provider_subject = $2
        FOR UPDATE
      `,
      [claims.issuer, claims.subject],
    );
    let accountId = existing.rows[0]?.account_id;
    let accountIdentityId = existing.rows[0]?.account_identity_id;
    if (!accountId || !accountIdentityId) {
      assertClaimsAllowed(claims, policy);
      accountId = policy.bootstrapAccountId ?? randomUUID();
      if (policy.bootstrapAccountId) {
        const account = await client.query(
          `SELECT 1 FROM radius_platform.accounts
           WHERE account_id = $1 AND lifecycle_state = 'active' FOR UPDATE`,
          [accountId],
        );
        if (account.rowCount === 0)
          throw new Error("OIDC bootstrap account does not exist");
      } else {
        await client.query(
          `INSERT INTO radius_platform.accounts (account_id, display_name)
           VALUES ($1, $2)`,
          [accountId, claims.displayName ?? claims.email],
        );
      }
      accountIdentityId = randomUUID();
      await client.query(
        `
          INSERT INTO radius_platform.account_identities (
            account_identity_id,
            account_id,
            issuer,
            provider_subject,
            email_normalized,
            email_verified_at,
            last_authenticated_at
          ) VALUES ($1, $2, $3, $4, $5, clock_timestamp(), clock_timestamp())
        `,
        [
          accountIdentityId,
          accountId,
          claims.issuer,
          claims.subject,
          claims.email,
        ],
      );
    } else {
      await client.query(
        `
          UPDATE radius_platform.account_identities
          SET email_normalized = $2,
              email_verified_at = CASE WHEN $3 THEN coalesce(email_verified_at, clock_timestamp()) ELSE email_verified_at END,
              last_authenticated_at = clock_timestamp()
          WHERE account_identity_id = $1
        `,
        [accountIdentityId, claims.email, claims.emailVerified],
      );
    }

    const membership = await client.query<{
      membership_id: string;
      lifecycle_state: "active" | "suspended" | "removed";
    }>(
      `
        SELECT membership_id, lifecycle_state
        FROM radius_platform.organization_memberships
        WHERE organization_id = $1 AND account_id = $2
        FOR UPDATE
      `,
      [organizationId, accountId],
    );
    if (!membership.rows[0]) {
      assertClaimsAllowed(claims, policy);
      await client.query(
        `
          INSERT INTO radius_platform.organization_memberships (
            membership_id, organization_id, account_id, role_code
          ) VALUES ($1, $2, $3, $4)
        `,
        [randomUUID(), organizationId, accountId, policy.role],
      );
    } else {
      assertOidcMembershipActive(membership.rows[0].lifecycle_state);
    }

    const sessionId = randomUUID();
    const sessionToken = `radius_sess_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + policy.sessionTtlSeconds * 1000);
    await client.query(
      `
        INSERT INTO radius_platform.platform_sessions (
          session_id,
          account_identity_id,
          token_hash,
          token_prefix,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5)
      `,
      [
        sessionId,
        accountIdentityId,
        createHash("sha256").update(sessionToken).digest(),
        sessionToken.slice(0, 16),
        expiresAt,
      ],
    );
    await client.query(
      `
        INSERT INTO radius_platform.audit_events (
          audit_event_id, organization_id, event_key, system_actor_code,
          action_code, outcome_code, safe_metadata
        ) VALUES ($1, $2, $3, 'auth.oidc', 'session.create', 'success', $4)
      `,
      [
        randomUUID(),
        organizationId,
        `session.create:${sessionId}`,
        JSON.stringify({ issuer: claims.issuer, sessionId }),
      ],
    );
    return {
      sessionId,
      sessionToken,
      expiresAt: expiresAt.toISOString(),
      identity: await loadAccountIdentity(client, accountId),
    };
  });
}

export function assertOidcMembershipActive(
  lifecycleState: "active" | "suspended" | "removed",
): void {
  if (lifecycleState !== "active") {
    throw new Error("OIDC organization membership is not active");
  }
}

export async function authenticateBrowserSession(
  pool: PlatformPool,
  sessionToken: string,
): Promise<AuthenticatedBrowserSession | null> {
  const result = await pool.query<{
    session_id: string;
    account_identity_id: string;
    account_id: string;
  }>(
    `
      SELECT session.session_id, session.account_identity_id, identity.account_id
      FROM radius_platform.platform_sessions AS session
      JOIN radius_platform.account_identities AS identity
        ON identity.account_identity_id = session.account_identity_id
      JOIN radius_platform.accounts AS account ON account.account_id = identity.account_id
      WHERE session.token_hash = $1
        AND session.revoked_at IS NULL
        AND session.expires_at > clock_timestamp()
        AND account.lifecycle_state = 'active'
    `,
    [createHash("sha256").update(sessionToken).digest()],
  );
  const row = result.rows[0];
  if (!row) return null;
  const [, identity] = await Promise.all([
    pool.query(
      `UPDATE radius_platform.platform_sessions SET last_used_at = clock_timestamp()
       WHERE session_id = $1
         AND (last_used_at IS NULL OR last_used_at < clock_timestamp() - interval '5 minutes')`,
      [row.session_id],
    ),
    loadAccountIdentity(pool, row.account_id),
  ]);
  return {
    sessionId: row.session_id,
    accountIdentityId: row.account_identity_id,
    identity,
  };
}

export async function revokeBrowserSession(
  pool: PlatformPool,
  sessionToken: string,
): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE radius_platform.platform_sessions
      SET revoked_at = coalesce(revoked_at, clock_timestamp())
      WHERE token_hash = $1 AND revoked_at IS NULL
    `,
    [createHash("sha256").update(sessionToken).digest()],
  );
  return (result.rowCount ?? 0) > 0;
}

async function loadAccountIdentity(
  client: Pick<PlatformPool, "query"> | PlatformPoolClient,
  accountId: string,
): Promise<PlatformIdentityResponse> {
  const memberships = await client.query<{
    organization_id: string;
    slug: string;
    display_name: string;
    role_code: "owner" | "admin" | "developer" | "viewer";
  }>(
    `
      SELECT organization.organization_id, organization.slug,
        organization.display_name, membership.role_code
      FROM radius_platform.organization_memberships AS membership
      JOIN radius_platform.organizations AS organization
        ON organization.organization_id = membership.organization_id
      WHERE membership.account_id = $1
        AND membership.lifecycle_state = 'active'
        AND organization.lifecycle_state = 'active'
      ORDER BY organization.slug
    `,
    [accountId],
  );
  return {
    apiVersion: 1,
    accountId,
    organizations: memberships.rows.map((row) => ({
      id: row.organization_id,
      slug: row.slug,
      displayName: row.display_name,
      role: row.role_code,
    })),
  };
}

function assertClaimsAllowed(
  claims: OidcIdentityClaims,
  policy: OidcProvisioningPolicy,
): void {
  if (!policy.allowUnprovisionedIdentities) {
    throw new Error("OIDC identity must be provisioned before sign-in");
  }
  if (!claims.email || !claims.emailVerified) {
    throw new Error("OIDC provisioning requires a verified email claim");
  }
  const domain = claims.email.split("@").at(-1) ?? "";
  if (
    !policy.allowedEmails.has(claims.email) &&
    !policy.allowedEmailDomains.has(domain)
  ) {
    throw new Error("OIDC identity is not allowed to join this organization");
  }
}
