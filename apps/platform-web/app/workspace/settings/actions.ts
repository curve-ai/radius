"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import {
  PLATFORM_ORGANIZATION_ROLES,
  RadiusPlatformError,
  type DeveloperTokenScope,
  type PlatformOrganizationRole,
} from "@curve-ai/platform-client";
import { formString, isUuid } from "@/app/workspace/action-input";
import { getPlatformContext } from "@/lib/platform-server";
import {
  allowedDeveloperTokenScopes,
  canManageDeveloperTokens,
  canManageOrganizationMembers,
} from "@/lib/platform-permissions";
import type {
  CreateDeveloperTokenActionState,
  RevokeDeveloperTokenActionState,
  UpdateOrganizationMemberActionState,
} from "./action-state";

export async function updateOrganizationMemberAction(
  _previousState: UpdateOrganizationMemberActionState,
  formData: FormData,
): Promise<UpdateOrganizationMemberActionState> {
  try {
    const context = await getPlatformContext();
    const organization = requireExpectedOrganization(
      context.organization,
      formData.get("organization"),
    );
    if (!canManageOrganizationMembers(organization.role)) {
      return memberFailure(
        "Owner access is required to manage organization members.",
      );
    }
    const membershipId = formString(formData, "membershipId");
    if (!isUuid(membershipId)) {
      return memberFailure("The organization membership is invalid.");
    }
    const operation = formString(formData, "operation");
    let request:
      | { apiVersion: 1; role: PlatformOrganizationRole }
      | {
          apiVersion: 1;
          lifecycleState: "active" | "suspended" | "removed";
        };
    if (operation === "role") {
      const role = formString(formData, "role");
      if (
        !PLATFORM_ORGANIZATION_ROLES.includes(role as PlatformOrganizationRole)
      ) {
        return memberFailure("Select a valid organization role.");
      }
      request = { apiVersion: 1, role: role as PlatformOrganizationRole };
    } else if (["suspend", "restore", "remove"].includes(operation)) {
      request = {
        apiVersion: 1,
        lifecycleState:
          operation === "suspend"
            ? "suspended"
            : operation === "restore"
              ? "active"
              : "removed",
      };
    } else {
      return memberFailure("The organization membership action is invalid.");
    }
    const result = await context.client.updateOrganizationMembership(
      organization.slug,
      membershipId,
      request,
      randomUUID(),
    );
    revalidatePath("/workspace/settings");
    return {
      status: "success",
      message:
        operation === "role"
          ? `Role changed to ${result.membership.role}. Existing developer tokens were revoked.`
          : operation === "suspend"
            ? "Access suspended. Browser sessions were revoked."
            : operation === "restore"
              ? "Access restored. The member must sign in again."
              : "Access removed. Sessions and developer tokens were revoked.",
    };
  } catch (error) {
    return memberFailure(memberActionErrorMessage(error));
  }
}

export async function createDeveloperTokenAction(
  _previousState: CreateDeveloperTokenActionState,
  formData: FormData,
): Promise<CreateDeveloperTokenActionState> {
  try {
    const context = await getPlatformContext();
    const organization = requireExpectedOrganization(
      context.organization,
      formData.get("organization"),
    );
    if (!canManageDeveloperTokens(organization.role)) {
      return failure(
        "Owner or admin access is required to create developer tokens.",
      );
    }

    const label = formString(formData, "label").trim();
    if (label.length < 1 || label.length > 120) {
      return failure("Enter a token label between 1 and 120 characters.");
    }

    const allowed = new Set(allowedDeveloperTokenScopes(organization.role));
    const scopes = formData
      .getAll("scopes")
      .filter((value): value is string => typeof value === "string");
    if (scopes.length < 1) {
      return failure("Select at least one scope.");
    }
    if (
      new Set(scopes).size !== scopes.length ||
      scopes.some((scope) => !allowed.has(scope as DeveloperTokenScope))
    ) {
      return failure(
        "The selected token scopes are not allowed for this role.",
      );
    }

    const result = await context.client.createDeveloperToken(
      organization.slug,
      {
        apiVersion: 1,
        label,
        scopes: scopes as DeveloperTokenScope[],
        expiresAt: null,
      },
      randomUUID(),
    );
    revalidatePath("/workspace/settings");
    return {
      status: "success",
      message: `${result.token.label} is ready. Copy the secret now.`,
      secret: result.secret,
      token: result.token,
    };
  } catch (error) {
    return failure(actionErrorMessage(error));
  }
}

export async function revokeDeveloperTokenAction(
  _previousState: RevokeDeveloperTokenActionState,
  formData: FormData,
): Promise<RevokeDeveloperTokenActionState> {
  try {
    const context = await getPlatformContext();
    const organization = requireExpectedOrganization(
      context.organization,
      formData.get("organization"),
    );
    if (!canManageDeveloperTokens(organization.role)) {
      return {
        status: "error",
        message:
          "Owner or admin access is required to revoke developer tokens.",
      };
    }
    const tokenId = formString(formData, "tokenId");
    if (!isUuid(tokenId)) {
      return { status: "error", message: "The developer token is invalid." };
    }

    const result = await context.client.revokeDeveloperToken(
      organization.slug,
      tokenId,
      randomUUID(),
    );
    revalidatePath("/workspace/settings");
    return {
      status: "success",
      message: `${result.token.label} was revoked.`,
    };
  } catch (error) {
    return { status: "error", message: actionErrorMessage(error) };
  }
}

function failure(message: string): CreateDeveloperTokenActionState {
  return { status: "error", message };
}

function memberFailure(message: string): UpdateOrganizationMemberActionState {
  return { status: "error", message };
}

function requireExpectedOrganization<
  T extends { slug: string; role: "owner" | "admin" | "developer" | "viewer" },
>(organization: T | undefined, candidate: FormDataEntryValue | null): T {
  if (
    !organization ||
    typeof candidate !== "string" ||
    candidate !== organization.slug
  ) {
    throw new Error(
      "The selected organization changed. Refresh and try again.",
    );
  }
  return organization;
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof RadiusPlatformError) {
    if (error.code === "CURRENT_TOKEN_REVOCATION_FORBIDDEN") {
      return "The token used by this dashboard cannot revoke itself.";
    }
    if (error.code === "TOKEN_SECRET_ALREADY_ISSUED") {
      return "This request already created a token, but its secret cannot be shown again.";
    }
    if (error.status === 403) {
      return "Your current role does not allow this token operation.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "The token operation failed.";
}

function memberActionErrorMessage(error: unknown): string {
  if (error instanceof RadiusPlatformError) {
    if (error.code === "CURRENT_MEMBERSHIP_UPDATE_FORBIDDEN") {
      return "Another owner must change your organization access.";
    }
    if (error.code === "LAST_OWNER_REQUIRED") {
      return "Promote another active owner before changing this owner.";
    }
    if (error.status === 403) {
      return "Your current role does not allow organization member changes.";
    }
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : "The organization membership change failed.";
}
