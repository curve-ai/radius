import {
  FileText,
  FolderOpen,
  ShieldAlert,
  SquareTerminal,
} from "lucide-react";
import React from "react";
import { useState, type ReactNode } from "react";

void React;

import type { SessionTranscriptEvent } from "../../../../radius-api";
import { Button } from "@renderer/components/ui/button";

type ToolCallEvent = Extract<
  SessionTranscriptEvent,
  { eventType: "tool_call" }
>;
type ApprovalRequestEvent = Extract<
  SessionTranscriptEvent,
  { eventType: "approval_request" }
>;

interface ApprovalDetails {
  command: string | null;
  description: string;
  path: string;
  outsideProjectRoots: boolean;
  title: string;
}

function approvalDetails(event: ToolCallEvent): ApprovalDetails | null {
  if (
    !event.input ||
    typeof event.input !== "object" ||
    Array.isArray(event.input)
  ) {
    return null;
  }
  const input = event.input as Record<string, unknown>;
  if (input.pendingLocally !== true) return null;
  if (
    event.capability === "workspace.files" &&
    (event.operation === "read" || event.operation === "write") &&
    typeof input.path === "string"
  ) {
    const outsideProjectRoots = input.outsideProjectRoots === true;
    return {
      command: null,
      description: outsideProjectRoots
        ? `This agent needs permission to ${event.operation} a file outside the project folders.`
        : `Review this ${event.operation} request before Radius continues.`,
      path: input.path,
      outsideProjectRoots,
      title: "File access required",
    };
  }
  if (
    event.capability !== "shell" ||
    typeof input.command !== "string" ||
    typeof input.cwd !== "string" ||
    !Array.isArray(input.args) ||
    !input.args.every((argument) => typeof argument === "string")
  ) {
    return null;
  }
  const args = input.args as string[];
  return {
    command: [input.command, ...args]
      .map((part) =>
        /^[A-Za-z0-9_./:@%+=,-]+$/.test(part) ? part : JSON.stringify(part),
      )
      .join(" "),
    description:
      input.outsideProjectRoots === true
        ? "This command needs read and write access outside the project folders."
        : "Review the command before Radius runs it on this Mac.",
    path: input.cwd,
    outsideProjectRoots: input.outsideProjectRoots === true,
    title: "Command approval required",
  };
}

export function TerminalApproval({
  request,
  toolCall,
  onResolve,
}: {
  request: ApprovalRequestEvent;
  toolCall: ToolCallEvent;
  onResolve(decision: "approved" | "denied"): Promise<void>;
}): ReactNode {
  const [submitting, setSubmitting] = useState<"approved" | "denied" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const details = approvalDetails(toolCall);
  if (!details) return null;

  const resolve = async (decision: "approved" | "denied"): Promise<void> => {
    if (submitting) return;
    setSubmitting(decision);
    setError(null);
    try {
      await onResolve(decision);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Radius could not record this decision",
      );
      setSubmitting(null);
    }
  };

  return (
    <section
      aria-labelledby={`approval-title-${request.eventId}`}
      className="my-3 rounded-xl border border-border bg-card p-3"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <ShieldAlert className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3
            id={`approval-title-${request.eventId}`}
            className="text-sm font-normal text-foreground"
          >
            {details.title}
          </h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {details.description}
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {details.command ? (
          <div className="flex items-start gap-2 rounded-md bg-muted px-2.5 py-2">
            <SquareTerminal
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <code className="min-w-0 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
              {details.command}
            </code>
          </div>
        ) : null}
        <div className="flex min-w-0 items-center gap-2 px-0.5 text-xs text-muted-foreground">
          {details.command ? (
            <FolderOpen className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <FileText className="size-3.5 shrink-0" aria-hidden />
          )}
          <span className="truncate" title={details.path}>
            {details.path}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={submitting !== null}
          onClick={() => void resolve("denied")}
        >
          {submitting === "denied" ? "Denying..." : "Deny"}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={submitting !== null}
          onClick={() => void resolve("approved")}
        >
          {submitting === "approved" ? "Allowing..." : "Allow once"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-negative">
          {error}
        </p>
      ) : null}
    </section>
  );
}
