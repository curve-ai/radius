import {
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  FileTerminal,
  MessageSquareText,
  Wrench,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { SessionTranscriptEvent } from "../../../../radius-api";
import { Button } from "@renderer/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip";
import { cn } from "@renderer/lib/utils";
import {
  buildSessionTranscriptBlocks,
  isTerminalRunState,
  type SessionPlan,
  type SessionPlanPresentation,
  type SessionTranscriptBlock,
} from "./session-transcript";
import { PlanProgress } from "./plan-progress";

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
    eventType: "reasoning_summary" | "message" | "tool_call" | "error";
  }
>;
type ToolOutcome = Extract<
  SessionTranscriptEvent,
  { eventType: "tool_result" }
>["outcome"];

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

function ThinkingGrid(): ReactNode {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]"
    >
      {Array.from({ length: 9 }, (_, index) => {
        const row = Math.floor(index / 3);
        const column = index % 3;
        const delay = (column + Math.abs(row - 1)) * 90;
        return (
          <span
            key={index}
            className="radius-thinking-pixel size-1 rounded-[1px] bg-foreground"
            style={{ "--thinking-delay": `${delay}ms` } as CSSProperties}
          />
        );
      })}
    </span>
  );
}

function Message({
  event,
  completedPlan,
}: {
  event: MessageEvent;
  completedPlan?: SessionPlan;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const user = event.role === "user";
  const system =
    event.role === "system" || event.messageKind === "system_notice";

  const copyMarkdown = async (): Promise<void> => {
    await navigator.clipboard.writeText(event.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  if (!event.text) return null;

  return (
    <article
      aria-label={
        system ? "System message" : user ? "Your message" : "Assistant message"
      }
      className={cn("group/message mb-6 flex w-full", user && "justify-end")}
    >
      <div
        className={cn(
          "min-w-0 whitespace-pre-wrap text-sm leading-6 text-foreground",
          user && "max-w-[88%] rounded-md bg-muted px-3 py-2.5",
          system &&
            "w-full rounded-md border border-border bg-card px-3 py-2.5 text-muted-foreground",
          !user && !system && "w-full",
        )}
      >
        {event.text}
        {!user && !system ? (
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
                  {copied ? (
                    <Check className="size-3" aria-hidden />
                  ) : (
                    <Copy className="size-3" aria-hidden />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {copied ? "Markdown copied" : "Copy markdown"}
              </TooltipContent>
            </Tooltip>
            {completedPlan ? (
              <PlanProgress plan={completedPlan} placement="message" />
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
  outcome,
}: {
  event: TraceRowEvent;
  outcome?: ToolOutcome;
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const isError = event.eventType === "error";
  const isToolCall = event.eventType === "tool_call";

  const icon =
    event.eventType === "reasoning_summary" ? (
      <Brain className="size-3.5 shrink-0" aria-hidden />
    ) : event.eventType === "message" ? (
      <MessageSquareText className="size-3.5 shrink-0" aria-hidden />
    ) : isError ? (
      <CircleAlert className="size-3.5 shrink-0" aria-hidden />
    ) : event.capability.includes("file") ? (
      <FileTerminal className="size-3.5 shrink-0" aria-hidden />
    ) : (
      <Wrench className="size-3.5 shrink-0" aria-hidden />
    );

  const content = isToolCall ? (
    <>
      <span className="text-foreground">{event.operation}</span>
      <span className="ml-2 font-mono text-[0.6875rem] text-muted-foreground">
        {event.capability}
      </span>
    </>
  ) : event.eventType === "reasoning_summary" ? (
    event.summaryText
  ) : event.eventType === "message" ? (
    event.text
  ) : (
    event.message
  );

  return (
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
      <span className={cn("shrink-0", expanded && "mt-0.5")}>{icon}</span>
      <span
        className={cn(
          "min-w-0 flex-1",
          expanded ? "break-words whitespace-normal" : "truncate",
        )}
      >
        {content}
      </span>
      {outcome ? (
        <span
          className={cn(
            "ml-auto shrink-0 text-[0.6875rem]",
            expanded && "mt-0.5",
            outcome === "failed" && "text-negative",
          )}
        >
          {outcome}
        </span>
      ) : null}
      <ChevronDown
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
          expanded && "mt-0.5 rotate-180",
        )}
        aria-hidden
      />
    </button>
  );
}

function RunTrace({
  block,
}: {
  block: Extract<SessionTranscriptBlock, { kind: "run" }>;
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
  const working = !isTerminalRunState(state);
  const presentation = block.events
    .filter(
      (event): event is RunPresentationEvent =>
        event.eventType === "agent_run_presentation",
    )
    .at(-1);
  const endedAt = latestState && !working ? latestState.occurredAt : null;
  const settledDuration = formatElapsed(
    Date.parse(endedAt ?? startedAt) - Date.parse(startedAt),
  );
  const liveDuration = useElapsed(startedAt, working);
  const duration = working ? liveDuration : settledDuration;
  const [expanded, setExpanded] = useState(false);
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
          .map((event) => [event.toolCallEventId, event.outcome]),
      ),
    [block.events],
  );
  const rows = block.events.filter(
    (event): event is TraceRowEvent =>
      event.eventType === "reasoning_summary" ||
      (event.eventType === "message" && event.messageKind === "progress") ||
      event.eventType === "tool_call" ||
      event.eventType === "error",
  );
  const canExpand = rows.length > 0;
  const label = runLabel(state, presentation);
  const completed = state === "completed";

  const header = (
    <>
      {working ? (
        <ThinkingGrid />
      ) : state === "failed" ? (
        <CircleAlert className="size-3.5 text-negative" aria-hidden />
      ) : null}
      <span
        role={working ? "status" : undefined}
        className={cn(
          "text-sm font-normal",
          working ? "radius-thinking-label" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span className="text-sm font-normal tabular-nums text-muted-foreground">
        {completed ? `Worked for ${duration}` : duration}
      </span>
      {canExpand ? (
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground transition-transform duration-200",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      ) : null}
    </>
  );

  return (
    <section
      aria-label="Agent work"
      className="mb-3 w-full border-b border-border"
    >
      {canExpand ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className={cn(
            "-ml-1.5 flex min-h-7 w-fit gap-2 rounded-sm px-1.5 text-left transition-colors duration-150 hover:bg-accent active:scale-[0.99]",
            working || state === "failed" ? "items-center" : "items-baseline",
          )}
        >
          {header}
        </button>
      ) : (
        <div
          className={cn(
            "flex min-h-7 w-fit gap-2",
            working || state === "failed" ? "items-center" : "items-baseline",
          )}
        >
          {header}
        </div>
      )}

      {canExpand ? (
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
            <div className="ml-[5px] mt-1 max-h-64 overflow-y-auto overscroll-contain border-l border-border pb-1 pl-[1.125rem] pr-1">
              <div className="flex flex-col gap-0.5">
                {rows.map((event) => {
                  return (
                    <TraceRow
                      key={event.eventId}
                      event={event}
                      outcome={resultByToolCall.get(event.eventId)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function SessionThread({
  events,
  planPresentation,
}: {
  events: readonly SessionTranscriptEvent[];
  planPresentation: SessionPlanPresentation;
}): ReactNode {
  const blocks = useMemo(() => buildSessionTranscriptBlocks(events), [events]);

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
          />
        ) : (
          <RunTrace key={block.runId} block={block} />
        ),
      )}
    </div>
  );
}
