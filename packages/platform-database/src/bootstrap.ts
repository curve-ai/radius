import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { PlatformPool } from "./client.js";
import { withPlatformTransaction } from "./client.js";

const BOOTSTRAP_LOCK_NAME = "radius-platform-initial-owner-bootstrap-v1";
const DEFAULT_OWNER_SCOPES = [
  "organization.admin",
  "agent.read",
  "agent.write",
  "deployment.read",
  "deployment.write",
  "installation.read",
  "installation.write",
  "token.admin",
] as const;

export interface BootstrapPlatformOwnerOptions {
  organizationSlug: string;
  organizationDisplayName: string;
  accountDisplayName: string;
  tokenLabel?: string;
}

export interface BootstrapPlatformOwnerResult {
  organizationId: string;
  accountId: string;
  membershipId: string;
  developerTokenId: string;
  developerToken: string;
  scopes: readonly string[];
}

export async function bootstrapPlatformOwner(
  pool: PlatformPool,
  options: BootstrapPlatformOwnerOptions,
): Promise<BootstrapPlatformOwnerResult> {
  const normalized = normalizeBootstrapOptions(options);
  const result = {
    organizationId: randomUUID(),
    accountId: randomUUID(),
    membershipId: randomUUID(),
    developerTokenId: randomUUID(),
    developerToken: `radius_pat_${randomBytes(32).toString("base64url")}`,
    scopes: DEFAULT_OWNER_SCOPES,
  } satisfies BootstrapPlatformOwnerResult;

  await withPlatformTransaction(pool, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [BOOTSTRAP_LOCK_NAME],
    );
    const existing = await client.query<{ organization_count: string }>(
      "SELECT count(*) AS organization_count FROM radius_platform.organizations",
    );
    if (Number(existing.rows[0]?.organization_count ?? 0) > 0) {
      throw new Error(
        "Platform ownership is already initialized; bootstrap is disabled",
      );
    }

    await client.query(
      `
        INSERT INTO radius_platform.accounts (account_id, display_name)
        VALUES ($1, $2)
      `,
      [result.accountId, normalized.accountDisplayName],
    );
    await client.query(
      `
        INSERT INTO radius_platform.organizations (
          organization_id, slug, display_name
        ) VALUES ($1, $2, $3)
      `,
      [
        result.organizationId,
        normalized.organizationSlug,
        normalized.organizationDisplayName,
      ],
    );
    await client.query(
      `
        INSERT INTO radius_platform.organization_memberships (
          membership_id, organization_id, account_id, role_code
        ) VALUES ($1, $2, $3, 'owner')
      `,
      [result.membershipId, result.organizationId, result.accountId],
    );
    await client.query(
      `
        INSERT INTO radius_platform.developer_tokens (
          developer_token_id,
          membership_id,
          label,
          token_hash,
          token_prefix
        ) VALUES ($1, $2, $3, $4, $5)
      `,
      [
        result.developerTokenId,
        result.membershipId,
        normalized.tokenLabel,
        createHash("sha256").update(result.developerToken).digest(),
        result.developerToken.slice(0, 16),
      ],
    );
    for (const scope of result.scopes) {
      await client.query(
        `
          INSERT INTO radius_platform.developer_token_scopes (
            developer_token_id, scope_code
          ) VALUES ($1, $2)
        `,
        [result.developerTokenId, scope],
      );
    }
    await client.query(
      `
        INSERT INTO radius_platform.audit_events (
          audit_event_id,
          organization_id,
          event_key,
          actor_developer_token_id,
          action_code,
          outcome_code,
          safe_metadata
        ) VALUES ($1, $2, 'platform.bootstrap', $3, 'platform.bootstrap',
          'success', $4)
      `,
      [
        randomUUID(),
        result.organizationId,
        result.developerTokenId,
        JSON.stringify({
          organizationSlug: normalized.organizationSlug,
          tokenLabel: normalized.tokenLabel,
        }),
      ],
    );
  });

  return result;
}

export function normalizeBootstrapOptions(
  options: BootstrapPlatformOwnerOptions,
): Required<BootstrapPlatformOwnerOptions> {
  const organizationSlug = options.organizationSlug.trim().toLowerCase();
  const organizationDisplayName = options.organizationDisplayName.trim();
  const accountDisplayName = options.accountDisplayName.trim();
  const tokenLabel = (options.tokenLabel ?? "Initial owner").trim();
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(organizationSlug)) {
    throw new Error(
      "Organization slug must start with a letter and contain only lowercase letters, numbers, or hyphens",
    );
  }
  for (const [name, value] of [
    ["Organization display name", organizationDisplayName],
    ["Account display name", accountDisplayName],
    ["Token label", tokenLabel],
  ] as const) {
    if (value.length < 1 || value.length > 120) {
      throw new Error(`${name} must contain 1 to 120 characters`);
    }
  }
  return {
    organizationSlug,
    organizationDisplayName,
    accountDisplayName,
    tokenLabel,
  };
}
