import type { SessionTranscriptEvent } from "../../../../radius-api";

export function sessionTranscriptAsMarkdown(
  title: string,
  events: readonly SessionTranscriptEvent[],
): string {
  const messages = events.filter(
    (
      event,
    ): event is Extract<SessionTranscriptEvent, { eventType: "message" }> =>
      event.eventType === "message" &&
      event.messageKind !== "progress" &&
      event.status !== "streaming",
  );
  const sections = messages.map((event) => {
    const label =
      event.role === "user"
        ? "You"
        : event.role === "assistant"
          ? "Assistant"
          : "System";
    return `## ${label}\n\n${event.text.trim()}`;
  });

  return [`# ${title.trim()}`, ...sections].join("\n\n").trimEnd();
}
