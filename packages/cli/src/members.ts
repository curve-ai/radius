import { randomUUID } from "node:crypto";

import type {
  OrganizationMembershipLifecycle,
  PlatformOrganizationRole,
} from "@curve-ai/platform-client";
import { PLATFORM_ORGANIZATION_ROLES } from "@curve-ai/platform-client";

import type { CliIo } from "./io.js";
import { resolveOrganizationTarget } from "./organization-target.js";
import { RadiusProfileStore } from "./profiles.js";

export const ORGANIZATION_MEMBER_ROLES = PLATFORM_ORGANIZATION_ROLES;

interface MemberCommandBase {
  organization?: string;
  profile?: string;
  accessToken?: string;
  store?: RadiusProfileStore;
  io: CliIo;
}

export async function listOrganizationMembers(
  options: MemberCommandBase & { json?: boolean },
): Promise<void> {
  const { client, organization } = await resolveOrganizationTarget(options);
  const response = await client.listOrganizationMemberships(organization);
  if (options.json) {
    options.io.out(JSON.stringify(response, null, 2));
    return;
  }
  options.io.out(`Organization: ${organization}`);
  if (response.memberships.length === 0) {
    options.io.out("No organization members");
    return;
  }
  for (const membership of response.memberships) {
    const name =
      membership.displayName ?? membership.email ?? membership.accountId;
    options.io.out(
      `${membership.current ? "*" : " "} ${membership.id}\t${membership.lifecycleState}\t${membership.role}\t${name}`,
    );
    if (membership.email && membership.email !== name) {
      options.io.out(`  email: ${membership.email}`);
    }
    options.io.out(`  developer tokens: ${membership.developerTokenCount}`);
  }
}

export async function updateOrganizationMember(
  options: MemberCommandBase & {
    membershipId: string;
    role?: PlatformOrganizationRole;
    lifecycleState?: OrganizationMembershipLifecycle;
    json?: boolean;
  },
): Promise<void> {
  const { client, organization } = await resolveOrganizationTarget(options);
  const response = await client.updateOrganizationMembership(
    organization,
    options.membershipId,
    {
      apiVersion: 1,
      ...(options.role ? { role: options.role } : {}),
      ...(options.lifecycleState
        ? { lifecycleState: options.lifecycleState }
        : {}),
    },
    `membership.update.${randomUUID()}`,
  );
  if (options.json) {
    options.io.out(JSON.stringify(response, null, 2));
    return;
  }
  options.io.out(`Updated organization member ${response.membership.id}`);
  options.io.out(`Role: ${response.membership.role}`);
  options.io.out(`Access: ${response.membership.lifecycleState}`);
}

export function parseOrganizationMemberRole(
  value: string | undefined,
): PlatformOrganizationRole {
  if (
    !(ORGANIZATION_MEMBER_ROLES as readonly (string | undefined)[]).includes(
      value,
    )
  ) {
    throw new Error(
      `--role must be one of ${ORGANIZATION_MEMBER_ROLES.join(", ")}`,
    );
  }
  return value as PlatformOrganizationRole;
}
