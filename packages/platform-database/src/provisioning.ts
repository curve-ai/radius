import { createHash, randomUUID } from "node:crypto";

import type {
  ProvisionOrganizationRequest,
  ProvisionOrganizationResponse,
} from "@curve-ai/platform-contracts";

import type { PlatformPool } from "./client.js";
import { withPlatformTransaction } from "./client.js";

export async function provisionPlatformOrganization(
  pool: PlatformPool,
  request: ProvisionOrganizationRequest,
): Promise<ProvisionOrganizationResponse> {
  const identityId = stableUuid(
    "radius-platform-identity-v1",
    `${request.owner.identity.issuer}\0${request.owner.identity.subject}`,
  );
  const membershipId = stableUuid(
    "radius-platform-membership-v1",
    `${request.organization.id}\0${request.owner.accountId}`,
  );

  const resolved = await withPlatformTransaction(pool, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`organization-provision:${request.organization.id}`],
    );
    await client.query(
      `
        INSERT INTO radius_platform.accounts (
          account_id, display_name
        ) VALUES ($1, $2)
        ON CONFLICT (account_id) DO NOTHING
      `,
      [request.owner.accountId, request.owner.displayName],
    );
    const account = await client.query<{ lifecycle_state: string }>(
      `SELECT lifecycle_state FROM radius_platform.accounts WHERE account_id = $1`,
      [request.owner.accountId],
    );
    if (account.rows[0]?.lifecycle_state !== "active") {
      throw new Error("Platform owner account is not active");
    }
    await client.query(
      `
        INSERT INTO radius_platform.organizations (
          organization_id, slug, display_name
        ) VALUES ($1, $2, $3)
        ON CONFLICT (organization_id) DO NOTHING
      `,
      [
        request.organization.id,
        request.organization.slug,
        request.organization.displayName,
      ],
    );
    const organization = await client.query<{
      slug: string;
      lifecycle_state: string;
    }>(
      `SELECT slug, lifecycle_state FROM radius_platform.organizations WHERE organization_id = $1`,
      [request.organization.id],
    );
    if (
      organization.rows[0]?.slug !== request.organization.slug ||
      organization.rows[0]?.lifecycle_state !== "active"
    ) {
      throw new Error("Platform organization conflicts with existing state");
    }
    const identity = await client.query<{
      account_identity_id: string;
      account_id: string;
    }>(
      `
        INSERT INTO radius_platform.account_identities (
          account_identity_id,
          account_id,
          issuer,
          provider_subject,
          email_normalized,
          email_verified_at,
          last_authenticated_at
        ) VALUES ($1, $2, $3, $4, $5, clock_timestamp(), NULL)
        ON CONFLICT (issuer, provider_subject) DO UPDATE
        SET email_normalized = EXCLUDED.email_normalized,
            email_verified_at = coalesce(
              radius_platform.account_identities.email_verified_at,
              clock_timestamp()
            )
        WHERE radius_platform.account_identities.account_id = EXCLUDED.account_id
        RETURNING account_identity_id, account_id
      `,
      [
        identityId,
        request.owner.accountId,
        request.owner.identity.issuer,
        request.owner.identity.subject,
        request.owner.identity.email.toLowerCase(),
      ],
    );
    const resolvedIdentity = identity.rows[0];
    if (resolvedIdentity?.account_id !== request.owner.accountId) {
      throw new Error(
        "OIDC identity is already linked to a different Platform account",
      );
    }
    await client.query(
      `
        INSERT INTO radius_platform.organization_memberships (
          membership_id, organization_id, account_id, role_code
        ) VALUES ($1, $2, $3, 'owner')
        ON CONFLICT (organization_id, account_id) DO NOTHING
      `,
      [membershipId, request.organization.id, request.owner.accountId],
    );
    const membership = await client.query<{
      membership_id: string;
      role_code: string;
      lifecycle_state: string;
    }>(
      `SELECT membership_id, role_code, lifecycle_state
       FROM radius_platform.organization_memberships
       WHERE organization_id = $1 AND account_id = $2`,
      [request.organization.id, request.owner.accountId],
    );
    const resolvedMembership = membership.rows[0];
    if (
      resolvedMembership?.role_code !== "owner" ||
      resolvedMembership.lifecycle_state !== "active"
    ) {
      throw new Error("Platform owner membership conflicts with existing state");
    }
    await client.query(
      `
        INSERT INTO radius_platform.audit_events (
          audit_event_id,
          organization_id,
          event_key,
          system_actor_code,
          action_code,
          outcome_code,
          safe_metadata
        ) VALUES ($1, $2, $3, 'platform.provisioning',
          'organization.provision', 'success', $4)
        ON CONFLICT (organization_id, event_key) DO NOTHING
      `,
      [
        randomUUID(),
        request.organization.id,
        `organization.provision:${request.organization.id}`,
        JSON.stringify({
          organizationSlug: request.organization.slug,
          ownerAccountId: request.owner.accountId,
        }),
      ],
    );
    return {
      accountIdentityId: resolvedIdentity.account_identity_id,
      membershipId: resolvedMembership.membership_id,
    };
  });

  return {
    apiVersion: 1,
    organizationId: request.organization.id,
    accountId: request.owner.accountId,
    accountIdentityId: resolved.accountIdentityId,
    membershipId: resolved.membershipId,
  };
}

export function stableUuid(namespace: string, value: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(`${namespace}\0${value}`).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
