import {
  DEVELOPER_TOKEN_SCOPES,
  type DeveloperTokenScope,
  type PlatformOrganizationRole,
} from "@curve-ai/platform-client";

export { DEVELOPER_TOKEN_SCOPES };
export type { PlatformOrganizationRole };

export const DEPLOYMENT_TOKEN_SCOPES: readonly DeveloperTokenScope[] = [
  "agent.read",
  "agent.write",
  "deployment.read",
  "deployment.write",
  "installation.read",
  "installation.write",
];

export function canManageDeveloperTokens(
  role: PlatformOrganizationRole,
): boolean {
  return role === "owner" || role === "admin";
}

export function canManageOrganizationMembers(
  role: PlatformOrganizationRole,
): boolean {
  return role === "owner";
}

export function canChangeDeployments(role: PlatformOrganizationRole): boolean {
  return role !== "viewer";
}

export function canViewInstallations(role: PlatformOrganizationRole): boolean {
  return role !== "viewer";
}

export function allowedDeveloperTokenScopes(
  role: PlatformOrganizationRole,
): readonly DeveloperTokenScope[] {
  if (role === "owner") return DEVELOPER_TOKEN_SCOPES;
  if (role === "admin") {
    return DEVELOPER_TOKEN_SCOPES.filter(
      (scope) => scope !== "organization.admin",
    );
  }
  return [];
}
