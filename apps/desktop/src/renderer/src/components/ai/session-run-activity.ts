import {
  SESSION_RUN_ACTIVITY_DETAIL,
  type SessionTranscriptEvent,
} from "../../../../radius-api";

type RunStateEvent = Extract<
  SessionTranscriptEvent,
  { eventType: "agent_run_state_update" }
>;
type ToolCallEvent = Extract<
  SessionTranscriptEvent,
  { eventType: "tool_call" }
>;

export interface SessionRunActivity {
  key: string;
  label: string;
}

const STARTUP_ACTIVITY_BY_DETAIL = new Map<string, SessionRunActivity>([
  [
    SESSION_RUN_ACTIVITY_DETAIL.startingFxAgent,
    { key: "starting-agent", label: "Starting local agent" },
  ],
  [
    SESSION_RUN_ACTIVITY_DETAIL.connectingAgent,
    { key: "connecting-agent", label: "Connecting to agent" },
  ],
  [
    SESSION_RUN_ACTIVITY_DETAIL.startingLocalAgent,
    { key: "starting-agent", label: "Starting local agent" },
  ],
  [
    SESSION_RUN_ACTIVITY_DETAIL.resumingWork,
    { key: "resuming-work", label: "Resuming work" },
  ],
]);

function activityForToolCall(event: ToolCallEvent): SessionRunActivity {
  return {
    key: `tool:${event.eventId}`,
    label: event.operation,
  };
}

function latestOpenToolCall(
  events: readonly SessionTranscriptEvent[],
): ToolCallEvent | null {
  const completedToolCallIds = new Set(
    events.flatMap((event) =>
      event.eventType === "tool_result" ? [event.toolCallEventId] : [],
    ),
  );

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.eventType === "tool_call" &&
      !completedToolCallIds.has(event.eventId)
    ) {
      return event;
    }
  }
  return null;
}

function latestRunState(
  events: readonly SessionTranscriptEvent[],
): RunStateEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.eventType === "agent_run_state_update") return event;
  }
  return null;
}

export function deriveWorkingRunActivity(
  events: readonly SessionTranscriptEvent[],
  assistantStreaming: boolean,
): SessionRunActivity {
  const toolCall = latestOpenToolCall(events);
  if (toolCall) return activityForToolCall(toolCall);

  if (assistantStreaming) {
    return { key: "writing-response", label: "Writing response" };
  }

  const detail = latestRunState(events)?.detail;
  if (detail) {
    const startupActivity = STARTUP_ACTIVITY_BY_DETAIL.get(detail);
    if (startupActivity) return startupActivity;
  }

  return { key: "thinking", label: "Thinking" };
}
