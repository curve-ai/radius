import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { RadiusDatabase } from "./database.js";
import {
  agentAuthenticationBindings,
  agentIdentities,
  agentInstallations,
  agentReleaseAuthRequirementCustodyKinds,
  agentReleaseAuthRequirementScopes,
  agentReleaseAuthRequirements,
  agentReleases,
  authenticationAccountGrantedScopes,
  authenticationAccountObservations,
  authenticationAccounts,
  authenticationAuthorities,
  authenticationAuthorityFlows,
  clientInstances,
} from "./schema.js";

export type AuthenticationPurpose =
  "vendor_identity" | "model_provider" | "router";
export type AuthenticationFlowKind =
  | "oidc_pkce"
  | "oauth_pkce"
  | "device_authorization"
  | "api_key"
  | "vendor_token_exchange"
  | "provider_native_oauth";
export type CredentialCustodyKind =
  "os_vault" | "encrypted_agent_state" | "managed_exchange" | "none";
export type AuthenticationConnectionState =
  | "needs_authentication"
  | "connected"
  | "expired"
  | "revoked"
  | "disconnected"
  | "error";

export interface AgentAuthRequirementInput {
  key: string;
  authority: {
    key: string;
    purpose: AuthenticationPurpose;
    issuer: string | null;
    displayName: string;
  };
  flow: {
    key: string;
    kind: AuthenticationFlowKind;
    publicClientId: string | null;
    audience: string | null;
    deviceBindingSupported: boolean;
  };
  requirement: "required" | "optional";
  portability: "device_only" | "profile_binding";
  runtimeDelivery: "agent_state_adapter" | "short_lived_token" | "host_handle";
  custodyKinds: CredentialCustodyKind[];
  scopes: Array<{
    name: string;
    requirement: "required" | "optional";
  }>;
}

export interface InstallAgentReleaseInput {
  clientInstanceId: string;
  providerKey: string;
  agentKey: string;
  displayName: string;
  releaseVersion: string;
  imageDigest: string;
  manifestSha256: string;
  protocolKind: string;
  protocolVersion: number;
  authRequirements: AgentAuthRequirementInput[];
  now?: number;
}

export interface InstalledAgentRelease {
  agentId: string;
  releaseId: string;
  installationId: string;
}

export interface AgentAuthenticationRequirementSummary {
  requirementId: string;
  requirementKey: string;
  requirement: "required" | "optional";
  authorityKey: string;
  authorityLabel: string;
  flowKind: AuthenticationFlowKind;
  state: AuthenticationConnectionState;
  accountId: string | null;
  accountLabel: string | null;
  remoteSubject: string | null;
  expiresAt: string | null;
}

export interface AgentAuthenticationSummary {
  installationId: string;
  ready: boolean;
  requirements: AgentAuthenticationRequirementSummary[];
}

export interface ConnectAgentAuthenticationInput {
  installationId: string;
  requirementKey: string;
  custodyKind: CredentialCustodyKind;
  credentialRef: string | null;
  remoteSubject: string | null;
  tenantSubject?: string | null;
  accountLabel?: string | null;
  expiresAt?: string | null;
  grantedScopes?: string[];
  resultCode?: string;
  now?: number;
}

export interface DisconnectAgentAuthenticationResult {
  credentialRef: string | null;
  credentialUnused: boolean;
}

function assertSame<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected)
    throw new Error(`${label} changed for immutable release`);
}

function isoToMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error("Invalid authentication expiry");
  return parsed;
}

export async function installAgentRelease(
  database: RadiusDatabase,
  input: InstallAgentReleaseInput,
): Promise<InstalledAgentRelease> {
  const now = input.now ?? Date.now();
  return database.db.transaction(async (tx) => {
    const [client] = await tx
      .select({ id: clientInstances.id })
      .from(clientInstances)
      .where(
        and(
          eq(clientInstances.id, input.clientInstanceId),
          eq(clientInstances.isLocal, true),
        ),
      )
      .limit(1);
    if (!client)
      throw new Error("Agent installation requires the local client");

    let [agent] = await tx
      .select()
      .from(agentIdentities)
      .where(
        and(
          eq(agentIdentities.providerKey, input.providerKey),
          eq(agentIdentities.agentKey, input.agentKey),
        ),
      )
      .limit(1);
    if (!agent) {
      [agent] = await tx
        .insert(agentIdentities)
        .values({
          id: randomUUID(),
          providerKey: input.providerKey,
          agentKey: input.agentKey,
          displayName: input.displayName,
          createdAtMs: now,
          updatedAtMs: now,
        })
        .returning();
    } else if (agent.displayName !== input.displayName) {
      [agent] = await tx
        .update(agentIdentities)
        .set({ displayName: input.displayName, updatedAtMs: now })
        .where(eq(agentIdentities.id, agent.id))
        .returning();
    }
    if (!agent) throw new Error("Agent identity could not be recorded");

    let [release] = await tx
      .select()
      .from(agentReleases)
      .where(
        and(
          eq(agentReleases.agentId, agent.id),
          eq(agentReleases.releaseVersion, input.releaseVersion),
        ),
      )
      .limit(1);
    if (!release) {
      [release] = await tx
        .insert(agentReleases)
        .values({
          id: randomUUID(),
          agentId: agent.id,
          releaseVersion: input.releaseVersion,
          imageDigest: input.imageDigest,
          manifestSha256: input.manifestSha256,
          protocolKind: input.protocolKind,
          protocolVersion: input.protocolVersion,
          verifiedAtMs: now,
        })
        .returning();
    } else {
      assertSame(release.imageDigest, input.imageDigest, "Image digest");
      assertSame(
        release.manifestSha256,
        input.manifestSha256,
        "Manifest digest",
      );
      assertSame(release.protocolKind, input.protocolKind, "Protocol kind");
      assertSame(
        release.protocolVersion,
        input.protocolVersion,
        "Protocol version",
      );
    }
    if (!release) throw new Error("Agent release could not be recorded");

    const existingRequirements = await tx
      .select()
      .from(agentReleaseAuthRequirements)
      .where(eq(agentReleaseAuthRequirements.releaseId, release.id));
    if (
      existingRequirements.length > 0 &&
      existingRequirements.length !== input.authRequirements.length
    ) {
      throw new Error(
        "Authentication requirements changed for immutable release",
      );
    }

    for (const [
      position,
      requirementInput,
    ] of input.authRequirements.entries()) {
      let [authority] = await tx
        .select()
        .from(authenticationAuthorities)
        .where(
          eq(
            authenticationAuthorities.authorityKey,
            requirementInput.authority.key,
          ),
        )
        .limit(1);
      if (!authority) {
        [authority] = await tx
          .insert(authenticationAuthorities)
          .values({
            id: randomUUID(),
            authorityKey: requirementInput.authority.key,
            purpose: requirementInput.authority.purpose,
            canonicalIssuer: requirementInput.authority.issuer,
            displayName: requirementInput.authority.displayName,
          })
          .returning();
      } else {
        assertSame(
          authority.purpose,
          requirementInput.authority.purpose,
          "Authority purpose",
        );
        assertSame(
          authority.canonicalIssuer,
          requirementInput.authority.issuer,
          "Authority issuer",
        );
      }
      if (!authority)
        throw new Error("Authentication authority could not be recorded");

      let [flow] = await tx
        .select()
        .from(authenticationAuthorityFlows)
        .where(
          and(
            eq(authenticationAuthorityFlows.authorityId, authority.id),
            eq(authenticationAuthorityFlows.flowKey, requirementInput.flow.key),
          ),
        )
        .limit(1);
      if (!flow) {
        [flow] = await tx
          .insert(authenticationAuthorityFlows)
          .values({
            id: randomUUID(),
            authorityId: authority.id,
            flowKey: requirementInput.flow.key,
            flowKind: requirementInput.flow.kind,
            publicClientId: requirementInput.flow.publicClientId,
            tokenAudience: requirementInput.flow.audience,
            deviceBindingSupported:
              requirementInput.flow.deviceBindingSupported,
          })
          .returning();
      } else {
        assertSame(
          flow.flowKind,
          requirementInput.flow.kind,
          "Authentication flow kind",
        );
        assertSame(
          flow.publicClientId,
          requirementInput.flow.publicClientId,
          "OAuth client ID",
        );
        assertSame(
          flow.tokenAudience,
          requirementInput.flow.audience,
          "Token audience",
        );
      }
      if (!flow) throw new Error("Authentication flow could not be recorded");

      let requirement = existingRequirements.find(
        (candidate) => candidate.requirementKey === requirementInput.key,
      );
      if (!requirement) {
        [requirement] = await tx
          .insert(agentReleaseAuthRequirements)
          .values({
            id: randomUUID(),
            releaseId: release.id,
            requirementKey: requirementInput.key,
            authorityFlowId: flow.id,
            requirement: requirementInput.requirement,
            portability: requirementInput.portability,
            runtimeDelivery: requirementInput.runtimeDelivery,
            manifestPosition: position,
          })
          .returning();
        if (!requirement)
          throw new Error("Authentication requirement could not be recorded");
        if (requirementInput.scopes.length > 0) {
          await tx.insert(agentReleaseAuthRequirementScopes).values(
            requirementInput.scopes.map((scope) => ({
              requirementId: requirement!.id,
              scope: scope.name,
              requirement: scope.requirement,
            })),
          );
        }
        await tx.insert(agentReleaseAuthRequirementCustodyKinds).values(
          requirementInput.custodyKinds.map((custodyKind) => ({
            requirementId: requirement!.id,
            custodyKind,
          })),
        );
      } else {
        assertSame(
          requirement.authorityFlowId,
          flow.id,
          "Authentication authority flow",
        );
        assertSame(
          requirement.requirement,
          requirementInput.requirement,
          "Authentication requirement",
        );
        assertSame(
          requirement.portability,
          requirementInput.portability,
          "Authentication portability",
        );
        assertSame(
          requirement.runtimeDelivery,
          requirementInput.runtimeDelivery,
          "Runtime credential delivery",
        );
        assertSame(
          requirement.manifestPosition,
          position,
          "Authentication manifest position",
        );
      }
    }

    let [installation] = await tx
      .select()
      .from(agentInstallations)
      .where(
        and(
          eq(agentInstallations.clientInstanceId, input.clientInstanceId),
          eq(agentInstallations.agentId, agent.id),
        ),
      )
      .limit(1);
    if (!installation) {
      [installation] = await tx
        .insert(agentInstallations)
        .values({
          id: randomUUID(),
          clientInstanceId: input.clientInstanceId,
          agentId: agent.id,
          selectedReleaseId: release.id,
          lifecycleState: "ready",
          installedAtMs: now,
          updatedAtMs: now,
        })
        .returning();
    } else {
      [installation] = await tx
        .update(agentInstallations)
        .set({
          selectedReleaseId: release.id,
          lifecycleState: "ready",
          updatedAtMs: now,
        })
        .where(eq(agentInstallations.id, installation.id))
        .returning();
    }
    if (!installation)
      throw new Error("Agent installation could not be recorded");
    return {
      agentId: agent.id,
      releaseId: release.id,
      installationId: installation.id,
    };
  });
}

export async function getAgentAuthenticationSummary(
  database: RadiusDatabase,
  installationId: string,
): Promise<AgentAuthenticationSummary> {
  const [installation] = await database.db
    .select()
    .from(agentInstallations)
    .where(eq(agentInstallations.id, installationId))
    .limit(1);
  if (!installation) throw new Error("Agent installation does not exist");

  const rows = await database.db
    .select({
      requirementId: agentReleaseAuthRequirements.id,
      requirementKey: agentReleaseAuthRequirements.requirementKey,
      requirement: agentReleaseAuthRequirements.requirement,
      authorityKey: authenticationAuthorities.authorityKey,
      authorityLabel: authenticationAuthorities.displayName,
      flowKind: authenticationAuthorityFlows.flowKind,
      accountId: authenticationAccounts.id,
      accountState: authenticationAccounts.connectionState,
      accountLabel: authenticationAccounts.accountLabel,
      remoteSubject: authenticationAccounts.remoteSubject,
      expiresAtMs: authenticationAccounts.expiresAtMs,
    })
    .from(agentReleaseAuthRequirements)
    .innerJoin(
      authenticationAuthorityFlows,
      eq(
        authenticationAuthorityFlows.id,
        agentReleaseAuthRequirements.authorityFlowId,
      ),
    )
    .innerJoin(
      authenticationAuthorities,
      eq(
        authenticationAuthorities.id,
        authenticationAuthorityFlows.authorityId,
      ),
    )
    .leftJoin(
      agentAuthenticationBindings,
      and(
        eq(agentAuthenticationBindings.installationId, installation.id),
        eq(
          agentAuthenticationBindings.requirementId,
          agentReleaseAuthRequirements.id,
        ),
        isNull(agentAuthenticationBindings.unboundAtMs),
      ),
    )
    .leftJoin(
      authenticationAccounts,
      eq(authenticationAccounts.id, agentAuthenticationBindings.accountId),
    )
    .where(
      eq(
        agentReleaseAuthRequirements.releaseId,
        installation.selectedReleaseId,
      ),
    );

  const requirements = rows.map<AgentAuthenticationRequirementSummary>(
    (row) => {
      const state = row.accountState ?? "needs_authentication";
      return {
        requirementId: row.requirementId,
        requirementKey: row.requirementKey,
        requirement: row.requirement,
        authorityKey: row.authorityKey,
        authorityLabel: row.authorityLabel,
        flowKind: row.flowKind,
        state,
        accountId: row.accountId,
        accountLabel: row.accountLabel,
        remoteSubject: row.remoteSubject,
        expiresAt:
          row.expiresAtMs === null
            ? null
            : new Date(row.expiresAtMs).toISOString(),
      };
    },
  );
  return {
    installationId,
    ready: requirements.every(
      (requirement) =>
        requirement.requirement === "optional" ||
        requirement.state === "connected",
    ),
    requirements,
  };
}

export async function connectAgentAuthenticationAccount(
  database: RadiusDatabase,
  input: ConnectAgentAuthenticationInput,
): Promise<AgentAuthenticationSummary> {
  const now = input.now ?? Date.now();
  await database.db.transaction(async (tx) => {
    const [installation] = await tx
      .select()
      .from(agentInstallations)
      .where(eq(agentInstallations.id, input.installationId))
      .limit(1);
    if (!installation) throw new Error("Agent installation does not exist");
    const [requirement] = await tx
      .select()
      .from(agentReleaseAuthRequirements)
      .where(
        and(
          eq(
            agentReleaseAuthRequirements.releaseId,
            installation.selectedReleaseId,
          ),
          eq(agentReleaseAuthRequirements.requirementKey, input.requirementKey),
        ),
      )
      .limit(1);
    if (!requirement)
      throw new Error("Agent authentication requirement does not exist");
    const [custody] = await tx
      .select()
      .from(agentReleaseAuthRequirementCustodyKinds)
      .where(
        and(
          eq(
            agentReleaseAuthRequirementCustodyKinds.requirementId,
            requirement.id,
          ),
          eq(
            agentReleaseAuthRequirementCustodyKinds.custodyKind,
            input.custodyKind,
          ),
        ),
      )
      .limit(1);
    if (!custody)
      throw new Error("Credential custody is not permitted by this release");

    let account = input.remoteSubject
      ? (
          await tx
            .select()
            .from(authenticationAccounts)
            .where(
              and(
                eq(
                  authenticationAccounts.clientInstanceId,
                  installation.clientInstanceId,
                ),
                eq(
                  authenticationAccounts.authorityFlowId,
                  requirement.authorityFlowId,
                ),
                eq(authenticationAccounts.remoteSubject, input.remoteSubject),
              ),
            )
            .limit(1)
        )[0]
      : undefined;
    if (!account) {
      [account] = await tx
        .insert(authenticationAccounts)
        .values({
          id: randomUUID(),
          clientInstanceId: installation.clientInstanceId,
          authorityFlowId: requirement.authorityFlowId,
          custodyKind: input.custodyKind,
          connectionState: "connected",
          credentialRef: input.credentialRef,
          remoteSubject: input.remoteSubject,
          tenantSubject: input.tenantSubject ?? null,
          accountLabel: input.accountLabel ?? null,
          expiresAtMs: isoToMs(input.expiresAt),
          connectedAtMs: now,
          updatedAtMs: now,
        })
        .returning();
    } else {
      [account] = await tx
        .update(authenticationAccounts)
        .set({
          custodyKind: input.custodyKind,
          connectionState: "connected",
          credentialRef: input.credentialRef,
          tenantSubject: input.tenantSubject ?? null,
          accountLabel: input.accountLabel ?? null,
          expiresAtMs: isoToMs(input.expiresAt),
          connectedAtMs: account.connectedAtMs ?? now,
          disconnectedAtMs: null,
          revokedAtMs: null,
          updatedAtMs: now,
        })
        .where(eq(authenticationAccounts.id, account.id))
        .returning();
    }
    if (!account)
      throw new Error("Authentication account could not be recorded");

    await tx
      .delete(authenticationAccountGrantedScopes)
      .where(eq(authenticationAccountGrantedScopes.accountId, account.id));
    const scopes = [...new Set(input.grantedScopes ?? [])];
    if (scopes.length > 0) {
      await tx
        .insert(authenticationAccountGrantedScopes)
        .values(
          scopes.map((scope) => ({
            accountId: account!.id,
            scope,
            observedAtMs: now,
          })),
        );
    }
    await tx
      .update(agentAuthenticationBindings)
      .set({ unboundAtMs: now, unboundReason: "replaced" })
      .where(
        and(
          eq(agentAuthenticationBindings.installationId, installation.id),
          eq(agentAuthenticationBindings.requirementId, requirement.id),
          isNull(agentAuthenticationBindings.unboundAtMs),
        ),
      );
    await tx.insert(agentAuthenticationBindings).values({
      id: randomUUID(),
      clientInstanceId: installation.clientInstanceId,
      installationId: installation.id,
      releaseId: installation.selectedReleaseId,
      requirementId: requirement.id,
      accountId: account.id,
      boundAtMs: now,
    });
    await tx.insert(authenticationAccountObservations).values({
      id: randomUUID(),
      accountId: account.id,
      eventKind: "connected",
      resultCode: input.resultCode ?? "AUTH_CONNECTED",
      observedAtMs: now,
    });
  });
  return getAgentAuthenticationSummary(database, input.installationId);
}

export async function disconnectAgentAuthentication(
  database: RadiusDatabase,
  installationId: string,
  requirementKey: string,
  now = Date.now(),
): Promise<DisconnectAgentAuthenticationResult> {
  return database.db.transaction(async (tx) => {
    const [binding] = await tx
      .select({
        id: agentAuthenticationBindings.id,
        accountId: agentAuthenticationBindings.accountId,
        credentialRef: authenticationAccounts.credentialRef,
      })
      .from(agentAuthenticationBindings)
      .innerJoin(
        agentReleaseAuthRequirements,
        eq(
          agentReleaseAuthRequirements.id,
          agentAuthenticationBindings.requirementId,
        ),
      )
      .innerJoin(
        authenticationAccounts,
        eq(authenticationAccounts.id, agentAuthenticationBindings.accountId),
      )
      .where(
        and(
          eq(agentAuthenticationBindings.installationId, installationId),
          eq(agentReleaseAuthRequirements.requirementKey, requirementKey),
          isNull(agentAuthenticationBindings.unboundAtMs),
        ),
      )
      .limit(1);
    if (!binding) return { credentialRef: null, credentialUnused: false };

    await tx
      .update(agentAuthenticationBindings)
      .set({ unboundAtMs: now, unboundReason: "local_disconnect" })
      .where(eq(agentAuthenticationBindings.id, binding.id));
    const remaining = await tx
      .select({ id: agentAuthenticationBindings.id })
      .from(agentAuthenticationBindings)
      .where(
        and(
          eq(agentAuthenticationBindings.accountId, binding.accountId),
          isNull(agentAuthenticationBindings.unboundAtMs),
        ),
      )
      .limit(1);
    const credentialUnused = remaining.length === 0;
    if (credentialUnused) {
      await tx
        .update(authenticationAccounts)
        .set({
          connectionState: "disconnected",
          credentialRef: null,
          disconnectedAtMs: now,
          updatedAtMs: now,
        })
        .where(eq(authenticationAccounts.id, binding.accountId));
      await tx.insert(authenticationAccountObservations).values({
        id: randomUUID(),
        accountId: binding.accountId,
        eventKind: "disconnected",
        resultCode: "AUTH_LOCAL_DISCONNECT",
        observedAtMs: now,
      });
    }
    return { credentialRef: binding.credentialRef, credentialUnused };
  });
}
