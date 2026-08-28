import { randomUUID } from "node:crypto";

import {
  DEVELOPER_TOKEN_SCOPES,
  type DeveloperTokenScope,
} from "@curve-ai/platform-client";

import type { CliIo } from "./io.js";
import { resolveOrganizationTarget } from "./organization-target.js";
import { RadiusProfileStore } from "./profiles.js";

export { DEVELOPER_TOKEN_SCOPES };

interface TokenCommandBase {
  organization?: string;
  profile?: string;
  accessToken?: string;
  store?: RadiusProfileStore;
  io: CliIo;
}

export async function listDeveloperTokens(
  options: TokenCommandBase & { json?: boolean },
): Promise<void> {
  const { client, organization } = await resolveOrganizationTarget(options);
  const response = await client.listDeveloperTokens(organization);
  if (options.json) {
    options.io.out(JSON.stringify(response, null, 2));
    return;
  }
  options.io.out(`Organization: ${organization}`);
  if (response.tokens.length === 0) {
    options.io.out("No developer tokens");
    return;
  }
  for (const token of response.tokens) {
    const state = token.revokedAt
      ? "revoked"
      : token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()
        ? "expired"
        : "active";
    options.io.out(
      `${token.current ? "*" : " "} ${token.id}\t${state}\t${token.prefix}\t${token.label}`,
    );
    options.io.out(`  scopes: ${token.scopes.join(", ")}`);
  }
}

export async function createDeveloperToken(
  options: TokenCommandBase & {
    label: string;
    scopes: readonly string[];
    expiresAt?: string;
  },
): Promise<void> {
  const scopes = parseScopes(options.scopes);
  const expiresAt = parseExpiry(options.expiresAt);
  const { client, organization } = await resolveOrganizationTarget(options);
  const response = await client.createDeveloperToken(
    organization,
    {
      apiVersion: 1,
      label: options.label,
      scopes,
      expiresAt,
    },
    `token.create.${randomUUID()}`,
  );
  options.io.out(`Created developer token ${response.token.id}`);
  options.io.out(`Prefix: ${response.token.prefix}`);
  options.io.out(`Scopes: ${response.token.scopes.join(", ")}`);
  options.io.out("");
  options.io.out("Developer token (shown once):");
  options.io.out(response.secret);
}

export async function revokeDeveloperToken(
  options: TokenCommandBase & { developerTokenId: string },
): Promise<void> {
  const { client, organization } = await resolveOrganizationTarget(options);
  const response = await client.revokeDeveloperToken(
    organization,
    options.developerTokenId,
    `token.revoke.${randomUUID()}`,
  );
  options.io.out(`Revoked developer token ${response.token.id}`);
  options.io.out(`Prefix: ${response.token.prefix}`);
}

function parseScopes(scopes: readonly string[]): DeveloperTokenScope[] {
  if (scopes.length === 0) {
    throw new Error("At least one --scope is required");
  }
  const unique = [...new Set(scopes)];
  for (const scope of unique) {
    if (!DEVELOPER_TOKEN_SCOPES.includes(scope as DeveloperTokenScope)) {
      throw new Error(
        `Unknown developer-token scope ${scope}; expected one of ${DEVELOPER_TOKEN_SCOPES.join(", ")}`,
      );
    }
  }
  return unique as DeveloperTokenScope[];
}

function parseExpiry(value: string | undefined): string | null {
  if (!value) return null;
  const expiry = new Date(value);
  if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) {
    throw new Error("--expires-at must be a future ISO-8601 timestamp");
  }
  return expiry.toISOString();
}
