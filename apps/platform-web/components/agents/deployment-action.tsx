"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { changeDeploymentAction } from "@/app/workspace/agents/[agent]/actions";
import type { DeploymentActionState } from "@/app/workspace/agents/[agent]/action-state";

const INITIAL_STATE: DeploymentActionState = { status: "idle" };

export function DeploymentAction({
  organization,
  agent,
  environment,
  agentDeploymentId,
  currentRevision,
  mode,
}: {
  organization: string;
  agent: string;
  environment: string;
  agentDeploymentId: string;
  currentRevision: number;
  mode: "promote" | "rollback";
}) {
  const [state, formAction, pending] = useActionState(
    changeDeploymentAction,
    INITIAL_STATE,
  );
  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="organization" value={organization} />
      <input type="hidden" name="agent" value={agent} />
      <input type="hidden" name="environment" value={environment} />
      <input type="hidden" name="agentDeploymentId" value={agentDeploymentId} />
      <input type="hidden" name="expectedRevision" value={currentRevision} />
      <input type="hidden" name="mode" value={mode} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="secondary" size="xs" disabled={pending}>
          {pending
            ? mode === "rollback"
              ? "Rolling back..."
              : "Promoting..."
            : mode === "rollback"
              ? "Roll back"
              : "Promote"}
        </Button>
        {state.status !== "idle" ? (
          <p
            className={
              state.status === "error"
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
            role={state.status === "error" ? "alert" : "status"}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
