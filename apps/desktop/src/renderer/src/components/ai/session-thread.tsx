import {
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  FileTerminal,
  ShieldCheck,
  ShieldX,
  Wrench,
} from "lucide-react";
import React, {
  memo,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

void React;

import type {
  SessionTranscriptEvent,
  ToolApprovalSelection,
} from "../../../../radius-api";
import { ActivityIndicator } from "@renderer/components/ui/activity-indicator";
import { Button } from "@renderer/components/ui/button";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "@renderer/components/ui/motion";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip";
import { cn } from "@renderer/lib/utils";
import { useCopyFeedback } from "./copy-feedback";
import { MessageImage, MessageImageGallery } from "./message-image";
import { MessageMarkdown } from "./message-markdown";
import { messageTimestampPresentation } from "./message-timestamp";
import { messageMarkdownForCopy } from "./message-markdown-normalize";
import { deriveWorkingRunActivity } from "./session-run-activity";
import {
  SessionRunActivityLabel,
  type DisplayedRunActivity,
} from "./session-run-activity-label";
import { TerminalApproval } from "./terminal-approval";
import {
  buildSessionTranscriptBlocks,
  isTerminalRunState,
  type SessionPlan,
  type SessionPlanPresentation,
  type SessionTranscriptBlock,
} from "./session-transcript";
import { PlanProgress } from "./plan-progress";
import {
  toolCallPresentation,
  type ToolCallEvent,
  type ToolProgressEvent,
  type ToolResultEvent,
} from "./tool-call-presentation";

type MessageEvent = Extract<SessionTranscriptEvent, { eventType: "message" }>;
type RunStateEvent = Extract<
  SessionTranscriptEvent,
  { eventType: "agent_run_state_update" }
>;
type RunPresentationEvent = Extract<
  SessionTranscriptEvent,
  { eventType: "agent_run_presentation" }
>;
type TraceRowEvent = Extract<
  SessionTranscriptEvent,
  {
    eventType: "reasoning_summary" | "approval_decision" | "error";
  }
>;

const TRANSCRIPT_STATE_EASE = [0.23, 1, 0.32, 1] as const;
const TRACE_ROW_LAYOUT_EASE = [0.77, 0, 0.175, 1] as const;

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, milliseconds) / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${(seconds % 60).toFixed(1)}s`;
}

function useElapsed(startedAt: string, active: boolean): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [active]);

  return formatElapsed(now - Date.parse(startedAt));
}

function RunDurationText({
  active,
  endedAt,
  startedAt,
}: {
  active: boolean;
  endedAt: string | null;
  startedAt: string;
}): ReactNode {
  const liveDuration = useElapsed(startedAt, active);
  return active
    ? liveDuration
    : formatElapsed(Date.parse(endedAt ?? startedAt) - Date.parse(startedAt));
}

function Message({
  event,
  completedPlan,
  reduceMotion,
  sessionId,
}: {
  event: MessageEvent;
  completedPlan?: SessionPlan;
  reduceMotion: boolean;
  sessionId: string;
}): ReactNode {
  const { copied, copyText } = useCopyFeedback();
  const user = event.role === "user";
  const system =
    event.role === "system" || event.messageKind === "system_notice";
  const streaming = event.status === "streaming";
  const images = (event.artifacts ?? []).filter(
    (artifact) => artifact.artifactType === "image",
  );
  const copyIconTransform = reduceMotion ? "scale(1)" : "scale(0.96)";
  const timestamp = messageTimestampPresentation(event.occurredAt);

  const copyMarkdown = async (): Promise<void> => {
    await copyText(messageMarkdownForCopy(event.text));
  };

  if (!event.text && images.length === 0) return null;

  return (
    <article
      data-session-event-id={event.eventId}
      aria-label={
        system ? "System message" : user ? "Your message" : "Assistant message"
      }
      className={cn("group/message mb-6 flex w-full", user && "justify-end")}
    >
      <div
        className={cn(
          "min-w-0 text-sm leading-6 text-foreground",
          user && "max-w-[88%] rounded-lg bg-muted px-3 py-2.5",
          system &&
            "w-full rounded-md border border-border bg-card px-3 py-2.5 text-muted-foreground",
          !user && !system && "w-full",
        )}
      >
        {event.text ? (
          <MessageMarkdown
            markdown={event.text}
            fullWidthTables={!user && !system}
            imageSize={user ? "user" : "assistant"}
            sessionId={sessionId}
            streaming={streaming}
          />
        ) : null}
        {images.length > 0 ? (
          <MessageImageGallery>
            {images.map((artifact) => {
              const generatedName =
                artifact.name.startsWith("generated-image-");
              const authoredAlt = generatedName
                ? null
                : artifact.name.replace(/\.(?:avif|gif|jpe?g|png|webp)$/i, "");
              return artifact.storageKind === "link" && artifact.url ? (
                <MessageImage
                  key={artifact.id}
                  src={artifact.url}
                  alt={authoredAlt ?? "Generated image"}
                  caption={authoredAlt}
                  resolveEnabled={!streaming}
                  size={user ? "user" : "assistant"}
                  title={artifact.name}
                />
              ) : (
                <MessageImage
                  key={artifact.id}
                  artifact={{ id: artifact.id, sessionId }}
                  alt={authoredAlt ?? "Generated image"}
                  caption={authoredAlt}
                  resolveEnabled={!streaming}
                  size={user ? "user" : "assistant"}
                  title={artifact.name}
                />
              );
            })}
          </MessageImageGallery>
        ) : null}
        {!user && !system && !streaming ? (
          <div className="pointer-events-none mt-2 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100">
            <Tooltip disableHoverableContent>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={copied ? "Markdown copied" : "Copy markdown"}
                  onClick={() => void copyMarkdown()}
                  className="-ml-1 size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                >
                  <span className="relative block size-3 shrink-0">
                    <AnimatePresence initial={false} mode="popLayout">
                      <motion.span
                        key={copied ? "copied" : "copy"}
                        initial={{ opacity: 0, transform: copyIconTransform }}
                        animate={{ opacity: 1, transform: "scale(1)" }}
                        exit={{
                          opacity: 0,
                          transform: copyIconTransform,
                          transition: {
                            duration: reduceMotion ? 0.1 : 0.08,
                            ease: TRANSCRIPT_STATE_EASE,
                          },
                        }}
                        transition={{
                          duration: reduceMotion ? 0.1 : 0.12,
                          ease: TRANSCRIPT_STATE_EASE,
                        }}
                        className="block size-3"
                      >
                        {copied ? (
                          <Check className="size-3" aria-hidden />
                        ) : (
                          <Copy className="size-3" aria-hidden />
                        )}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {copied ? "Markdown copied" : "Copy markdown"}
              </TooltipContent>
            </Tooltip>
            {completedPlan ? (
              <PlanProgress plan={completedPlan} placement="message" />
            ) : null}
            {timestamp ? (
              <time
                dateTime={timestamp.dateTime}
                title={timestamp.fullLabel}
                aria-label={`Message sent ${timestamp.fullLabel}`}
                className="ml-1 text-xs leading-5 tabular-nums text-muted-foreground"
              >
                {timestamp.displayLabel}
              </time>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function runLabel(
  state: RunStateEvent["state"],
  presentation: RunPresentationEvent | undefined,
): string {
  if (state === "working") return presentation?.label ?? "Thinking";
  if (state === "waiting_for_approval") return "Waiting for approval";
  if (state === "waiting_for_user") return "Waiting for you";
  if (state === "failed") return presentation?.label ?? "Stopped with an error";
  if (state === "cancelled") return presentation?.label ?? "Stopped";
  return presentation?.label ?? "Thought";
}

function TraceRow({
  event,
  reduceMotion,
}: {
  event: TraceRowEvent;
  reduceMotion: boolean;
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const isError = event.eventType === "error";
  const textEnterTransform = reduceMotion
    ? "translateY(0px)"
    : "translateY(2px)";
  const textExitTransform = reduceMotion
    ? "translateY(0px)"
    : "translateY(-2px)";

  const icon =
    event.eventType === "reasoning_summary" ? (
      <Brain className="size-3.5 shrink-0" aria-hidden />
    ) : event.eventType === "approval_decision" &&
      event.decision !== "approved" ? (
      <ShieldX className="size-3.5 shrink-0" aria-hidden />
    ) : event.eventType === "approval_decision" ? (
      <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
    ) : isError ? (
      <CircleAlert className="size-3.5 shrink-0" aria-hidden />
    ) : (
      <Wrench className="size-3.5 shrink-0" aria-hidden />
    );

  const content =
    event.eventType === "reasoning_summary"
      ? event.summaryText
      : event.eventType === "approval_decision"
        ? event.decision === "approved"
          ? "Command approved"
          : event.decision === "denied"
            ? "Command denied"
            : event.decision === "expired"
              ? "Command approval expired"
              : "Command approval cancelled"
        : event.message;

  return (
    <motion.div
      layout={!reduceMotion}
      layoutDependency={expanded}
      transition={{
        layout: {
          duration: 0.18,
          ease: TRACE_ROW_LAYOUT_EASE,
        },
      }}
      className="w-full"
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className={cn(
          "flex min-h-7 w-full min-w-0 gap-2 rounded-sm py-1 text-left text-[0.78125rem] leading-5 transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.99]",
          expanded ? "items-start" : "items-center",
          isError ? "text-negative" : "text-muted-foreground",
        )}
      >
        <motion.span
          layout={reduceMotion ? false : "position"}
          layoutDependency={expanded}
          className={cn("shrink-0", expanded && "mt-0.5")}
        >
          {icon}
        </motion.span>
        <motion.span
          layout={reduceMotion ? false : "position"}
          layoutDependency={expanded}
          className="relative min-w-0 flex-1"
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={expanded ? "expanded" : "compact"}
              initial={{ opacity: 0, transform: textEnterTransform }}
              animate={{ opacity: 1, transform: "translateY(0px)" }}
              exit={{
                opacity: 0,
                transform: textExitTransform,
                transition: {
                  duration: 0.1,
                  ease: TRANSCRIPT_STATE_EASE,
                },
              }}
              transition={{
                duration: reduceMotion ? 0.1 : 0.16,
                ease: TRANSCRIPT_STATE_EASE,
              }}
              className={cn(
                "block min-w-0",
                expanded ? "break-words whitespace-normal" : "truncate",
              )}
            >
              {content}
            </motion.span>
          </AnimatePresence>
        </motion.span>
        <motion.span
          layout={reduceMotion ? false : "position"}
          layoutDependency={expanded}
          className={cn("shrink-0", expanded && "mt-0.5")}
        >
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform duration-200",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
        </motion.span>
      </button>
    </motion.div>
  );
}

function ToolCallRow({
  event,
  progress,
  reduceMotion,
  result,
  working,
}: {
  event: ToolCallEvent;
  progress: readonly ToolProgressEvent[];
  reduceMotion: boolean;
  result?: ToolResultEvent;
  working: boolean;
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const presentation = toolCallPresentation(event, progress, result);
  const duration = useElapsed(event.occurredAt, presentation.active);
  const hasDetails = presentation.details.length > 0;
  const icon =
    event.capability === "shell" || event.capability === "acp.execute" ? (
      <FileTerminal className="size-3.5" aria-hidden />
    ) : (
      <Wrench className="size-3.5" aria-hidden />
    );

  const header = (
    <>
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          presentation.active && working
            ? "radius-thinking-label"
            : "text-muted-foreground",
          presentation.failed && "text-negative",
        )}
      >
        {presentation.title}
        {presentation.active ? (
          <span className="tabular-nums text-muted-foreground">
            {` for ${duration}`}
          </span>
        ) : null}
      </span>
      {hasDetails ? (
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      ) : null}
    </>
  );

  return (
    <motion.div
      layout={!reduceMotion}
      layoutDependency={expanded}
      transition={{
        layout: { duration: 0.18, ease: TRACE_ROW_LAYOUT_EASE },
      }}
      className="w-full"
      data-tool-call-id={event.eventId}
    >
      {hasDetails ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="-ml-1.5 flex min-h-8 w-[calc(100%+0.375rem)] items-center gap-2 rounded-sm px-1.5 text-left transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.99]"
        >
          {header}
        </button>
      ) : (
        <div className="flex min-h-8 items-center gap-2">{header}</div>
      )}
      {presentation.active ? (
        <span className="sr-only" role="status" aria-live="polite">
          {presentation.title}
        </span>
      ) : null}
      {hasDetails ? (
        <div
          aria-hidden={!expanded}
          inert={!expanded}
          className="grid transition-[grid-template-rows,opacity] duration-200"
          style={{
            gridTemplateRows: expanded ? "1fr" : "0fr",
            opacity: expanded ? 1 : 0,
          }}
        >
          <div className="overflow-hidden">
            <div className="my-1 max-h-64 overflow-auto rounded-md border border-border bg-muted/50 px-3 py-2.5">
              {presentation.details.map((detail) => (
                <section key={detail.label} className="not-last:mb-3">
                  <div className="mb-1 text-sm text-muted-foreground">
                    {detail.label}
                  </div>
                  <pre className="m-0 whitespace-pre-wrap break-words font-mono text-sm leading-6 text-foreground">
                    {detail.text}
                  </pre>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </motion.div>
  );
}

function RunTrace({
  assistantStreaming,
  block,
  onResolveTerminalApproval,
  reduceMotion,
  sessionId,
}: {
  assistantStreaming: boolean;
  block: Extract<SessionTranscriptBlock, { kind: "run" }>;
  onResolveTerminalApproval(
    approvalRequestEventId: string,
    selection: ToolApprovalSelection,
  ): Promise<void>;
  reduceMotion: boolean;
  sessionId: string;
}): ReactNode {
  const startedAt =
    block.events.find((event) => event.eventType === "agent_run")?.occurredAt ??
    block.events[0]?.occurredAt ??
    new Date().toISOString();
  const stateEvents = block.events.filter(
    (event): event is RunStateEvent =>
      event.eventType === "agent_run_state_update",
  );
  const latestState = stateEvents.at(-1);
  const state = latestState?.state ?? "working";
  const live = !isTerminalRunState(state);
  const activelyWorking = state === "working";
  const presentation = block.events
    .filter(
      (event): event is RunPresentationEvent =>
        event.eventType === "agent_run_presentation",
    )
    .at(-1);
  const endedAt = latestState && !live ? latestState.occurredAt : null;
  const resultByToolCall = useMemo(
    () =>
      new Map(
        block.events
          .filter(
            (
              event,
            ): event is Extract<
              SessionTranscriptEvent,
              { eventType: "tool_result" }
            > => event.eventType === "tool_result",
          )
          .map((event) => [event.toolCallEventId, event]),
      ),
    [block.events],
  );
  const progressByToolCall = useMemo(() => {
    const progress = new Map<string, ToolProgressEvent[]>();
    for (const event of block.events) {
      if (event.eventType !== "tool_progress") continue;
      const entries = progress.get(event.toolCallEventId) ?? [];
      entries.push(event);
      progress.set(event.toolCallEventId, entries);
    }
    return progress;
  }, [block.events]);
  const toolCalls = useMemo(
    () =>
      new Map(
        block.events
          .filter(
            (
              event,
            ): event is Extract<
              SessionTranscriptEvent,
              { eventType: "tool_call" }
            > => event.eventType === "tool_call",
          )
          .map((event) => [event.eventId, event]),
      ),
    [block.events],
  );
  const decidedApprovalIds = useMemo(
    () =>
      new Set(
        block.events.flatMap((event) =>
          event.eventType === "approval_decision"
            ? [event.approvalRequestEventId]
            : [],
        ),
      ),
    [block.events],
  );
  const rows = block.events.filter(
    (
      event,
    ): event is
      | TraceRowEvent
      | ToolCallEvent
      | Extract<SessionTranscriptEvent, { eventType: "message" }>
      | Extract<SessionTranscriptEvent, { eventType: "approval_request" }> =>
      event.eventType === "reasoning_summary" ||
      (event.eventType === "message" && event.messageKind === "progress") ||
      event.eventType === "tool_call" ||
      event.eventType === "approval_request" ||
      event.eventType === "approval_decision" ||
      event.eventType === "error",
  );
  const hasActiveTool = [...toolCalls.values()].some(
    (event) =>
      toolCallPresentation(
        event,
        progressByToolCall.get(event.eventId) ?? [],
        resultByToolCall.get(event.eventId),
      ).active,
  );
  const showRunStatus =
    (live && !hasActiveTool && !assistantStreaming) ||
    (state !== "working" && state !== "completed" && rows.length === 0);
  const nextActivity = useMemo<DisplayedRunActivity>(() => {
    if (activelyWorking) {
      return {
        ...deriveWorkingRunActivity(block.events, assistantStreaming),
        active: true,
      };
    }
    return {
      key: `run-state-${state}`,
      label: runLabel(state, presentation),
      active: false,
    };
  }, [activelyWorking, assistantStreaming, block.events, presentation, state]);
  const completed = state === "completed";
  if (!live && rows.length === 0) return null;

  return (
    <section
      aria-label="Agent work"
      className="mb-3 flex w-full flex-col gap-1"
    >
      {rows.map((event) => {
        if (event.eventType === "message") {
          return (
            <Message
              key={event.eventId}
              event={event}
              reduceMotion={reduceMotion}
              sessionId={sessionId}
            />
          );
        }
        if (event.eventType === "tool_call") {
          return (
            <ToolCallRow
              key={event.eventId}
              event={event}
              progress={progressByToolCall.get(event.eventId) ?? []}
              reduceMotion={reduceMotion}
              result={resultByToolCall.get(event.eventId)}
              working={activelyWorking}
            />
          );
        }
        if (event.eventType === "approval_request") {
          const toolCall = toolCalls.get(event.toolCallEventId);
          return toolCall && !decidedApprovalIds.has(event.eventId) ? (
            <TerminalApproval
              key={event.eventId}
              request={event}
              toolCall={toolCall}
              onResolve={(decision) =>
                onResolveTerminalApproval(event.eventId, decision)
              }
            />
          ) : null;
        }
        return (
          <TraceRow
            key={event.eventId}
            event={event}
            reduceMotion={reduceMotion}
          />
        );
      })}
      {showRunStatus ? (
        <div className="flex min-h-8 w-fit items-center gap-2">
          {live ? (
            <ActivityIndicator active={activelyWorking} />
          ) : state === "failed" ? (
            <CircleAlert className="size-3.5 text-negative" aria-hidden />
          ) : null}
          <SessionRunActivityLabel
            live={live}
            nextActivity={nextActivity}
            reduceMotion={reduceMotion}
          />
          <span className="text-sm tabular-nums text-muted-foreground">
            {completed ? "Worked for " : null}
            <RunDurationText
              active={live}
              endedAt={endedAt}
              startedAt={startedAt}
            />
          </span>
        </div>
      ) : null}
    </section>
  );
}

export const SessionThread = memo(function SessionThread({
  events,
  onResolveTerminalApproval,
  planPresentation,
  sessionId,
}: {
  events: readonly SessionTranscriptEvent[];
  onResolveTerminalApproval(
    approvalRequestEventId: string,
    selection: ToolApprovalSelection,
  ): Promise<void>;
  planPresentation: SessionPlanPresentation;
  sessionId: string;
}): ReactNode {
  const reduceMotion = useReducedMotion() === true;
  const blocks = useMemo(() => buildSessionTranscriptBlocks(events), [events]);
  const streamingRunIds = useMemo(
    () =>
      new Set(
        events.flatMap((event) =>
          event.eventType === "message" &&
          event.role === "assistant" &&
          event.status === "streaming" &&
          event.agentRunId
            ? [event.agentRunId]
            : [],
        ),
      ),
    [events],
  );

  return (
    <div className="flex w-full flex-col [&>*:last-child]:mb-0">
      {blocks.map((block) =>
        block.kind === "message" ? (
          <Message
            key={block.event.eventId}
            event={block.event}
            completedPlan={planPresentation.completedPlanByMessageEventId.get(
              block.event.eventId,
            )}
            reduceMotion={reduceMotion}
            sessionId={sessionId}
          />
        ) : (
          <RunTrace
            key={block.runId}
            assistantStreaming={streamingRunIds.has(block.runId)}
            block={block}
            onResolveTerminalApproval={onResolveTerminalApproval}
            reduceMotion={reduceMotion}
            sessionId={sessionId}
          />
        ),
      )}
    </div>
  );
});
