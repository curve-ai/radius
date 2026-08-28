"use client";

import { useActionState, useEffect, useState } from "react";

import {
  OrganizationMembershipSummary,
  PLATFORM_ORGANIZATION_ROLES,
  PlatformOrganizationRole,
} from "@curve-ai/platform-client";
import { updateOrganizationMemberAction } from "@/app/workspace/settings/actions";
import type { UpdateOrganizationMemberActionState } from "@/app/workspace/settings/action-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const INITIAL_STATE: UpdateOrganizationMemberActionState = { status: "idle" };
const ROLES = PLATFORM_ORGANIZATION_ROLES;

export function OrganizationMemberManager({
  organization,
  memberships,
  loadError,
}: {
  organization: string;
  memberships: OrganizationMembershipSummary[];
  loadError?: string;
}) {
  if (loadError) {
    return (
      <p className="px-4 py-5 text-sm text-destructive" role="alert">
        {loadError}
      </p>
    );
  }
  if (memberships.length === 0) {
    return (
      <p className="px-4 py-5 text-sm text-muted-foreground">
        No organization memberships are available.
      </p>
    );
  }
  return (
    <div aria-label="Organization members">
      {memberships.map((membership) => (
        <OrganizationMemberRow
          key={membership.id}
          organization={organization}
          membership={membership}
        />
      ))}
    </div>
  );
}

function OrganizationMemberRow({
  organization,
  membership,
}: {
  organization: string;
  membership: OrganizationMembershipSummary;
}) {
  const [state, formAction, pending] = useActionState(
    updateOrganizationMemberAction,
    INITIAL_STATE,
  );
  const [role, setRole] = useState<PlatformOrganizationRole>(membership.role);
  useEffect(() => {
    setRole(membership.role);
  }, [membership.role]);
  const formId = `organization-member-${membership.id}`;
  const name = membership.displayName ?? membership.email ?? "Unnamed member";
  return (
    <div className="border-b border-border px-4 py-3 last:border-b-0">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="truncate text-sm text-foreground">{name}</p>
            {membership.current ? (
              <span className="text-xs text-muted-foreground">You</span>
            ) : null}
            <span className="text-xs capitalize text-muted-foreground">
              {membership.lifecycleState}
            </span>
          </div>
          {membership.email && membership.email !== name ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {membership.email}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            Joined {formatDate(membership.joinedAt)},{" "}
            {membership.developerTokenCount} developer{" "}
            {membership.developerTokenCount === 1 ? "token" : "tokens"}
          </p>
          {membership.current ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Another owner must change your role or access.
            </p>
          ) : null}
          {state.status !== "idle" ? (
            <p
              className={
                state.status === "error"
                  ? "mt-2 text-sm text-destructive"
                  : "mt-2 text-sm text-muted-foreground"
              }
              role={state.status === "error" ? "alert" : "status"}
            >
              {state.message}
            </p>
          ) : null}
        </div>

        {!membership.current ? (
          <form
            id={formId}
            action={formAction}
            className="flex flex-wrap items-end gap-2 lg:justify-end"
          >
            <input type="hidden" name="organization" value={organization} />
            <input type="hidden" name="membershipId" value={membership.id} />
            <input type="hidden" name="role" value={role} />
            {membership.lifecycleState !== "removed" ? (
              <div className="space-y-1">
                <label
                  htmlFor={`${formId}-role`}
                  className="block text-xs text-muted-foreground"
                >
                  Role
                </label>
                <Select
                  value={role}
                  onValueChange={(value) =>
                    setRole(value as PlatformOrganizationRole)
                  }
                >
                  <SelectTrigger id={`${formId}-role`} className="h-8 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((candidate) => (
                      <SelectItem
                        key={candidate}
                        value={candidate}
                        className="capitalize"
                      >
                        {candidate}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {membership.lifecycleState !== "removed" ? (
              <Button
                type="submit"
                name="operation"
                value="role"
                variant="secondary"
                size="xs"
                disabled={pending || role === membership.role}
              >
                {pending ? "Saving..." : "Save role"}
              </Button>
            ) : null}
            {membership.lifecycleState === "active" ? (
              <Button
                type="submit"
                name="operation"
                value="suspend"
                variant="secondary"
                size="xs"
                disabled={pending}
              >
                Suspend
              </Button>
            ) : (
              <Button
                type="submit"
                name="operation"
                value="restore"
                variant="secondary"
                size="xs"
                disabled={pending}
              >
                Restore
              </Button>
            )}
            {membership.lifecycleState !== "removed" ? (
              <RemoveMemberDialog
                formId={formId}
                name={name}
                disabled={pending}
              />
            ) : null}
          </form>
        ) : null}
      </div>
    </div>
  );
}

function RemoveMemberDialog({
  formId,
  name,
  disabled,
}: {
  formId: string;
  name: string;
  disabled: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          size="xs"
          disabled={disabled}
        >
          Remove
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-normal">
            Remove {name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This revokes browser sessions and developer tokens. An owner can
            restore the membership later, but the member must sign in again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              type="submit"
              form={formId}
              name="operation"
              value="remove"
              variant="destructive"
            >
              Remove access
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
