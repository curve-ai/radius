"use client";

import { useActionState, useState } from "react";

import type {
  DeveloperTokenScope,
  DeveloperTokenSummary,
} from "@curve-ai/platform-client";
import type { PlatformOrganizationRole } from "@/lib/platform-permissions";
import {
  allowedDeveloperTokenScopes,
  DEPLOYMENT_TOKEN_SCOPES,
} from "@/lib/platform-permissions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  createDeveloperTokenAction,
  revokeDeveloperTokenAction,
} from "@/app/workspace/settings/actions";
import type {
  CreateDeveloperTokenActionState,
  RevokeDeveloperTokenActionState,
} from "@/app/workspace/settings/action-state";

const INITIAL_CREATE_STATE: CreateDeveloperTokenActionState = {
  status: "idle",
};
const INITIAL_REVOKE_STATE: RevokeDeveloperTokenActionState = {
  status: "idle",
};

const SCOPE_LABELS: Record<DeveloperTokenScope, string> = {
  "organization.admin": "Administer organization",
  "agent.read": "Read agents",
  "agent.write": "Manage agents",
  "deployment.read": "Read deployments",
  "deployment.write": "Change deployments",
  "installation.read": "Read device installations",
  "installation.write": "Report installation state",
  "token.admin": "Manage developer tokens",
};

const SCOPE_PRESENTATION_ORDER: readonly DeveloperTokenScope[] = [
  "agent.read",
  "agent.write",
  "deployment.read",
  "deployment.write",
  "installation.read",
  "installation.write",
  "organization.admin",
  "token.admin",
];

export function DeveloperTokenManager({
  organization,
  role,
  tokens,
  loadError,
}: {
  organization: string;
  role: PlatformOrganizationRole;
  tokens: DeveloperTokenSummary[];
  loadError?: string;
}) {
  const allowedScopes = allowedDeveloperTokenScopes(role);
  return (
    <div>
      <CreateDeveloperTokenForm
        organization={organization}
        allowedScopes={allowedScopes}
      />
      <div aria-label="Developer tokens">
        {loadError ? (
          <p className="px-4 py-5 text-sm text-destructive" role="alert">
            {loadError}
          </p>
        ) : tokens.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground">
            No developer tokens have been created.
          </p>
        ) : (
          tokens.map((token) => (
            <DeveloperTokenRow
              key={token.id}
              organization={organization}
              token={token}
            />
          ))
        )}
      </div>
    </div>
  );
}

function CreateDeveloperTokenForm({
  organization,
  allowedScopes,
}: {
  organization: string;
  allowedScopes: readonly DeveloperTokenScope[];
}) {
  const [state, formAction, pending] = useActionState(
    createDeveloperTokenAction,
    INITIAL_CREATE_STATE,
  );
  return (
    <form action={formAction} className="border-b border-border px-4 py-4">
      <input type="hidden" name="organization" value={organization} />
      <div className="grid gap-4 lg:grid-cols-[minmax(12rem,0.8fr)_minmax(18rem,1.2fr)]">
        <div className="space-y-2">
          <label
            htmlFor="developer-token-label"
            className="text-sm text-foreground"
          >
            Token label
          </label>
          <Input
            id="developer-token-label"
            name="label"
            maxLength={120}
            autoComplete="off"
            placeholder="CI deployment"
            required
          />
          <p className="text-xs text-muted-foreground">
            Use a label that identifies the repository or automation.
          </p>
        </div>
        <fieldset>
          <legend className="text-sm text-foreground">Scopes</legend>
          <div className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {SCOPE_PRESENTATION_ORDER.filter((scope) =>
              allowedScopes.includes(scope),
            ).map((scope) => (
              <label
                key={scope}
                className="flex min-h-7 items-center gap-2 text-sm text-foreground"
              >
                <Checkbox
                  name="scopes"
                  value={scope}
                  defaultChecked={DEPLOYMENT_TOKEN_SCOPES.includes(scope)}
                />
                <span>{SCOPE_LABELS[scope]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating..." : "Create token"}
        </Button>
        {state.status === "error" ? (
          <p className="text-sm text-destructive" role="alert">
            {state.message}
          </p>
        ) : null}
      </div>
      {state.status === "success" ? <OneTimeSecret state={state} /> : null}
    </form>
  );
}

function OneTimeSecret({
  state,
}: {
  state: Extract<CreateDeveloperTokenActionState, { status: "success" }>;
}) {
  const [copied, setCopied] = useState(false);
  async function copySecret() {
    await navigator.clipboard.writeText(state.secret);
    setCopied(true);
  }
  return (
    <div
      className="mt-4 rounded-md border border-border bg-muted/40 p-3"
      aria-live="polite"
    >
      <p className="text-sm text-foreground">{state.message}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Radius will not show this secret again.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          value={state.secret}
          readOnly
          aria-label="New developer token secret"
          className="font-mono text-xs"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={copySecret}
        >
          {copied ? "Copied" : "Copy secret"}
        </Button>
      </div>
    </div>
  );
}

function DeveloperTokenRow({
  organization,
  token,
}: {
  organization: string;
  token: DeveloperTokenSummary;
}) {
  const [state, formAction, pending] = useActionState(
    revokeDeveloperTokenAction,
    INITIAL_REVOKE_STATE,
  );
  const revoked = token.revokedAt !== null;
  return (
    <div className="border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-sm text-foreground">{token.label}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {token.prefix}
            </p>
            <p className="text-xs text-muted-foreground">
              {revoked ? "Revoked" : token.current ? "Current" : "Active"}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {token.scopes.join(", ")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Created {formatTimestamp(token.createdAt)}
            {token.lastUsedAt
              ? `, last used ${formatTimestamp(token.lastUsedAt)}`
              : ""}
          </p>
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
        {!revoked ? (
          <form action={formAction}>
            <input type="hidden" name="organization" value={organization} />
            <input type="hidden" name="tokenId" value={token.id} />
            <Button
              type="submit"
              variant="destructive"
              size="xs"
              disabled={pending || token.current}
              title={
                token.current
                  ? "The current developer token cannot revoke itself"
                  : undefined
              }
            >
              {pending ? "Revoking..." : "Revoke"}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
