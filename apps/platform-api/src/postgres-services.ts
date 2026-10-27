import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  createPlatformDatabase,
  migratePlatformDatabase,
  withPlatformTransaction,
  type PlatformPool,
  type PlatformPoolClient,
  type PlatformDatabase,
} from "@curve-ai/platform-database";
import type {
  AgentEnvironmentChangeResponse,
  CreateDeveloperTokenRequest,
  CreateDeveloperTokenResponse,
  DeveloperTokenScope,
  DeveloperTokenSummary,
  FinalizeAgentDeploymentRequest,
  FinalizeAgentDeploymentResponse,
  ListAgentsResponse,
  ListAgentEnvironmentHistoryResponse,
  ListDeveloperTokensResponse,
  ListOrganizationMembershipsResponse,
  ListAgentDeploymentsResponse,
  ListInstallationsResponse,
  PrepareAgentDeploymentRequest,
  PrepareAgentDeploymentResponse,
  RegisterClientInstallationRequest,
  RegisterClientInstallationResponse,
  ReportAgentInstallationRequest,
  ReportAgentInstallationResponse,
  PromoteAgentDeploymentRequest,
  RollbackAgentDeploymentRequest,
  RevokeDeveloperTokenResponse,
  OrganizationMembershipSummary,
  PlatformOrganizationRole,
  UpdateOrganizationMembershipRequest,
  UpdateOrganizationMembershipResponse,
} from "@curve-ai/platform-contracts";
import { DEVELOPER_TOKEN_SCOPES } from "@curve-ai/platform-contracts";

import {
  PlatformApiError,
  type PlatformRequestIdentity,
  type RadiusPlatformServices,
} from "./app.js";
import { authenticateBrowserSession as authenticateStoredBrowserSession } from "./browser-session.js";
import {
  createPlatformRegistryVerifier,
  type PlatformRegistryFetch,
} from "./registry-verifier.js";

const DEVELOPMENT_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const DEVELOPMENT_ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const DEVELOPMENT_MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333";
const DEVELOPMENT_TOKEN_ID = "44444444-4444-4444-8444-444444444444";
const STANDARD_ENVIRONMENTS = ["development", "staging", "production"] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PostgresIdentity extends PlatformRequestIdentity {
  membershipId: string;
  developerTokenId: string;
  organizationId: string;
  scopes: ReadonlySet<DeveloperTokenScope>;
}

interface BrowserSessionIdentity extends PlatformRequestIdentity {
  browserSessionId: string;
}

type DatabaseReadIdentity = PostgresIdentity | BrowserSessionIdentity;
type DatabaseMutationIdentity = PostgresIdentity | BrowserSessionIdentity;

interface OrganizationMutationAccess {
  organizationId: string;
  membershipId: string;
  scopes: ReadonlySet<DeveloperTokenScope>;
}

const ROLE_SCOPES: Record<
  PlatformOrganizationRole,
  readonly DeveloperTokenScope[]
> = {
  owner: DEVELOPER_TOKEN_SCOPES,
  admin: [
    "agent.read",
    "agent.write",
    "deployment.read",
    "deployment.write",
    "installation.read",
    "installation.write",
    "token.admin",
  ],
  developer: [
    "agent.read",
    "agent.write",
    "deployment.read",
    "deployment.write",
    "installation.read",
    "installation.write",
  ],
  viewer: ["agent.read", "deployment.read", "installation.write"],
};

export interface PostgresPlatformOptions {
  connectionString: string;
  bootstrapDevelopmentAuthority?: boolean;
  developmentAccessToken?: string;
  migrationsDirectory?: string;
  registry?: string;
  registryVerification?: string;
  allowInsecureRegistryVerification?: boolean;
  registryUsername?: string;
  registryPassword?: string;
  fetch?: PlatformRegistryFetch;
  now?: () => Date;
}

export interface PostgresPlatformRuntime {
  services: RadiusPlatformServices;
  pool: PlatformPool;
  db: PlatformDatabase;
  close(): Promise<void>;
}

export async function createPostgresPlatformServices(
  options: PostgresPlatformOptions,
): Promise<PostgresPlatformRuntime> {
  const registry = options.registry ?? "127.0.0.1:5001";
  const registryVerification = options.registryVerification ?? registry;
  const registryUsername = options.registryUsername ?? "radius-dev";
  const registryPassword = options.registryPassword ?? "radius-dev-only";
  const registryVerifier = createPlatformRegistryVerifier({
    registry,
    registryVerification,
    allowInsecureRegistryVerification:
      options.allowInsecureRegistryVerification ?? false,
    username: registryUsername,
    password: registryPassword,
    fetch: options.fetch,
  });
  const now = options.now ?? (() => new Date());
  const { pool, db } = createPlatformDatabase({
    connectionString: options.connectionString,
    applicationName: "radius-platform-api",
    maxConnections: 12,
  });

  try {
    await migratePlatformDatabase(pool, options.migrationsDirectory);
    if (options.bootstrapDevelopmentAuthority) {
      const accessToken = options.developmentAccessToken?.trim() ?? "";
      if (accessToken.length < 4) {
        throw new Error(
          "Development authority bootstrap requires a token with at least four characters",
        );
      }
      await bootstrapDevelopmentAuthority(pool, accessToken);
    }
  } catch (error) {
    await pool.end();
    throw error;
  }

  const services: RadiusPlatformServices = {
    authenticate: async (candidate) => authenticate(pool, candidate),
    authenticateBrowserSession: async (candidate) => {
      const authenticated = await authenticateStoredBrowserSession(
        pool,
        candidate,
      );
      return authenticated
        ? {
            accountId: authenticated.identity.accountId,
            browserSessionId: authenticated.sessionId,
            response: authenticated.identity,
          }
        : null;
    },

    listOrganizationMemberships: async ({ identity, organization }) => {
      const actor = requireDatabaseMutationIdentity(identity);
      const access = await requireOrganizationMutationAccess(
        pool,
        actor,
        organization,
        "organization.admin",
      );
      return listOrganizationMemberships(pool, organization, access);
    },

    updateOrganizationMembership: async ({
      identity,
      organization,
      membershipId,
      request,
      idempotencyKey,
    }) => {
      const actor = requireDatabaseMutationIdentity(identity);
      return updateOrganizationMembership({
        pool,
        identity: actor,
        organization,
        membershipId,
        request,
        idempotencyKey,
      });
    },

    listDeveloperTokens: async ({ identity, organization }) => {
      const actor = requireDatabaseMutationIdentity(identity);
      const access = await requireOrganizationMutationAccess(
        pool,
        actor,
        organization,
        "token.admin",
      );
      return listDeveloperTokens(pool, actor, organization, access);
    },

    createDeveloperToken: async ({
      identity,
      organization,
      request,
      idempotencyKey,
    }) => {
      const actor = requireDatabaseMutationIdentity(identity);
      const access = await requireOrganizationMutationAccess(
        pool,
        actor,
        organization,
        "token.admin",
      );
      return createDeveloperToken({
        pool,
        identity: actor,
        organization,
        request,
        idempotencyKey,
        access,
      });
    },

    revokeDeveloperToken: async ({
      identity,
      organization,
      developerTokenId,
      idempotencyKey,
    }) => {
      const actor = requireDatabaseMutationIdentity(identity);
      const access = await requireOrganizationMutationAccess(
        pool,
        actor,
        organization,
        "token.admin",
      );
      return revokeDeveloperToken({
        pool,
        identity: actor,
        organization,
        developerTokenId,
        idempotencyKey,
        access,
      });
    },

    listAgents: async ({ identity, organization }) => {
      const actor = requireDatabaseReadIdentity(identity);
      if (isPostgresIdentity(actor)) requireScope(actor, "agent.read");
      return listAgents(pool, actor, organization);
    },

    listAgentDeployments: async ({ identity, agent, limit, cursor }) => {
      const actor = requireDatabaseReadIdentity(identity);
      if (isPostgresIdentity(actor)) requireScope(actor, "deployment.read");
      return listAgentDeployments(pool, actor, agent, limit, cursor);
    },

    listAgentEnvironmentHistory: async ({
      identity,
      agent,
      environment,
      limit,
      cursor,
    }) => {
      const actor = requireDatabaseReadIdentity(identity);
      if (isPostgresIdentity(actor)) requireScope(actor, "deployment.read");
      return listAgentEnvironmentHistory(
        pool,
        actor,
        agent,
        environment,
        limit,
        cursor,
      );
    },

    prepareAgentDeployment: async ({ identity, request, idempotencyKey }) => {
      const actor = requireDatabaseMutationIdentity(identity);
      const access = await requireOrganizationMutationAccess(
        pool,
        actor,
        request.organization,
        "deployment.write",
      );
      return prepareAgentDeployment({
        pool,
        identity: actor,
        request,
        idempotencyKey,
        registry,
        registryUsername,
        registryPassword,
        now,
        access,
      });
    },

    finalizeAgentDeployment: async ({
      identity,
      agent,
      request,
      idempotencyKey,
    }) => {
      const actor = requireDatabaseMutationIdentity(identity);
      const access = await requireOrganizationMutationAccess(
        pool,
        actor,
        request.organization,
        "deployment.write",
      );
      const upload = await loadUploadForVerification(
        pool,
        actor,
        access,
        agent,
        request,
      );
      const verification = await registryVerifier.verifyManifest({
        imageReference: upload.imageReference,
        expectedDigest: request.imageDigest as `sha256:${string}`,
      });
      return finalizeAgentDeployment({
        pool,
        identity: actor,
        agent,
        request,
        idempotencyKey,
        now,
        verification,
        access,
      });
    },

    promoteAgentDeployment: async ({
      identity,
      agent,
      environment,
      request,
      idempotencyKey,
    }) => {
      const actor = requireDatabaseMutationIdentity(identity);
      return changeDeployment({
        pool,
        identity: actor,
        action: "promote",
        agent,
        environment,
        request,
        idempotencyKey,
      });
    },

    rollbackAgentDeployment: async ({
      identity,
      agent,
      environment,
      request,
      idempotencyKey,
    }) => {
      const actor = requireDatabaseMutationIdentity(identity);
      return changeDeployment({
        pool,
        identity: actor,
        action: "rollback",
        agent,
        environment,
        request,
        idempotencyKey,
      });
    },

    registerClientInstallation: async ({
      identity,
      clientInstanceId,
      request,
      idempotencyKey,
    }) => {
      const actor = requireDatabaseMutationIdentity(identity);
      const access = await requireOrganizationMutationAccess(
        pool,
        actor,
        request.organization,
        "installation.write",
      );
      return registerClientInstallation({
        pool,
        identity: actor,
        access,
        clientInstanceId,
        request,
        idempotencyKey,
      });
    },

    reportAgentInstallation: async ({
      identity,
      clientInstallationId,
      agent,
      request,
      idempotencyKey,
    }) =>
      reportAgentInstallation({
        pool,
        identity: requireDatabaseMutationIdentity(identity),
        clientInstallationId,
        agent,
        request,
        idempotencyKey,
      }),

    listInstallations: async ({ identity, organization }) => {
      const actor = requireDatabaseMutationIdentity(identity);
      const access = await requireOrganizationMutationAccess(
        pool,
        actor,
        organization,
        "installation.read",
      );
      return listInstallations(pool, organization, access);
    },
  };

  return { services, pool, db, close: () => pool.end() };
}

async function bootstrapDevelopmentAuthority(
  pool: PlatformPool,
  accessToken: string,
): Promise<void> {
  const tokenHash = sha256Buffer(accessToken);
  await withPlatformTransaction(pool, async (client) => {
    await client.query(
      `
        INSERT INTO radius_platform.accounts (account_id, display_name)
        VALUES ($1, 'Radius Developer')
        ON CONFLICT (account_id) DO UPDATE
        SET display_name = EXCLUDED.display_name, lifecycle_state = 'active'
      `,
      [DEVELOPMENT_ACCOUNT_ID],
    );
    await client.query(
      `
        INSERT INTO radius_platform.organizations (
          organization_id, slug, display_name
        ) VALUES ($1, 'dev', 'Radius Development')
        ON CONFLICT (organization_id) DO UPDATE
        SET slug = EXCLUDED.slug,
            display_name = EXCLUDED.display_name,
            lifecycle_state = 'active'
      `,
      [DEVELOPMENT_ORGANIZATION_ID],
    );
    await client.query(
      `
        INSERT INTO radius_platform.organization_memberships (
          membership_id, organization_id, account_id, role_code
        ) VALUES ($1, $2, $3, 'owner')
        ON CONFLICT (membership_id) DO UPDATE
        SET role_code = 'owner', lifecycle_state = 'active'
      `,
      [
        DEVELOPMENT_MEMBERSHIP_ID,
        DEVELOPMENT_ORGANIZATION_ID,
        DEVELOPMENT_ACCOUNT_ID,
      ],
    );
    await client.query(
      `
        INSERT INTO radius_platform.developer_tokens (
          developer_token_id,
          membership_id,
          label,
          token_hash,
          token_prefix
        ) VALUES ($1, $2, 'Local development', $3, $4)
        ON CONFLICT (developer_token_id) DO UPDATE
        SET token_hash = EXCLUDED.token_hash,
            token_prefix = EXCLUDED.token_prefix,
            revoked_at = NULL,
            expires_at = NULL
      `,
      [
        DEVELOPMENT_TOKEN_ID,
        DEVELOPMENT_MEMBERSHIP_ID,
        tokenHash,
        accessToken.slice(0, Math.min(12, accessToken.length)),
      ],
    );
    for (const scope of [
      "agent.read",
      "deployment.read",
      "deployment.write",
      "deployment.read",
      "deployment.write",
    ]) {
      await client.query(
        `
          INSERT INTO radius_platform.developer_token_scopes (
            developer_token_id, scope_code
          ) VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [DEVELOPMENT_TOKEN_ID, scope],
      );
    }
  });
}

async function authenticate(
  pool: PlatformPool,
  accessToken: string,
): Promise<PostgresIdentity | null> {
  const result = await pool.query<{
    account_id: string;
    membership_id: string;
    developer_token_id: string;
    organization_id: string;
    organization_slug: string;
    organization_name: string;
    role_code: PlatformOrganizationRole;
    scopes: DeveloperTokenScope[];
  }>(
    `
      SELECT
        membership.account_id,
        membership.membership_id,
        token.developer_token_id,
        organization.organization_id,
        organization.slug AS organization_slug,
        organization.display_name AS organization_name,
        membership.role_code,
        array_agg(scope.scope_code ORDER BY scope.scope_code) AS scopes
      FROM radius_platform.developer_tokens AS token
      JOIN radius_platform.developer_token_scopes AS scope
        ON scope.developer_token_id = token.developer_token_id
      JOIN radius_platform.organization_memberships AS membership
        ON membership.membership_id = token.membership_id
      JOIN radius_platform.accounts AS account
        ON account.account_id = membership.account_id
      JOIN radius_platform.organizations AS organization
        ON organization.organization_id = membership.organization_id
      WHERE token.token_hash = $1
        AND token.revoked_at IS NULL
        AND (token.expires_at IS NULL OR token.expires_at > clock_timestamp())
        AND membership.lifecycle_state = 'active'
        AND account.lifecycle_state = 'active'
        AND organization.lifecycle_state = 'active'
      GROUP BY
        membership.account_id,
        membership.membership_id,
        token.developer_token_id,
        organization.organization_id,
        organization.slug,
        organization.display_name,
        membership.role_code
    `,
    [sha256Buffer(accessToken)],
  );
  const row = result.rows[0];
  if (!row) return null;
  await pool.query(
    `UPDATE radius_platform.developer_tokens SET last_used_at = clock_timestamp()
     WHERE developer_token_id = $1
       AND (last_used_at IS NULL OR last_used_at < clock_timestamp() - interval '5 minutes')`,
    [row.developer_token_id],
  );
  return {
    accountId: row.account_id,
    membershipId: row.membership_id,
    developerTokenId: row.developer_token_id,
    organizationId: row.organization_id,
    scopes: new Set(row.scopes),
    response: {
      apiVersion: 1,
      accountId: row.account_id,
      organizations: [
        {
          id: row.organization_id,
          slug: row.organization_slug,
          displayName: row.organization_name,
          role: row.role_code,
        },
      ],
    },
  };
}

interface OrganizationMembershipRow {
  membership_id: string;
  account_id: string;
  display_name: string | null;
  email_normalized: string | null;
  role_code: PlatformOrganizationRole;
  lifecycle_state: "active" | "suspended" | "removed";
  joined_at: Date;
  updated_at: Date;
  developer_token_count: string;
}

async function listOrganizationMemberships(
  pool: PlatformPool,
  organization: string,
  access: OrganizationMutationAccess,
): Promise<ListOrganizationMembershipsResponse> {
  const result = await pool.query<OrganizationMembershipRow>(
    organizationMembershipSummaryQuery("membership.organization_id = $1"),
    [access.organizationId],
  );
  const memberships = result.rows.map((row) =>
    publicOrganizationMembership(row, access.membershipId),
  );
  memberships.sort(
    (left, right) => Number(right.current) - Number(left.current),
  );
  return {
    apiVersion: 1,
    organization,
    memberships,
  };
}

async function updateOrganizationMembership(options: {
  pool: PlatformPool;
  identity: DatabaseMutationIdentity;
  organization: string;
  membershipId: string;
  request: UpdateOrganizationMembershipRequest;
  idempotencyKey: string;
}): Promise<UpdateOrganizationMembershipResponse> {
  if (!UUID_PATTERN.test(options.membershipId)) {
    throw new PlatformApiError(
      400,
      "MEMBERSHIP_ID_INVALID",
      "Organization membership ID is invalid",
    );
  }
  const operation = "organization_membership.update";
  const requestDigest = digestJson({
    organization: options.organization,
    membershipId: options.membershipId,
    request: options.request,
  });
  return withPlatformTransaction(options.pool, async (client) => {
    let access = await requireOrganizationMutationAccess(
      client,
      options.identity,
      options.organization,
      "organization.admin",
    );
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`organization-membership:${access.organizationId}`],
    );
    access = await requireOrganizationMutationAccess(
      client,
      options.identity,
      options.organization,
      "organization.admin",
    );
    if (options.membershipId === access.membershipId) {
      throw new PlatformApiError(
        409,
        "CURRENT_MEMBERSHIP_UPDATE_FORBIDDEN",
        "Another owner must change your organization access",
      );
    }
    await lockIdempotency(
      client,
      options.identity,
      operation,
      options.idempotencyKey,
    );
    const existing = await getIdempotency(
      client,
      options.identity,
      operation,
      options.idempotencyKey,
      requestDigest,
    );
    if (existing) {
      return existing.responseBody as UpdateOrganizationMembershipResponse;
    }
    const targetResult = await client.query<{
      account_id: string;
      role_code: PlatformOrganizationRole;
      lifecycle_state: "active" | "suspended" | "removed";
    }>(
      `
        SELECT account_id, role_code, lifecycle_state
        FROM radius_platform.organization_memberships
        WHERE membership_id = $1 AND organization_id = $2
        FOR UPDATE
      `,
      [options.membershipId, access.organizationId],
    );
    const target = targetResult.rows[0];
    if (!target) {
      throw new PlatformApiError(
        404,
        "ORGANIZATION_MEMBERSHIP_NOT_FOUND",
        "Organization membership not found",
      );
    }
    const nextRole = options.request.role ?? target.role_code;
    const nextLifecycleState =
      options.request.lifecycleState ?? target.lifecycle_state;
    if (
      target.role_code === "owner" &&
      target.lifecycle_state === "active" &&
      (nextRole !== "owner" || nextLifecycleState !== "active")
    ) {
      const owners = await client.query<{ owner_count: string }>(
        `
          SELECT count(*) AS owner_count
          FROM radius_platform.organization_memberships
          WHERE organization_id = $1
            AND role_code = 'owner'
            AND lifecycle_state = 'active'
        `,
        [access.organizationId],
      );
      if (Number(owners.rows[0]?.owner_count ?? 0) <= 1) {
        throw new PlatformApiError(
          409,
          "LAST_OWNER_REQUIRED",
          "Promote another active owner before changing this owner",
        );
      }
    }

    await client.query(
      `
        UPDATE radius_platform.organization_memberships
        SET role_code = $2, lifecycle_state = $3
        WHERE membership_id = $1
      `,
      [options.membershipId, nextRole, nextLifecycleState],
    );
    let revokedDeveloperTokenCount = 0;
    if (nextRole !== target.role_code || nextLifecycleState === "removed") {
      const revokedTokens = await client.query(
        `
          UPDATE radius_platform.developer_tokens
          SET revoked_at = coalesce(revoked_at, clock_timestamp())
          WHERE membership_id = $1 AND revoked_at IS NULL
        `,
        [options.membershipId],
      );
      revokedDeveloperTokenCount = revokedTokens.rowCount ?? 0;
    }
    let revokedSessionCount = 0;
    if (nextLifecycleState !== "active") {
      const revokedSessions = await client.query(
        `
          UPDATE radius_platform.platform_sessions AS session
          SET revoked_at = coalesce(session.revoked_at, clock_timestamp())
          FROM radius_platform.account_identities AS identity
          WHERE identity.account_identity_id = session.account_identity_id
            AND identity.account_id = $1
            AND session.revoked_at IS NULL
        `,
        [target.account_id],
      );
      revokedSessionCount = revokedSessions.rowCount ?? 0;
    }
    let updatedClientInstallationCount = 0;
    if (nextLifecycleState !== target.lifecycle_state) {
      const updatedInstallations = await client.query(
        `
          UPDATE radius_platform.client_installations
          SET lifecycle_state = $2
          WHERE membership_id = $1
        `,
        [
          options.membershipId,
          nextLifecycleState === "active"
            ? "active"
            : nextLifecycleState === "suspended"
              ? "suspended"
              : "removed",
        ],
      );
      updatedClientInstallationCount = updatedInstallations.rowCount ?? 0;
    }
    const membership = await loadOrganizationMembershipSummary(
      client,
      options.membershipId,
      access,
    );
    const response: UpdateOrganizationMembershipResponse = {
      apiVersion: 1,
      organization: options.organization,
      membership,
    };
    await completeIdempotency(client, {
      identity: options.identity,
      operation,
      key: options.idempotencyKey,
      requestDigest,
      responseStatus: 200,
      responseBody: response,
      resourceReference: options.membershipId,
    });
    await insertAuditEvent(client, {
      identity: options.identity,
      eventKey: `${operation}:${options.idempotencyKey}`,
      action: operation,
      metadata: {
        membershipId: options.membershipId,
        accountId: target.account_id,
        previousRole: target.role_code,
        role: nextRole,
        previousLifecycleState: target.lifecycle_state,
        lifecycleState: nextLifecycleState,
        revokedDeveloperTokenCount,
        revokedSessionCount,
        updatedClientInstallationCount,
      },
      access,
    });
    return response;
  });
}

async function loadOrganizationMembershipSummary(
  client: PlatformPoolClient,
  membershipId: string,
  access: OrganizationMutationAccess,
): Promise<OrganizationMembershipSummary> {
  const result = await client.query<OrganizationMembershipRow>(
    organizationMembershipSummaryQuery(
      "membership.membership_id = $1 AND membership.organization_id = $2",
    ),
    [membershipId, access.organizationId],
  );
  if (!result.rows[0]) {
    throw new PlatformApiError(
      404,
      "ORGANIZATION_MEMBERSHIP_NOT_FOUND",
      "Organization membership not found",
    );
  }
  return publicOrganizationMembership(result.rows[0], access.membershipId);
}

function organizationMembershipSummaryQuery(predicate: string): string {
  return `
    SELECT
      membership.membership_id,
      membership.account_id,
      account.display_name,
      identity.email_normalized,
      membership.role_code,
      membership.lifecycle_state,
      membership.joined_at,
      membership.updated_at,
      count(token.developer_token_id) FILTER (
        WHERE token.revoked_at IS NULL
          AND (token.expires_at IS NULL OR token.expires_at > clock_timestamp())
      ) AS developer_token_count
    FROM radius_platform.organization_memberships AS membership
    JOIN radius_platform.accounts AS account
      ON account.account_id = membership.account_id
    LEFT JOIN LATERAL (
      SELECT account_identity.email_normalized
      FROM radius_platform.account_identities AS account_identity
      WHERE account_identity.account_id = membership.account_id
      ORDER BY account_identity.last_authenticated_at DESC NULLS LAST,
        account_identity.created_at DESC
      LIMIT 1
    ) AS identity ON true
    LEFT JOIN radius_platform.developer_tokens AS token
      ON token.membership_id = membership.membership_id
    WHERE ${predicate}
    GROUP BY membership.membership_id, account.display_name,
      identity.email_normalized
    ORDER BY
      CASE membership.lifecycle_state
        WHEN 'active' THEN 0
        WHEN 'suspended' THEN 1
        ELSE 2
      END,
      lower(coalesce(account.display_name, identity.email_normalized, '')),
      membership.joined_at,
      membership.membership_id
  `;
}

function publicOrganizationMembership(
  row: OrganizationMembershipRow,
  currentMembershipId: string,
): OrganizationMembershipSummary {
  return {
    id: row.membership_id,
    accountId: row.account_id,
    displayName: row.display_name,
    email: row.email_normalized,
    role: row.role_code,
    lifecycleState: row.lifecycle_state,
    joinedAt: row.joined_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    developerTokenCount: Number(row.developer_token_count),
    current: row.membership_id === currentMembershipId,
  };
}

async function listDeveloperTokens(
  pool: PlatformPool,
  identity: DatabaseMutationIdentity,
  organization: string,
  access: OrganizationMutationAccess,
): Promise<ListDeveloperTokensResponse> {
  const result = await pool.query<DeveloperTokenRow>(
    developerTokenSummaryQuery("membership.organization_id = $1"),
    [access.organizationId],
  );
  return {
    apiVersion: 1,
    organization,
    tokens: result.rows.map((row) =>
      publicDeveloperToken(
        row,
        isPostgresIdentity(identity) ? identity.developerTokenId : null,
      ),
    ),
  };
}

async function createDeveloperToken(options: {
  pool: PlatformPool;
  identity: DatabaseMutationIdentity;
  organization: string;
  request: CreateDeveloperTokenRequest;
  idempotencyKey: string;
  access: OrganizationMutationAccess;
}): Promise<CreateDeveloperTokenResponse> {
  for (const scope of options.request.scopes) {
    if (!options.access.scopes.has(scope)) {
      throw new PlatformApiError(
        403,
        "TOKEN_SCOPE_ESCALATION",
        `Cannot grant developer-token scope ${scope}`,
      );
    }
  }
  if (
    options.request.expiresAt !== null &&
    new Date(options.request.expiresAt).getTime() <= Date.now()
  ) {
    throw new PlatformApiError(
      400,
      "TOKEN_EXPIRY_INVALID",
      "Developer-token expiry must be in the future",
    );
  }
  const requestDigest = digestJson(options.request);
  return withPlatformTransaction(options.pool, async (client) => {
    await lockIdempotency(
      client,
      options.identity,
      "developer_token.create",
      options.idempotencyKey,
    );
    const existing = await getIdempotency(
      client,
      options.identity,
      "developer_token.create",
      options.idempotencyKey,
      requestDigest,
    );
    if (existing) {
      throw new PlatformApiError(
        409,
        "TOKEN_SECRET_ALREADY_ISSUED",
        `Developer token ${existing.resourceReference ?? ""} was already created; its secret cannot be shown again`,
      );
    }

    const secret = `radius_pat_${randomBytes(32).toString("base64url")}`;
    const developerTokenId = randomUUID();
    await client.query(
      `
        INSERT INTO radius_platform.developer_tokens (
          developer_token_id,
          membership_id,
          label,
          token_hash,
          token_prefix,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        developerTokenId,
        options.access.membershipId,
        options.request.label,
        sha256Buffer(secret),
        secret.slice(0, 16),
        options.request.expiresAt,
      ],
    );
    for (const scope of new Set(options.request.scopes)) {
      await client.query(
        `
          INSERT INTO radius_platform.developer_token_scopes (
            developer_token_id, scope_code
          ) VALUES ($1, $2)
        `,
        [developerTokenId, scope],
      );
    }
    const token = await loadDeveloperTokenSummary(
      client,
      developerTokenId,
      options.identity,
      options.access.organizationId,
    );
    const response: CreateDeveloperTokenResponse = {
      apiVersion: 1,
      token,
      secret,
    };
    await completeIdempotency(client, {
      identity: options.identity,
      operation: "developer_token.create",
      key: options.idempotencyKey,
      requestDigest,
      responseStatus: 201,
      responseBody: { apiVersion: 1, token },
      resourceReference: developerTokenId,
    });
    await insertAuditEvent(client, {
      identity: options.identity,
      eventKey: `developer_token.create:${options.idempotencyKey}`,
      action: "developer_token.create",
      metadata: {
        developerTokenId,
        scopes: token.scopes,
        expiresAt: token.expiresAt,
      },
      access: options.access,
    });
    return response;
  });
}

async function revokeDeveloperToken(options: {
  pool: PlatformPool;
  identity: DatabaseMutationIdentity;
  organization: string;
  developerTokenId: string;
  idempotencyKey: string;
  access: OrganizationMutationAccess;
}): Promise<RevokeDeveloperTokenResponse> {
  if (
    isPostgresIdentity(options.identity) &&
    options.developerTokenId === options.identity.developerTokenId
  ) {
    throw new PlatformApiError(
      409,
      "CURRENT_TOKEN_REVOCATION_FORBIDDEN",
      "Create and authenticate with a replacement before revoking the current token",
    );
  }
  const requestDigest = digestJson({
    organization: options.organization,
    developerTokenId: options.developerTokenId,
  });
  return withPlatformTransaction(options.pool, async (client) => {
    await lockIdempotency(
      client,
      options.identity,
      "developer_token.revoke",
      options.idempotencyKey,
    );
    const existing = await getIdempotency(
      client,
      options.identity,
      "developer_token.revoke",
      options.idempotencyKey,
      requestDigest,
    );
    if (existing) return existing.responseBody as RevokeDeveloperTokenResponse;

    const target = await client.query<{ developer_token_id: string }>(
      `
        SELECT token.developer_token_id
        FROM radius_platform.developer_tokens AS token
        JOIN radius_platform.organization_memberships AS membership
          ON membership.membership_id = token.membership_id
        WHERE token.developer_token_id = $1
          AND membership.organization_id = $2
        FOR UPDATE OF token
      `,
      [options.developerTokenId, options.access.organizationId],
    );
    if (!target.rows[0]) {
      throw new PlatformApiError(
        404,
        "DEVELOPER_TOKEN_NOT_FOUND",
        "Developer token not found",
      );
    }
    await client.query(
      `
        UPDATE radius_platform.developer_tokens
        SET revoked_at = coalesce(revoked_at, clock_timestamp())
        WHERE developer_token_id = $1
      `,
      [options.developerTokenId],
    );
    const token = await loadDeveloperTokenSummary(
      client,
      options.developerTokenId,
      options.identity,
      options.access.organizationId,
    );
    const response: RevokeDeveloperTokenResponse = { apiVersion: 1, token };
    await completeIdempotency(client, {
      identity: options.identity,
      operation: "developer_token.revoke",
      key: options.idempotencyKey,
      requestDigest,
      responseStatus: 200,
      responseBody: response,
      resourceReference: options.developerTokenId,
    });
    await insertAuditEvent(client, {
      identity: options.identity,
      eventKey: `developer_token.revoke:${options.idempotencyKey}`,
      action: "developer_token.revoke",
      metadata: { developerTokenId: options.developerTokenId },
      access: options.access,
    });
    return response;
  });
}

interface DeveloperTokenRow {
  developer_token_id: string;
  label: string;
  token_prefix: string;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  scopes: DeveloperTokenScope[];
}

function developerTokenSummaryQuery(predicate: string): string {
  return `
    SELECT
      token.developer_token_id,
      token.label,
      token.token_prefix,
      token.created_at,
      token.last_used_at,
      token.expires_at,
      token.revoked_at,
      coalesce(
        array_agg(scope.scope_code ORDER BY scope.scope_code)
          FILTER (WHERE scope.scope_code IS NOT NULL),
        ARRAY[]::text[]
      ) AS scopes
    FROM radius_platform.developer_tokens AS token
    JOIN radius_platform.organization_memberships AS membership
      ON membership.membership_id = token.membership_id
    LEFT JOIN radius_platform.developer_token_scopes AS scope
      ON scope.developer_token_id = token.developer_token_id
    WHERE ${predicate}
    GROUP BY token.developer_token_id
    ORDER BY token.created_at DESC, token.developer_token_id DESC
  `;
}

async function loadDeveloperTokenSummary(
  client: PlatformPoolClient,
  developerTokenId: string,
  identity: DatabaseMutationIdentity,
  organizationId: string,
): Promise<DeveloperTokenSummary> {
  const result = await client.query<DeveloperTokenRow>(
    developerTokenSummaryQuery(
      "token.developer_token_id = $1 AND membership.organization_id = $2",
    ),
    [developerTokenId, organizationId],
  );
  if (!result.rows[0]) {
    throw new PlatformApiError(
      404,
      "DEVELOPER_TOKEN_NOT_FOUND",
      "Developer token not found",
    );
  }
  return publicDeveloperToken(
    result.rows[0],
    isPostgresIdentity(identity) ? identity.developerTokenId : null,
  );
}

function publicDeveloperToken(
  row: DeveloperTokenRow,
  currentDeveloperTokenId: string | null,
): DeveloperTokenSummary {
  return {
    id: row.developer_token_id,
    label: row.label,
    prefix: row.token_prefix,
    scopes: row.scopes,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    current: row.developer_token_id === currentDeveloperTokenId,
  };
}

function assertOrganizationAccess(
  identity: PostgresIdentity,
  organization: string,
): void {
  if (
    !identity.response.organizations.some(
      (candidate) => candidate.slug === organization,
    )
  ) {
    throw new PlatformApiError(
      404,
      "ORGANIZATION_NOT_FOUND",
      "Organization not found",
    );
  }
}

async function listAgents(
  pool: PlatformPool,
  identity: DatabaseReadIdentity,
  organization: string,
): Promise<ListAgentsResponse> {
  const organizationId = await requireOrganizationReadAccess(
    pool,
    identity,
    organization,
  );
  const result = await pool.query<{
    agent_ref: string;
    agent_display_name: string;
    environment_slug: string;
    deployment_revision: string | null;
    agent_deployment_version: string | null;
    image_digest: string | null;
    verification_state: "verified" | "quarantined" | null;
  }>(
    `
      SELECT
        agent_ref,
        agent_display_name,
        environment_slug,
        deployment_revision,
        agent_deployment_version,
        image_digest,
        verification_state
      FROM radius_platform.organization_agent_inventory
      WHERE organization_id = $1
      ORDER BY agent_display_name, agent_ref, environment_slug
    `,
    [organizationId],
  );
  const agents = new Map<string, ListAgentsResponse["agents"][number]>();
  for (const row of result.rows) {
    const agent = agents.get(row.agent_ref) ?? {
      agent: row.agent_ref,
      name: row.agent_display_name,
      environments: [],
    };
    agent.environments.push({
      name: row.environment_slug,
      deployment:
        row.deployment_revision &&
        row.agent_deployment_version &&
        row.image_digest &&
        row.verification_state
          ? {
              revision: Number(row.deployment_revision),
              agentDeploymentVersion: row.agent_deployment_version,
              imageDigest: row.image_digest,
              state: row.verification_state,
            }
          : null,
    });
    agents.set(row.agent_ref, agent);
  }
  return { apiVersion: 1, organization, agents: [...agents.values()] };
}

async function listAgentDeployments(
  pool: PlatformPool,
  identity: DatabaseReadIdentity,
  agent: string,
  limit: number,
  cursor: string | null,
): Promise<ListAgentDeploymentsResponse> {
  const agentId = await requireAgentAccess(pool, identity, agent);
  const cursorId = cursor === null ? null : decodeCursor(cursor);
  const result = await pool.query<{
    agent_deployment_id: string;
    version: string;
    image_digest: string;
    source_manifest_digest: string;
    sbom_digest: string | null;
    provenance_digest: string | null;
    minimum_desktop_version: string;
    runtime_protocol_version: number;
    verification_state: "verified" | "quarantined";
    created_at: Date;
  }>(
    `
      WITH cursor_deployment AS (
        SELECT created_at, agent_deployment_id
        FROM radius_platform.agent_deployments
        WHERE agent_deployment_id = $3 AND agent_id = $1
      )
      SELECT
        agentDeployment.agent_deployment_id,
        agentDeployment.version,
        agentDeployment.image_digest,
        agentDeployment.source_manifest_digest,
        agentDeployment.minimum_desktop_version,
        agentDeployment.runtime_protocol_version,
        (
          SELECT artifact.digest
          FROM radius_platform.agent_deployment_artifacts AS artifact
          WHERE artifact.agent_deployment_id = agentDeployment.agent_deployment_id
            AND artifact.artifact_kind = 'sbom'
          ORDER BY artifact.created_at, artifact.agent_deployment_artifact_id
          LIMIT 1
        ) AS sbom_digest,
        (
          SELECT artifact.digest
          FROM radius_platform.agent_deployment_artifacts AS artifact
          WHERE artifact.agent_deployment_id = agentDeployment.agent_deployment_id
            AND artifact.artifact_kind = 'provenance'
          ORDER BY artifact.created_at, artifact.agent_deployment_artifact_id
          LIMIT 1
        ) AS provenance_digest,
        agentDeployment.verification_state,
        agentDeployment.created_at
      FROM radius_platform.agent_deployments AS agentDeployment
      WHERE agentDeployment.agent_id = $1
        AND agentDeployment.verification_state IN ('verified', 'quarantined')
        AND (
          $3::uuid IS NULL
          OR (agentDeployment.created_at, agentDeployment.agent_deployment_id) < (
            SELECT created_at, agent_deployment_id FROM cursor_deployment
          )
        )
      ORDER BY agentDeployment.created_at DESC, agentDeployment.agent_deployment_id DESC
      LIMIT $2
    `,
    [agentId, limit + 1, cursorId],
  );
  if (cursorId && result.rows.length === 0) {
    const cursorExists = await pool.query(
      `SELECT 1 FROM radius_platform.agent_deployments
       WHERE agent_deployment_id = $1 AND agent_id = $2`,
      [cursorId, agentId],
    );
    if (cursorExists.rowCount === 0) {
      throw new PlatformApiError(400, "INVALID_CURSOR", "Cursor is invalid");
    }
  }
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  return {
    apiVersion: 1,
    agent,
    agentDeployments: rows.map((row) => ({
      id: row.agent_deployment_id,
      version: row.version,
      imageDigest: row.image_digest,
      sourceManifestDigest: row.source_manifest_digest,
      sbomDigest: row.sbom_digest,
      provenanceDigest: row.provenance_digest,
      minimumDesktopVersion: row.minimum_desktop_version,
      runtimeProtocolVersion: row.runtime_protocol_version,
      state: row.verification_state,
      createdAt: row.created_at.toISOString(),
    })),
    nextCursor:
      hasMore && rows.length > 0
        ? encodeCursor(rows.at(-1)!.agent_deployment_id)
        : null,
  };
}

async function listAgentEnvironmentHistory(
  pool: PlatformPool,
  identity: DatabaseReadIdentity,
  agent: string,
  environment: string,
  limit: number,
  cursor: string | null,
): Promise<ListAgentEnvironmentHistoryResponse> {
  const target = await requireEnvironmentAccess(
    pool,
    identity,
    agent,
    environment,
  );
  const beforeRevision = cursor === null ? null : decodeRevisionCursor(cursor);
  const result = await pool.query<{
    revision: string;
    action_code: "deploy" | "promote" | "rollback" | "revoke";
    agent_deployment_id: string | null;
    agent_deployment_version: string | null;
    image_digest: string | null;
    previous_agent_deployment_id: string | null;
    created_at: Date;
  }>(
    `
      WITH history AS (
        SELECT
          revision.agent_environment_revision_id,
          revision.revision,
          revision.action_code,
          revision.agent_deployment_id,
          lag(revision.agent_deployment_id) OVER (
            PARTITION BY revision.environment_id
            ORDER BY revision.revision
          ) AS previous_agent_deployment_id,
          revision.created_at
        FROM radius_platform.agent_environment_revisions AS revision
        WHERE revision.environment_id = $1
      )
      SELECT
        history.revision,
        history.action_code,
        history.agent_deployment_id,
        agentDeployment.version AS agent_deployment_version,
        agentDeployment.image_digest,
        history.previous_agent_deployment_id,
        history.created_at
      FROM history
      LEFT JOIN radius_platform.agent_deployments AS agentDeployment
        ON agentDeployment.agent_deployment_id = history.agent_deployment_id
      WHERE ($2::bigint IS NULL OR history.revision < $2)
      ORDER BY history.revision DESC
      LIMIT $3
    `,
    [target.environmentId, beforeRevision, limit + 1],
  );
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  const current = await pool.query<{ revision: string | null }>(
    `SELECT max(revision) AS revision
     FROM radius_platform.agent_environment_revisions
     WHERE environment_id = $1`,
    [target.environmentId],
  );
  return {
    apiVersion: 1,
    agent,
    environment,
    currentRevision: Number(current.rows[0]?.revision ?? 0),
    revisions: rows.map((row) => ({
      revision: Number(row.revision),
      action: row.action_code,
      agentDeploymentId: row.agent_deployment_id,
      agentDeploymentVersion: row.agent_deployment_version,
      imageDigest: row.image_digest,
      previousAgentDeploymentId: row.previous_agent_deployment_id,
      createdAt: row.created_at.toISOString(),
    })),
    nextCursor:
      hasMore && rows.length > 0 ? encodeCursor(rows.at(-1)!.revision) : null,
  };
}

async function prepareAgentDeployment(options: {
  pool: PlatformPool;
  identity: DatabaseMutationIdentity;
  access: OrganizationMutationAccess;
  request: PrepareAgentDeploymentRequest;
  idempotencyKey: string;
  registry: string;
  registryUsername: string;
  registryPassword: string;
  now: () => Date;
}): Promise<PrepareAgentDeploymentResponse> {
  const requestDigest = digestJson(options.request);
  return withPlatformTransaction(options.pool, async (client) => {
    await lockIdempotency(
      client,
      options.identity,
      "deployment.prepare",
      options.idempotencyKey,
    );
    const existing = await getIdempotency(
      client,
      options.identity,
      "deployment.prepare",
      options.idempotencyKey,
      requestDigest,
    );
    if (existing) {
      const upload = await client.query<{
        upload_id: string;
        image_reference: string;
        expires_at: Date;
      }>(
        `SELECT upload_id, image_reference, expires_at
         FROM radius_platform.agent_deployment_uploads WHERE upload_id = $1`,
        [existing.resourceReference],
      );
      const row = upload.rows[0];
      if (!row) {
        throw new PlatformApiError(
          409,
          "IDEMPOTENCY_STATE_INVALID",
          "Prepared upload is missing",
        );
      }
      return prepareResponse(options, row);
    }

    const agent = await ensureAgent(
      client,
      options.identity,
      options.access,
      options.request,
    );
    const environmentId = await ensureEnvironment(
      client,
      agent.agentId,
      options.request.environment,
    );
    const uploadId = randomUUID();
    const imageReference = `${options.registry}/${options.request.agent}/agent:${uploadId.replaceAll("-", "")}`;
    const expiresAt = new Date(options.now().getTime() + 15 * 60_000);
    await client.query(
      `
        INSERT INTO radius_platform.agent_deployment_uploads (
          upload_id,
          agent_id,
          requested_environment_id,
          created_by_membership_id,
          created_by_developer_token_id,
          build_digest,
          bundle_sha256,
          minimum_desktop_version,
          runtime_protocol_version,
          image_reference,
          secret_reference,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        uploadId,
        agent.agentId,
        environmentId,
        isBrowserSessionIdentity(options.identity)
          ? options.access.membershipId
          : null,
        isPostgresIdentity(options.identity)
          ? options.identity.developerTokenId
          : null,
        options.request.buildDigest,
        options.request.bundleSha256,
        options.request.manifest.minimumDesktopVersion,
        options.request.manifest.protocol.version,
        imageReference,
        "environment:RADIUS_PLATFORM_REGISTRY_PASSWORD",
        expiresAt,
      ],
    );
    await completeIdempotency(client, {
      identity: options.identity,
      operation: "deployment.prepare",
      key: options.idempotencyKey,
      requestDigest,
      responseStatus: 201,
      responseBody: { apiVersion: 1, uploadId, imageReference },
      resourceReference: uploadId,
    });
    await insertAuditEvent(client, {
      identity: options.identity,
      eventKey: `deployment.prepare:${options.idempotencyKey}`,
      action: "deployment.prepare",
      agentId: agent.agentId,
      environmentId,
      metadata: { agent: options.request.agent },
      access: options.access,
    });
    return prepareResponse(options, {
      upload_id: uploadId,
      image_reference: imageReference,
      expires_at: expiresAt,
    });
  });
}

function prepareResponse(
  options: {
    registry: string;
    registryUsername: string;
    registryPassword: string;
  },
  upload: { upload_id: string; image_reference: string; expires_at: Date },
): PrepareAgentDeploymentResponse {
  return {
    apiVersion: 1,
    uploadId: upload.upload_id,
    imageReference: upload.image_reference,
    credentials: {
      registry: options.registry,
      username: options.registryUsername,
      password: options.registryPassword,
      expiresAt: upload.expires_at.toISOString(),
    },
  };
}

async function loadUploadForVerification(
  pool: PlatformPool,
  identity: DatabaseMutationIdentity,
  access: OrganizationMutationAccess,
  agent: string,
  request: FinalizeAgentDeploymentRequest,
): Promise<{ imageReference: string }> {
  const result = await pool.query<{
    image_reference: string;
    bundle_sha256: string;
    upload_state: string;
  }>(
    `
      SELECT upload.image_reference, upload.bundle_sha256, upload.upload_state
      FROM radius_platform.agent_deployment_uploads AS upload
      JOIN radius_platform.agents AS agent
        ON agent.agent_id = upload.agent_id
      WHERE upload.upload_id = $1
        AND agent.agent_ref = $2
        AND agent.organization_id = $3
        AND (
          ($4::uuid IS NOT NULL AND upload.created_by_developer_token_id = $4)
          OR ($5::uuid IS NOT NULL AND upload.created_by_membership_id = $5)
        )
    `,
    [
      request.uploadId,
      agent,
      access.organizationId,
      isPostgresIdentity(identity) ? identity.developerTokenId : null,
      isBrowserSessionIdentity(identity) ? access.membershipId : null,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new PlatformApiError(
      404,
      "UPLOAD_NOT_FOUND",
      "Agent deployment upload not found",
    );
  }
  if (row.bundle_sha256 !== request.bundleSha256) {
    throw new PlatformApiError(
      409,
      "BUNDLE_DIGEST_MISMATCH",
      "Finalized bundle does not match the prepared deployment",
    );
  }
  if (!["prepared", "finalized"].includes(row.upload_state)) {
    throw new PlatformApiError(
      409,
      "UPLOAD_NOT_ACTIVE",
      "Agent deployment upload is not active",
    );
  }
  return { imageReference: row.image_reference };
}

async function finalizeAgentDeployment(options: {
  pool: PlatformPool;
  identity: DatabaseMutationIdentity;
  access: OrganizationMutationAccess;
  agent: string;
  request: FinalizeAgentDeploymentRequest;
  idempotencyKey: string;
  now: () => Date;
  verification: {
    mediaType: string | null;
    contentLength: number | null;
  };
}): Promise<FinalizeAgentDeploymentResponse> {
  const requestDigest = digestJson({
    agent: options.agent,
    request: options.request,
  });
  return withPlatformTransaction(options.pool, async (client) => {
    await lockIdempotency(
      client,
      options.identity,
      "deployment.finalize",
      options.idempotencyKey,
    );
    const existing = await getIdempotency(
      client,
      options.identity,
      "deployment.finalize",
      options.idempotencyKey,
      requestDigest,
    );
    if (existing) {
      return existing.responseBody as FinalizeAgentDeploymentResponse;
    }

    const uploadResult = await client.query<{
      upload_id: string;
      agent_id: string;
      requested_environment_id: string;
      bundle_sha256: string;
      image_reference: string;
      upload_state: string;
      organization_id: string;
      agent_ref: string;
      minimum_desktop_version: string;
      runtime_protocol_version: number;
    }>(
      `
        SELECT
          upload.upload_id,
          upload.agent_id,
          upload.requested_environment_id,
          upload.bundle_sha256,
          upload.image_reference,
          upload.upload_state,
          upload.minimum_desktop_version,
          upload.runtime_protocol_version,
          agent.organization_id,
          agent.agent_ref
        FROM radius_platform.agent_deployment_uploads AS upload
        JOIN radius_platform.agents AS agent
          ON agent.agent_id = upload.agent_id
        WHERE upload.upload_id = $1
        FOR UPDATE OF upload
      `,
      [options.request.uploadId],
    );
    const upload = uploadResult.rows[0];
    if (
      !upload ||
      upload.agent_ref !== options.agent ||
      upload.organization_id !== options.access.organizationId
    ) {
      throw new PlatformApiError(
        404,
        "UPLOAD_NOT_FOUND",
        "Agent deployment upload not found",
      );
    }
    if (upload.bundle_sha256 !== options.request.bundleSha256) {
      throw new PlatformApiError(
        409,
        "BUNDLE_DIGEST_MISMATCH",
        "Finalized bundle does not match the prepared deployment",
      );
    }
    if (upload.upload_state !== "prepared") {
      throw new PlatformApiError(
        409,
        "UPLOAD_ALREADY_FINALIZED",
        "Agent deployment upload is already finalized",
      );
    }

    await client.query(
      `SELECT agent_id FROM radius_platform.agents
       WHERE agent_id = $1 FOR UPDATE`,
      [upload.agent_id],
    );
    const finalizedAt = options.now();
    const datePrefix = finalizedAt
      .toISOString()
      .slice(0, 10)
      .replaceAll("-", "");
    const versionResult = await client.query<{ deployment_count: string }>(
      `
        SELECT count(*) AS deployment_count
        FROM radius_platform.agent_deployments
        WHERE agent_id = $1 AND version LIKE $2
      `,
      [upload.agent_id, `${datePrefix}.%`],
    );
    const version = `${datePrefix}.${Number(versionResult.rows[0]!.deployment_count) + 1}`;
    const agentDeploymentId = randomUUID();
    await client.query(
      `
        INSERT INTO radius_platform.agent_deployments (
          agent_deployment_id,
          agent_id,
          upload_id,
          version,
          agent_config_version,
          agent_manifest_version,
          minimum_desktop_version,
          runtime_protocol_version,
          image_digest,
          source_manifest_digest,
          bundle_sha256,
          verification_state,
          verification_completed_at,
          created_at
        ) VALUES ($1, $2, $3, $4, 1, 1, $5, $6, $7, $8, $9, 'verified', $10, $10)
      `,
      [
        agentDeploymentId,
        upload.agent_id,
        upload.upload_id,
        version,
        upload.minimum_desktop_version,
        upload.runtime_protocol_version,
        options.request.imageDigest,
        options.request.sourceManifestDigest,
        options.request.bundleSha256,
        finalizedAt,
      ],
    );
    await insertAgentDeploymentArtifact(client, {
      agentDeploymentId,
      kind: "oci_manifest",
      providerReference: upload.image_reference,
      digest: options.request.imageDigest,
      mediaType:
        options.verification.mediaType ??
        "application/vnd.oci.image.manifest.v1+json",
      byteSize: options.verification.contentLength ?? 0,
    });
    if (options.request.sbomDigest) {
      await insertAgentDeploymentArtifact(client, {
        agentDeploymentId,
        kind: "sbom",
        providerReference: `${upload.image_reference}#sbom`,
        digest: options.request.sbomDigest,
        mediaType: "application/spdx+json",
        byteSize: 0,
      });
    }
    if (options.request.provenanceDigest) {
      await insertAgentDeploymentArtifact(client, {
        agentDeploymentId,
        kind: "provenance",
        providerReference: `${upload.image_reference}#provenance`,
        digest: options.request.provenanceDigest,
        mediaType: "application/vnd.in-toto+json",
        byteSize: 0,
      });
    }
    await client.query(
      `
        UPDATE radius_platform.agent_deployment_uploads
        SET upload_state = 'finalized', finalized_at = $2
        WHERE upload_id = $1
      `,
      [upload.upload_id, finalizedAt],
    );

    let environmentRevision: FinalizeAgentDeploymentResponse["environmentRevision"] =
      null;
    let environmentRevisionId: string | null = null;
    if (options.request.promote) {
      const appended = await appendAgentEnvironmentRevision(client, {
        identity: options.identity,
        access: options.access,
        agentId: upload.agent_id,
        environmentId: upload.requested_environment_id,
        agentDeploymentId,
        action: "deploy",
        expectedRevision: options.request.expectedDeploymentRevision,
      });
      environmentRevisionId = appended.environmentRevisionId;
      environmentRevision = {
        environment: appended.environment,
        revision: appended.revision,
        agentDeploymentId,
      };
    }

    const response: FinalizeAgentDeploymentResponse = {
      apiVersion: 1,
      agentDeployment: {
        id: agentDeploymentId,
        version,
        imageDigest: options.request.imageDigest,
        state: "verified",
      },
      environmentRevision,
    };
    await client.query(
      `
        INSERT INTO radius_platform.job_outbox_messages (
          outbox_message_id,
          aggregate_code,
          aggregate_id,
          job_name,
          job_version,
          payload,
          job_idempotency_key
        ) VALUES ($1, 'agent_deployment', $2, 'agent_deployment.verify.v1', 1, $3, $4)
      `,
      [
        randomUUID(),
        agentDeploymentId,
        JSON.stringify({
          version: 1,
          idempotencyKey: `verify.${agentDeploymentId}`,
          organizationId: options.access.organizationId,
          agent: options.agent,
          agentDeploymentId,
          imageReference: upload.image_reference,
          expectedImageDigest: options.request.imageDigest,
        }),
        `deployment.verify:${agentDeploymentId}`,
      ],
    );
    await completeIdempotency(client, {
      identity: options.identity,
      operation: "deployment.finalize",
      key: options.idempotencyKey,
      requestDigest,
      responseStatus: 200,
      responseBody: response,
      resourceReference: agentDeploymentId,
    });
    await insertAuditEvent(client, {
      identity: options.identity,
      eventKey: `deployment.finalize:${options.idempotencyKey}`,
      action: "deployment.finalize",
      agentId: upload.agent_id,
      agentDeploymentId,
      environmentId: upload.requested_environment_id,
      environmentRevisionId,
      metadata: {
        agent: options.agent,
        version,
        promoted: options.request.promote,
      },
      access: options.access,
    });
    return response;
  });
}

async function insertAgentDeploymentArtifact(
  client: PlatformPoolClient,
  artifact: {
    agentDeploymentId: string;
    kind: "oci_manifest" | "sbom" | "provenance";
    providerReference: string;
    digest: string;
    mediaType: string;
    byteSize: number;
  },
): Promise<void> {
  await client.query(
    `
      INSERT INTO radius_platform.agent_deployment_artifacts (
        agent_deployment_artifact_id,
        agent_deployment_id,
        artifact_kind,
        provider_reference,
        digest,
        media_type,
        byte_size
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      randomUUID(),
      artifact.agentDeploymentId,
      artifact.kind,
      artifact.providerReference,
      artifact.digest,
      artifact.mediaType,
      artifact.byteSize,
    ],
  );
}

async function changeDeployment(options: {
  pool: PlatformPool;
  identity: DatabaseMutationIdentity;
  action: "promote" | "rollback";
  agent: string;
  environment: string;
  request: PromoteAgentDeploymentRequest | RollbackAgentDeploymentRequest;
  idempotencyKey: string;
}): Promise<AgentEnvironmentChangeResponse> {
  const operation = `deployment.${options.action}`;
  const requestDigest = digestJson({
    agent: options.agent,
    environment: options.environment,
    request: options.request,
  });
  return withPlatformTransaction(options.pool, async (client) => {
    await lockIdempotency(
      client,
      options.identity,
      operation,
      options.idempotencyKey,
    );
    const existing = await getIdempotency(
      client,
      options.identity,
      operation,
      options.idempotencyKey,
      requestDigest,
    );
    if (existing)
      return existing.responseBody as AgentEnvironmentChangeResponse;

    const target = await requireEnvironmentMutationAccess(
      client,
      options.identity,
      options.agent,
      options.environment,
      "deployment.write",
    );
    const agentDeployment = await client.query<{
      agent_deployment_id: string;
      verification_state: string;
    }>(
      `
        SELECT agent_deployment_id, verification_state
        FROM radius_platform.agent_deployments
        WHERE agent_deployment_id = $1 AND agent_id = $2
      `,
      [options.request.agentDeploymentId, target.agentId],
    );
    const deploymentRow = agentDeployment.rows[0];
    if (!deploymentRow) {
      throw new PlatformApiError(
        404,
        "AGENT_DEPLOYMENT_NOT_FOUND",
        "Agent deployment not found",
      );
    }
    if (deploymentRow.verification_state !== "verified") {
      throw new PlatformApiError(
        409,
        "AGENT_DEPLOYMENT_NOT_VERIFIED",
        "Agent deployment is not verified",
      );
    }
    const appended = await appendAgentEnvironmentRevision(client, {
      identity: options.identity,
      agentId: target.agentId,
      environmentId: target.environmentId,
      agentDeploymentId: options.request.agentDeploymentId,
      action: options.action,
      expectedRevision: options.request.expectedDeploymentRevision,
      access: target.access,
    });
    const response: AgentEnvironmentChangeResponse = {
      apiVersion: 1,
      environmentRevision: {
        environment: appended.environment,
        revision: appended.revision,
        agentDeploymentId: options.request.agentDeploymentId,
        previousAgentDeploymentId: appended.previousAgentDeploymentId,
      },
    };
    await completeIdempotency(client, {
      identity: options.identity,
      operation,
      key: options.idempotencyKey,
      requestDigest,
      responseStatus: 200,
      responseBody: response,
      resourceReference: appended.environmentRevisionId,
    });
    await insertAuditEvent(client, {
      identity: options.identity,
      eventKey: `${operation}:${options.idempotencyKey}`,
      action: operation,
      agentId: target.agentId,
      agentDeploymentId: options.request.agentDeploymentId,
      environmentId: target.environmentId,
      environmentRevisionId: appended.environmentRevisionId,
      metadata: {
        agent: options.agent,
        environment: options.environment,
        revision: appended.revision,
      },
      access: target.access,
    });
    return response;
  });
}

async function registerClientInstallation(options: {
  pool: PlatformPool;
  identity: DatabaseMutationIdentity;
  access: OrganizationMutationAccess;
  clientInstanceId: string;
  request: RegisterClientInstallationRequest;
  idempotencyKey: string;
}): Promise<RegisterClientInstallationResponse> {
  const operation = "client_installation.register";
  const requestDigest = digestJson(options.request);
  return withPlatformTransaction(options.pool, async (client) => {
    await lockIdempotency(
      client,
      options.identity,
      operation,
      options.idempotencyKey,
    );
    const existing = await getIdempotency(
      client,
      options.identity,
      operation,
      options.idempotencyKey,
      requestDigest,
    );
    if (existing) {
      return existing.responseBody as RegisterClientInstallationResponse;
    }

    const deviceResult = await client.query<{ physical_device_id: string }>(
      `
        SELECT physical_device_id
        FROM radius_platform.physical_devices
        WHERE organization_id = $1 AND device_fingerprint = $2
        FOR UPDATE
      `,
      [
        options.access.organizationId,
        options.request.physicalDevice.fingerprint,
      ],
    );
    const physicalDeviceId =
      deviceResult.rows[0]?.physical_device_id ?? randomUUID();
    if (deviceResult.rowCount === 0) {
      await client.query(
        `
          INSERT INTO radius_platform.physical_devices (
            physical_device_id,
            organization_id,
            assigned_membership_id,
            device_fingerprint,
            display_name,
            asset_tag,
            platform,
            architecture
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          physicalDeviceId,
          options.access.organizationId,
          options.access.membershipId,
          options.request.physicalDevice.fingerprint,
          options.request.physicalDevice.displayName,
          options.request.physicalDevice.assetTag,
          options.request.physicalDevice.platform,
          options.request.physicalDevice.architecture,
        ],
      );
    } else {
      await client.query(
        `
          UPDATE radius_platform.physical_devices
          SET assigned_membership_id = $2,
              display_name = $3,
              asset_tag = $4,
              platform = $5,
              architecture = $6,
              lifecycle_state = 'active'
          WHERE physical_device_id = $1
        `,
        [
          physicalDeviceId,
          options.access.membershipId,
          options.request.physicalDevice.displayName,
          options.request.physicalDevice.assetTag,
          options.request.physicalDevice.platform,
          options.request.physicalDevice.architecture,
        ],
      );
    }

    const installationResult = await client.query<{
      client_installation_id: string;
      organization_id: string;
    }>(
      `
        SELECT client_installation_id, organization_id
        FROM radius_platform.client_installations
        WHERE client_instance_id = $1
        FOR UPDATE
      `,
      [options.clientInstanceId],
    );
    const clientInstallationId =
      installationResult.rows[0]?.client_installation_id ?? randomUUID();
    if (
      installationResult.rows[0] &&
      installationResult.rows[0].organization_id !==
        options.access.organizationId
    ) {
      throw new PlatformApiError(
        409,
        "CLIENT_INSTANCE_ALREADY_REGISTERED",
        "Client instance is already registered to another organization",
      );
    }
    if (installationResult.rowCount === 0) {
      await client.query(
        `
          INSERT INTO radius_platform.client_installations (
            client_installation_id,
            organization_id,
            physical_device_id,
            membership_id,
            client_instance_id
          ) VALUES ($1, $2, $3, $4, $5)
        `,
        [
          clientInstallationId,
          options.access.organizationId,
          physicalDeviceId,
          options.access.membershipId,
          options.clientInstanceId,
        ],
      );
    } else {
      await client.query(
        `
          UPDATE radius_platform.client_installations
          SET physical_device_id = $2,
              membership_id = $3,
              lifecycle_state = 'active'
          WHERE client_installation_id = $1 AND organization_id = $4
        `,
        [
          clientInstallationId,
          physicalDeviceId,
          options.access.membershipId,
          options.access.organizationId,
        ],
      );
    }

    await client.query(
      `
        INSERT INTO radius_platform.client_installation_observations (
          client_installation_observation_id,
          client_installation_id,
          client_event_id,
          schema_version,
          desktop_version,
          runtime_version,
          runtime_protocol_version,
          observation_state,
          error_code,
          observed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (client_installation_id, client_event_id) DO NOTHING
      `,
      [
        randomUUID(),
        clientInstallationId,
        options.request.observation.clientEventId,
        options.request.observation.schemaVersion,
        options.request.observation.desktopVersion,
        options.request.observation.runtimeVersion,
        options.request.observation.runtimeProtocolVersion,
        options.request.observation.state,
        options.request.observation.errorCode,
        options.request.observation.observedAt,
      ],
    );

    const response: RegisterClientInstallationResponse = {
      apiVersion: 1,
      physicalDeviceId,
      clientInstallationId,
    };
    await completeIdempotency(client, {
      identity: options.identity,
      operation,
      key: options.idempotencyKey,
      requestDigest,
      responseStatus: 200,
      responseBody: response,
      resourceReference: clientInstallationId,
    });
    await insertAuditEvent(client, {
      identity: options.identity,
      access: options.access,
      eventKey: `${operation}:${options.idempotencyKey}`,
      action: operation,
      physicalDeviceId,
      clientInstallationId,
      metadata: { clientInstanceId: options.clientInstanceId },
    });
    return response;
  });
}

async function reportAgentInstallation(options: {
  pool: PlatformPool;
  identity: DatabaseMutationIdentity;
  clientInstallationId: string;
  agent: string;
  request: ReportAgentInstallationRequest;
  idempotencyKey: string;
}): Promise<ReportAgentInstallationResponse> {
  const operation = "agent_installation.observe";
  const requestDigest = digestJson({
    clientInstallationId: options.clientInstallationId,
    agent: options.agent,
    request: options.request,
  });
  return withPlatformTransaction(options.pool, async (client) => {
    await lockIdempotency(
      client,
      options.identity,
      operation,
      options.idempotencyKey,
    );
    const existing = await getIdempotency(
      client,
      options.identity,
      operation,
      options.idempotencyKey,
      requestDigest,
    );
    if (existing) {
      return existing.responseBody as ReportAgentInstallationResponse;
    }

    const target = await client.query<{
      organization_id: string;
      membership_id: string;
      account_id: string;
      agent_id: string;
    }>(
      `
        SELECT
          installation.organization_id,
          installation.membership_id,
          membership.account_id,
          agent.agent_id
        FROM radius_platform.client_installations AS installation
        JOIN radius_platform.organization_memberships AS membership
          ON membership.membership_id = installation.membership_id
        JOIN radius_platform.agents AS agent
          ON agent.organization_id = installation.organization_id
         AND agent.agent_ref = $2
        JOIN radius_platform.agent_deployments AS deployment
          ON deployment.agent_deployment_id = $3
         AND deployment.agent_id = agent.agent_id
         AND deployment.verification_state = 'verified'
        WHERE installation.client_installation_id = $1
          AND installation.lifecycle_state = 'active'
          AND membership.lifecycle_state = 'active'
        FOR UPDATE OF installation
      `,
      [
        options.clientInstallationId,
        options.agent,
        options.request.agentDeploymentId,
      ],
    );
    const row = target.rows[0];
    if (!row) {
      throw new PlatformApiError(
        404,
        "AGENT_INSTALLATION_TARGET_NOT_FOUND",
        "Client, agent, or verified deployment was not found",
      );
    }
    if (isPostgresIdentity(options.identity)) {
      if (
        options.identity.organizationId !== row.organization_id ||
        !options.identity.scopes.has("installation.write")
      ) {
        throw new PlatformApiError(
          403,
          "FORBIDDEN",
          "Installation write access required",
        );
      }
    } else if (options.identity.accountId !== row.account_id) {
      throw new PlatformApiError(
        403,
        "FORBIDDEN",
        "A client installation can report only for its owning account",
      );
    }

    const installation = await client.query<{ agent_installation_id: string }>(
      `
        INSERT INTO radius_platform.agent_installations (
          agent_installation_id,
          organization_id,
          client_installation_id,
          agent_id,
          lifecycle_state
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (client_installation_id, agent_id)
        DO UPDATE SET lifecycle_state = EXCLUDED.lifecycle_state
        RETURNING agent_installation_id
      `,
      [
        randomUUID(),
        row.organization_id,
        options.clientInstallationId,
        row.agent_id,
        options.request.state === "removed" ? "removed" : "active",
      ],
    );
    const agentInstallationId = installation.rows[0]!.agent_installation_id;
    const existingObservation = await client.query<{
      agent_installation_observation_id: string;
    }>(
      `
        SELECT agent_installation_observation_id
        FROM radius_platform.agent_installation_observations
        WHERE agent_installation_id = $1 AND client_event_id = $2
      `,
      [agentInstallationId, options.request.clientEventId],
    );
    const observationId =
      existingObservation.rows[0]?.agent_installation_observation_id ??
      randomUUID();
    if (existingObservation.rowCount === 0) {
      await client.query(
        `
          INSERT INTO radius_platform.agent_installation_observations (
            agent_installation_observation_id,
            agent_installation_id,
            agent_id,
            agent_deployment_id,
            client_event_id,
            schema_version,
            observation_state,
            error_code,
            observed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          observationId,
          agentInstallationId,
          row.agent_id,
          options.request.agentDeploymentId,
          options.request.clientEventId,
          options.request.schemaVersion,
          options.request.state,
          options.request.errorCode,
          options.request.observedAt,
        ],
      );
    }
    const access: OrganizationMutationAccess = {
      organizationId: row.organization_id,
      membershipId: row.membership_id,
      scopes: isPostgresIdentity(options.identity)
        ? options.identity.scopes
        : new Set(ROLE_SCOPES.viewer),
    };
    const response: ReportAgentInstallationResponse = {
      apiVersion: 1,
      agentInstallationId,
      observationId,
    };
    await completeIdempotency(client, {
      identity: options.identity,
      operation,
      key: options.idempotencyKey,
      requestDigest,
      responseStatus: 200,
      responseBody: response,
      resourceReference: observationId,
    });
    await insertAuditEvent(client, {
      identity: options.identity,
      access,
      eventKey: `${operation}:${options.idempotencyKey}`,
      action: operation,
      agentId: row.agent_id,
      agentDeploymentId: options.request.agentDeploymentId,
      clientInstallationId: options.clientInstallationId,
      agentInstallationId,
      metadata: { state: options.request.state },
    });
    return response;
  });
}

async function listInstallations(
  pool: PlatformPool,
  organization: string,
  access: OrganizationMutationAccess,
): Promise<ListInstallationsResponse> {
  const devices = await pool.query<{
    physical_device_id: string;
    display_name: string;
    asset_tag: string | null;
    platform: string;
    architecture: string;
    lifecycle_state: "active" | "suspended" | "retired" | "lost";
  }>(
    `
      SELECT physical_device_id, display_name, asset_tag, platform,
        architecture, lifecycle_state
      FROM radius_platform.physical_devices
      WHERE organization_id = $1
      ORDER BY display_name, physical_device_id
    `,
    [access.organizationId],
  );
  const clients = await pool.query<{
    client_installation_id: string;
    physical_device_id: string;
    client_instance_id: string;
    lifecycle_state: "active" | "suspended" | "removed";
    desktop_version: string | null;
    runtime_version: string | null;
    runtime_protocol_version: number | null;
    observation_state:
      "ready" | "degraded" | "update_required" | "error" | null;
    error_code: string | null;
    observed_at: Date | null;
  }>(
    `
      SELECT
        installation.client_installation_id,
        installation.physical_device_id,
        installation.client_instance_id,
        installation.lifecycle_state,
        observation.desktop_version,
        observation.runtime_version,
        observation.runtime_protocol_version,
        observation.observation_state,
        observation.error_code,
        observation.observed_at
      FROM radius_platform.client_installations AS installation
      LEFT JOIN LATERAL (
        SELECT candidate.*
        FROM radius_platform.client_installation_observations AS candidate
        WHERE candidate.client_installation_id = installation.client_installation_id
        ORDER BY candidate.observed_at DESC,
          candidate.client_installation_observation_id DESC
        LIMIT 1
      ) AS observation ON TRUE
      WHERE installation.organization_id = $1
      ORDER BY installation.installed_at, installation.client_installation_id
    `,
    [access.organizationId],
  );
  const agents = await pool.query<{
    agent_installation_id: string;
    client_installation_id: string;
    agent_ref: string;
    lifecycle_state: "active" | "removed";
    agent_deployment_id: string | null;
    agent_deployment_version: string | null;
    observation_state:
      | "installing"
      | "ready"
      | "failed"
      | "retained"
      | "removed"
      | "blocked_incompatible"
      | null;
    error_code: string | null;
    observed_at: Date | null;
  }>(
    `
      SELECT
        installation.agent_installation_id,
        installation.client_installation_id,
        agent.agent_ref,
        installation.lifecycle_state,
        observation.agent_deployment_id,
        deployment.version AS agent_deployment_version,
        observation.observation_state,
        observation.error_code,
        observation.observed_at
      FROM radius_platform.agent_installations AS installation
      JOIN radius_platform.agents AS agent ON agent.agent_id = installation.agent_id
      LEFT JOIN LATERAL (
        SELECT candidate.*
        FROM radius_platform.agent_installation_observations AS candidate
        WHERE candidate.agent_installation_id = installation.agent_installation_id
        ORDER BY candidate.observed_at DESC,
          candidate.agent_installation_observation_id DESC
        LIMIT 1
      ) AS observation ON TRUE
      LEFT JOIN radius_platform.agent_deployments AS deployment
        ON deployment.agent_deployment_id = observation.agent_deployment_id
      WHERE installation.organization_id = $1
      ORDER BY installation.installed_at, installation.agent_installation_id
    `,
    [access.organizationId],
  );

  return {
    apiVersion: 1,
    organization,
    physicalDevices: devices.rows.map((device) => ({
      id: device.physical_device_id,
      displayName: device.display_name,
      assetTag: device.asset_tag,
      platform: device.platform,
      architecture: device.architecture,
      lifecycleState: device.lifecycle_state,
      clientInstallations: clients.rows
        .filter(
          (installation) =>
            installation.physical_device_id === device.physical_device_id,
        )
        .map((installation) => ({
          id: installation.client_installation_id,
          clientInstanceId: installation.client_instance_id,
          lifecycleState: installation.lifecycle_state,
          latestObservation:
            installation.desktop_version &&
            installation.runtime_version &&
            installation.runtime_protocol_version &&
            installation.observation_state &&
            installation.observed_at
              ? {
                  desktopVersion: installation.desktop_version,
                  runtimeVersion: installation.runtime_version,
                  runtimeProtocolVersion: installation.runtime_protocol_version,
                  state: installation.observation_state,
                  errorCode: installation.error_code,
                  observedAt: installation.observed_at.toISOString(),
                }
              : null,
          agentInstallations: agents.rows
            .filter(
              (agent) =>
                agent.client_installation_id ===
                installation.client_installation_id,
            )
            .map((agent) => ({
              id: agent.agent_installation_id,
              agent: agent.agent_ref,
              lifecycleState: agent.lifecycle_state,
              latestObservation:
                agent.agent_deployment_id &&
                agent.agent_deployment_version &&
                agent.observation_state &&
                agent.observed_at
                  ? {
                      agentDeploymentId: agent.agent_deployment_id,
                      agentDeploymentVersion: agent.agent_deployment_version,
                      state: agent.observation_state,
                      errorCode: agent.error_code,
                      observedAt: agent.observed_at.toISOString(),
                    }
                  : null,
            })),
        })),
    })),
  };
}

async function appendAgentEnvironmentRevision(
  client: PlatformPoolClient,
  options: {
    identity: DatabaseMutationIdentity;
    access: OrganizationMutationAccess;
    agentId: string;
    environmentId: string;
    agentDeploymentId: string;
    action: "deploy" | "promote" | "rollback";
    expectedRevision: number | null;
  },
): Promise<{
  environmentRevisionId: string;
  environment: string;
  revision: number;
  previousAgentDeploymentId: string | null;
}> {
  const environment = await client.query<{
    slug: string;
    agent_id: string;
  }>(
    `
      SELECT slug, agent_id
      FROM radius_platform.agent_environments
      WHERE environment_id = $1
      FOR UPDATE
    `,
    [options.environmentId],
  );
  const environmentRow = environment.rows[0];
  if (!environmentRow || environmentRow.agent_id !== options.agentId) {
    throw new PlatformApiError(
      404,
      "ENVIRONMENT_NOT_FOUND",
      "Environment not found",
    );
  }
  const current = await client.query<{
    revision: string;
    agent_deployment_id: string | null;
  }>(
    `
      SELECT revision, agent_deployment_id
      FROM radius_platform.agent_environment_revisions
      WHERE environment_id = $1
      ORDER BY revision DESC
      LIMIT 1
    `,
    [options.environmentId],
  );
  const currentRevision = Number(current.rows[0]?.revision ?? 0);
  const previousAgentDeploymentId =
    current.rows[0]?.agent_deployment_id ?? null;
  if (currentRevision > 0 && options.expectedRevision !== currentRevision) {
    throw new PlatformApiError(
      409,
      options.expectedRevision === null
        ? "DEPLOYMENT_REVISION_REQUIRED"
        : "DEPLOYMENT_REVISION_CONFLICT",
      "Environment revision changed before the requested operation",
    );
  }
  if (currentRevision === 0 && options.expectedRevision !== null) {
    throw new PlatformApiError(
      409,
      "DEPLOYMENT_REVISION_CONFLICT",
      "Deployment does not exist at the expected revision",
    );
  }
  if (previousAgentDeploymentId === options.agentDeploymentId) {
    throw new PlatformApiError(
      409,
      "AGENT_DEPLOYMENT_ALREADY_DEPLOYED",
      "Agent deployment is already selected for this environment",
    );
  }
  if (options.action === "rollback") {
    const prior = await client.query(
      `
        SELECT 1
        FROM radius_platform.agent_environment_revisions
        WHERE environment_id = $1 AND agent_deployment_id = $2
        LIMIT 1
      `,
      [options.environmentId, options.agentDeploymentId],
    );
    if (prior.rowCount === 0) {
      throw new PlatformApiError(
        409,
        "ROLLBACK_TARGET_NOT_DEPLOYED",
        "Rollback target was not previously deployed to this environment",
      );
    }
  }
  const revision = currentRevision + 1;
  const environmentRevisionId = randomUUID();
  await client.query(
    `
      INSERT INTO radius_platform.agent_environment_revisions (
        agent_environment_revision_id,
        environment_id,
        revision,
        action_code,
        agent_deployment_id,
        actor_membership_id,
        actor_developer_token_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      environmentRevisionId,
      options.environmentId,
      revision,
      options.action,
      options.agentDeploymentId,
      isBrowserSessionIdentity(options.identity)
        ? options.access.membershipId
        : null,
      isPostgresIdentity(options.identity)
        ? options.identity.developerTokenId
        : null,
    ],
  );
  return {
    environmentRevisionId,
    environment: environmentRow.slug,
    revision,
    previousAgentDeploymentId,
  };
}

async function ensureAgent(
  client: PlatformPoolClient,
  _identity: DatabaseMutationIdentity,
  access: OrganizationMutationAccess,
  request: PrepareAgentDeploymentRequest,
): Promise<{ agentId: string }> {
  const existing = await client.query<{
    agent_id: string;
    organization_id: string;
  }>(
    `SELECT agent_id, organization_id
     FROM radius_platform.agents WHERE agent_ref = $1`,
    [request.agent],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].organization_id !== access.organizationId) {
      throw new PlatformApiError(404, "AGENT_NOT_FOUND", "Agent not found");
    }
    await client.query(
      `UPDATE radius_platform.agents SET display_name = $2
       WHERE agent_id = $1`,
      [existing.rows[0].agent_id, request.manifest.name],
    );
    return { agentId: existing.rows[0].agent_id };
  }
  const agentId = randomUUID();
  const slug = agentSlug(request.agent);
  await client.query(
    `
      INSERT INTO radius_platform.agents (
        agent_id,
        organization_id,
        agent_ref,
        slug,
        display_name
      ) VALUES ($1, $2, $3, $4, $5)
    `,
    [
      agentId,
      access.organizationId,
      request.agent,
      slug,
      request.manifest.name,
    ],
  );
  let defaultEnvironmentId: string | null = null;
  for (const environment of new Set([
    ...STANDARD_ENVIRONMENTS,
    request.environment,
  ])) {
    const environmentId = await ensureEnvironment(client, agentId, environment);
    if (environment === "development") defaultEnvironmentId = environmentId;
  }
  await client.query(
    `UPDATE radius_platform.agents SET default_environment_id = $2
     WHERE agent_id = $1`,
    [agentId, defaultEnvironmentId],
  );
  return { agentId };
}

async function ensureEnvironment(
  client: PlatformPoolClient,
  agentId: string,
  slug: string,
): Promise<string> {
  const existing = await client.query<{ environment_id: string }>(
    `SELECT environment_id FROM radius_platform.agent_environments
     WHERE agent_id = $1 AND slug = $2`,
    [agentId, slug],
  );
  if (existing.rows[0]) return existing.rows[0].environment_id;
  const environmentId = randomUUID();
  await client.query(
    `
      INSERT INTO radius_platform.agent_environments (
        environment_id, agent_id, slug, display_name
      ) VALUES ($1, $2, $3, $4)
    `,
    [environmentId, agentId, slug, titleCase(slug)],
  );
  return environmentId;
}

async function requireOrganizationReadAccess(
  database: Pick<PlatformPool, "query"> | PlatformPoolClient,
  identity: DatabaseReadIdentity,
  organization: string,
): Promise<string> {
  if (isPostgresIdentity(identity)) {
    const available = identity.response.organizations.some(
      (candidate) => candidate.slug === organization,
    );
    if (!available) {
      throw new PlatformApiError(
        404,
        "ORGANIZATION_NOT_FOUND",
        "Organization not found",
      );
    }
    return identity.organizationId;
  }
  const result = await database.query<{ organization_id: string }>(
    `
      SELECT organization.organization_id
      FROM radius_platform.organization_memberships AS membership
      JOIN radius_platform.organizations AS organization
        ON organization.organization_id = membership.organization_id
      WHERE membership.account_id = $1
        AND membership.lifecycle_state = 'active'
        AND organization.slug = $2
        AND organization.lifecycle_state = 'active'
    `,
    [identity.accountId, organization],
  );
  if (!result.rows[0]) {
    throw new PlatformApiError(
      404,
      "ORGANIZATION_NOT_FOUND",
      "Organization not found",
    );
  }
  return result.rows[0].organization_id;
}

async function requireOrganizationMutationAccess(
  database: Pick<PlatformPool, "query"> | PlatformPoolClient,
  identity: DatabaseMutationIdentity,
  organization: string,
  scope: DeveloperTokenScope,
): Promise<OrganizationMutationAccess> {
  if (isPostgresIdentity(identity)) {
    if (
      !identity.response.organizations.some(
        (candidate) => candidate.slug === organization,
      )
    ) {
      throw new PlatformApiError(
        404,
        "ORGANIZATION_NOT_FOUND",
        "Organization not found",
      );
    }
    if (!identity.scopes.has(scope)) {
      throw new PlatformApiError(
        403,
        "FORBIDDEN",
        `Developer token lacks ${scope}`,
      );
    }
    return developerTokenAccess(identity);
  }
  const result = await database.query<{
    organization_id: string;
    membership_id: string;
    role_code: "owner" | "admin" | "developer" | "viewer";
  }>(
    `
      SELECT organization.organization_id, membership.membership_id,
        membership.role_code
      FROM radius_platform.organization_memberships AS membership
      JOIN radius_platform.organizations AS organization
        ON organization.organization_id = membership.organization_id
      WHERE membership.account_id = $1
        AND membership.lifecycle_state = 'active'
        AND organization.slug = $2
        AND organization.lifecycle_state = 'active'
    `,
    [identity.accountId, organization],
  );
  const row = result.rows[0];
  if (!row) {
    throw new PlatformApiError(
      404,
      "ORGANIZATION_NOT_FOUND",
      "Organization not found",
    );
  }
  const scopes = new Set(ROLE_SCOPES[row.role_code]);
  if (!scopes.has(scope)) {
    throw new PlatformApiError(
      403,
      "FORBIDDEN",
      `${row.role_code} membership lacks ${scope}`,
    );
  }
  return {
    organizationId: row.organization_id,
    membershipId: row.membership_id,
    scopes,
  };
}

async function requireAgentAccess(
  database: Pick<PlatformPool, "query"> | PlatformPoolClient,
  identity: DatabaseReadIdentity,
  agent: string,
): Promise<string> {
  const result = isPostgresIdentity(identity)
    ? await database.query<{ agent_id: string }>(
        `
          SELECT agent_id
          FROM radius_platform.agents
          WHERE agent_ref = $1
            AND organization_id = $2
            AND lifecycle_state = 'active'
        `,
        [agent, identity.organizationId],
      )
    : await database.query<{ agent_id: string }>(
        `
          SELECT agent.agent_id
          FROM radius_platform.agents AS agent
          JOIN radius_platform.organization_memberships AS membership
            ON membership.organization_id = agent.organization_id
          JOIN radius_platform.organizations AS organization
            ON organization.organization_id = membership.organization_id
          WHERE agent.agent_ref = $1
            AND agent.lifecycle_state = 'active'
            AND membership.account_id = $2
            AND membership.lifecycle_state = 'active'
            AND organization.lifecycle_state = 'active'
        `,
        [agent, identity.accountId],
      );
  if (!result.rows[0]) {
    throw new PlatformApiError(404, "AGENT_NOT_FOUND", "Agent not found");
  }
  return result.rows[0].agent_id;
}

async function requireEnvironmentAccess(
  database: Pick<PlatformPool, "query"> | PlatformPoolClient,
  identity: DatabaseReadIdentity,
  agent: string,
  environment: string,
): Promise<{ agentId: string; environmentId: string }> {
  const result = isPostgresIdentity(identity)
    ? await database.query<{
        agent_id: string;
        environment_id: string;
      }>(
        `
          SELECT agent.agent_id, environment.environment_id
          FROM radius_platform.agents AS agent
          JOIN radius_platform.agent_environments AS environment
            ON environment.agent_id = agent.agent_id
          WHERE agent.agent_ref = $1
            AND agent.organization_id = $2
            AND agent.lifecycle_state = 'active'
            AND environment.slug = $3
            AND environment.lifecycle_state = 'active'
        `,
        [agent, identity.organizationId, environment],
      )
    : await database.query<{
        agent_id: string;
        environment_id: string;
      }>(
        `
          SELECT agent.agent_id, environment.environment_id
          FROM radius_platform.agents AS agent
          JOIN radius_platform.agent_environments AS environment
            ON environment.agent_id = agent.agent_id
          JOIN radius_platform.organization_memberships AS membership
            ON membership.organization_id = agent.organization_id
          JOIN radius_platform.organizations AS organization
            ON organization.organization_id = membership.organization_id
          WHERE agent.agent_ref = $1
            AND agent.lifecycle_state = 'active'
            AND environment.slug = $2
            AND environment.lifecycle_state = 'active'
            AND membership.account_id = $3
            AND membership.lifecycle_state = 'active'
            AND organization.lifecycle_state = 'active'
        `,
        [agent, environment, identity.accountId],
      );
  if (!result.rows[0]) {
    throw new PlatformApiError(
      404,
      "ENVIRONMENT_NOT_FOUND",
      "Environment not found",
    );
  }
  return {
    agentId: result.rows[0].agent_id,
    environmentId: result.rows[0].environment_id,
  };
}

async function requireEnvironmentMutationAccess(
  database: Pick<PlatformPool, "query"> | PlatformPoolClient,
  identity: DatabaseMutationIdentity,
  agent: string,
  environment: string,
  scope: DeveloperTokenScope,
): Promise<{
  agentId: string;
  environmentId: string;
  access: OrganizationMutationAccess;
}> {
  const result = await database.query<{
    agent_id: string;
    environment_id: string;
    organization_id: string;
    membership_id: string | null;
    role_code: "owner" | "admin" | "developer" | "viewer" | null;
  }>(
    isPostgresIdentity(identity)
      ? `
          SELECT agent.agent_id, environment.environment_id,
            agent.organization_id, NULL::uuid AS membership_id,
            NULL::text AS role_code
          FROM radius_platform.agents AS agent
          JOIN radius_platform.agent_environments AS environment
            ON environment.agent_id = agent.agent_id
          WHERE agent.agent_ref = $1
            AND environment.slug = $2
            AND agent.organization_id = $3
            AND agent.lifecycle_state = 'active'
            AND environment.lifecycle_state = 'active'
        `
      : `
          SELECT agent.agent_id, environment.environment_id,
            agent.organization_id, membership.membership_id,
            membership.role_code
          FROM radius_platform.agents AS agent
          JOIN radius_platform.agent_environments AS environment
            ON environment.agent_id = agent.agent_id
          JOIN radius_platform.organization_memberships AS membership
            ON membership.organization_id = agent.organization_id
          JOIN radius_platform.organizations AS organization
            ON organization.organization_id = membership.organization_id
          WHERE agent.agent_ref = $1
            AND environment.slug = $2
            AND membership.account_id = $3
            AND agent.lifecycle_state = 'active'
            AND environment.lifecycle_state = 'active'
            AND membership.lifecycle_state = 'active'
            AND organization.lifecycle_state = 'active'
        `,
    [
      agent,
      environment,
      isPostgresIdentity(identity)
        ? identity.organizationId
        : identity.accountId,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new PlatformApiError(
      404,
      "ENVIRONMENT_NOT_FOUND",
      "Environment not found",
    );
  }
  if (isPostgresIdentity(identity)) {
    if (!identity.scopes.has(scope)) {
      throw new PlatformApiError(
        403,
        "FORBIDDEN",
        `Developer token lacks ${scope}`,
      );
    }
    return {
      agentId: row.agent_id,
      environmentId: row.environment_id,
      access: developerTokenAccess(identity),
    };
  }
  const scopes = new Set(ROLE_SCOPES[row.role_code!]);
  if (!scopes.has(scope)) {
    throw new PlatformApiError(
      403,
      "FORBIDDEN",
      `${row.role_code} membership lacks ${scope}`,
    );
  }
  return {
    agentId: row.agent_id,
    environmentId: row.environment_id,
    access: {
      organizationId: row.organization_id,
      membershipId: row.membership_id!,
      scopes,
    },
  };
}

interface IdempotencyRow {
  responseBody: Record<string, unknown>;
  resourceReference: string | null;
}

async function lockIdempotency(
  client: PlatformPoolClient,
  identity: DatabaseMutationIdentity,
  operation: string,
  key: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${authoritySubject(identity)}:${operation}:${key}`,
  ]);
  await client.query(
    `
      DELETE FROM radius_platform.idempotency_records
      WHERE authority_fingerprint = $1
        AND operation_code = $2
        AND idempotency_key = $3
        AND expires_at <= clock_timestamp()
    `,
    [authorityFingerprint(identity), operation, key],
  );
}

async function getIdempotency(
  client: PlatformPoolClient,
  identity: DatabaseMutationIdentity,
  operation: string,
  key: string,
  requestDigest: string,
): Promise<IdempotencyRow | null> {
  const result = await client.query<{
    request_digest: string;
    record_state: "pending" | "completed";
    response_body: Record<string, unknown> | null;
    resource_reference: string | null;
  }>(
    `
      SELECT request_digest, record_state, response_body, resource_reference
      FROM radius_platform.idempotency_records
      WHERE authority_fingerprint = $1
        AND operation_code = $2
        AND idempotency_key = $3
        AND expires_at > clock_timestamp()
    `,
    [authorityFingerprint(identity), operation, key],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.request_digest !== requestDigest) {
    throw new PlatformApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was already used for different input",
    );
  }
  if (row.record_state !== "completed" || !row.response_body) {
    throw new PlatformApiError(
      409,
      "IDEMPOTENCY_IN_PROGRESS",
      "An operation with this idempotency key is still pending",
    );
  }
  return {
    responseBody: row.response_body,
    resourceReference: row.resource_reference,
  };
}

async function completeIdempotency(
  client: PlatformPoolClient,
  options: {
    identity: DatabaseMutationIdentity;
    operation: string;
    key: string;
    requestDigest: string;
    responseStatus: number;
    responseBody: Record<string, unknown>;
    resourceReference: string | null;
  },
): Promise<void> {
  await client.query(
    `
      INSERT INTO radius_platform.idempotency_records (
        idempotency_record_id,
        authority_fingerprint,
        operation_code,
        idempotency_key,
        request_digest,
        record_state,
        response_status,
        response_body,
        resource_reference,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, $8,
        clock_timestamp() + interval '24 hours')
    `,
    [
      randomUUID(),
      authorityFingerprint(options.identity),
      options.operation,
      options.key,
      options.requestDigest,
      options.responseStatus,
      JSON.stringify(options.responseBody),
      options.resourceReference,
    ],
  );
}

async function insertAuditEvent(
  client: PlatformPoolClient,
  options: {
    identity: DatabaseMutationIdentity;
    access?: OrganizationMutationAccess;
    eventKey: string;
    action: string;
    agentId?: string;
    agentDeploymentId?: string;
    environmentId?: string;
    environmentRevisionId?: string | null;
    physicalDeviceId?: string;
    clientInstallationId?: string;
    agentInstallationId?: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const access = options.access ?? developerTokenAccess(options.identity);
  await client.query(
    `
      INSERT INTO radius_platform.audit_events (
        audit_event_id,
        organization_id,
        event_key,
        actor_membership_id,
        actor_developer_token_id,
        action_code,
        outcome_code,
        agent_id,
        agent_deployment_id,
        environment_id,
        agent_environment_revision_id,
        physical_device_id,
        client_installation_id,
        agent_installation_id,
        safe_metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'success',
        $7, $8, $9, $10, $11, $12, $13, $14
      )
    `,
    [
      randomUUID(),
      access.organizationId,
      options.eventKey,
      isBrowserSessionIdentity(options.identity) ? access.membershipId : null,
      isPostgresIdentity(options.identity)
        ? options.identity.developerTokenId
        : null,
      options.action,
      options.agentId ?? null,
      options.agentDeploymentId ?? null,
      options.environmentId ?? null,
      options.environmentRevisionId ?? null,
      options.physicalDeviceId ?? null,
      options.clientInstallationId ?? null,
      options.agentInstallationId ?? null,
      JSON.stringify(options.metadata),
    ],
  );
}

function requireDatabaseReadIdentity(
  identity: PlatformRequestIdentity,
): DatabaseReadIdentity {
  if (isPostgresIdentity(identity) || isBrowserSessionIdentity(identity)) {
    return identity;
  }
  throw new PlatformApiError(
    401,
    "UNAUTHORIZED",
    "Database identity is required",
  );
}

function requireDatabaseMutationIdentity(
  identity: PlatformRequestIdentity,
): DatabaseMutationIdentity {
  if (isPostgresIdentity(identity) || isBrowserSessionIdentity(identity)) {
    return identity;
  }
  throw new PlatformApiError(
    401,
    "UNAUTHORIZED",
    "Database identity is required",
  );
}

function developerTokenAccess(
  identity: DatabaseMutationIdentity,
): OrganizationMutationAccess {
  if (!isPostgresIdentity(identity)) {
    throw new Error(
      "Browser-session mutation requires organization access context",
    );
  }
  return {
    organizationId: identity.organizationId,
    membershipId: identity.membershipId,
    scopes: identity.scopes,
  };
}

function isPostgresIdentity(
  identity: PlatformRequestIdentity,
): identity is PostgresIdentity {
  return (
    "membershipId" in identity &&
    "developerTokenId" in identity &&
    "organizationId" in identity &&
    "scopes" in identity
  );
}

function isBrowserSessionIdentity(
  identity: PlatformRequestIdentity,
): identity is BrowserSessionIdentity {
  return "browserSessionId" in identity;
}

function requireScope(
  identity: PostgresIdentity,
  scope: DeveloperTokenScope,
): void {
  if (!identity.scopes.has(scope)) {
    throw new PlatformApiError(
      403,
      "FORBIDDEN",
      `Developer token lacks ${scope}`,
    );
  }
}

function authorityFingerprint(identity: DatabaseMutationIdentity): Buffer {
  return sha256Buffer(authoritySubject(identity));
}

function authoritySubject(identity: DatabaseMutationIdentity): string {
  return isPostgresIdentity(identity)
    ? `developer_token:${identity.developerTokenId}`
    : `browser_session:${identity.browserSessionId}`;
}

function sha256Buffer(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function digestJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function encodeCursor(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        decoded,
      )
    ) {
      throw new Error("invalid");
    }
    return decoded;
  } catch {
    throw new PlatformApiError(400, "INVALID_CURSOR", "Cursor is invalid");
  }
}

function decodeRevisionCursor(cursor: string): number {
  const decoded = decodeCursorValue(cursor);
  const revision = Number(decoded);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new PlatformApiError(400, "INVALID_CURSOR", "Cursor is invalid");
  }
  return revision;
}

function decodeCursorValue(cursor: string): string {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!decoded || decoded.length > 128) throw new Error("invalid");
    return decoded;
  } catch {
    throw new PlatformApiError(400, "INVALID_CURSOR", "Cursor is invalid");
  }
}

function agentSlug(agent: string): string {
  const base = agent
    .slice(5)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const prefixed = /^[a-z]/.test(base) ? base : `agent-${base}`;
  return prefixed.slice(0, 63) || "agent";
}

function titleCase(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}
