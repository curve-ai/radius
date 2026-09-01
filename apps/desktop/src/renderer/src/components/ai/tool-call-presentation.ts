import type { SessionTranscriptEvent } from "../../../../radius-api";

type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type ToolCallEvent = Extract<
  SessionTranscriptEvent,
  { eventType: "tool_call" }
>;
export type ToolProgressEvent = Extract<
  SessionTranscriptEvent,
  { eventType: "tool_progress" }
>;
export type ToolResultEvent = Extract<
  SessionTranscriptEvent,
  { eventType: "tool_result" }
>;

export interface ToolCallDetail {
  label: string;
  text: string;
}

export interface ToolCallPresentation {
  active: boolean;
  details: ToolCallDetail[];
  endedAt: string | null;
  failed: boolean;
  title: string;
}

function record(value: JsonValue): Record<string, JsonValue> | null {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? value
    : null;
}

function latestValue(
  progress: readonly ToolProgressEvent[],
  key: string,
): JsonValue | undefined {
  for (let index = progress.length - 1; index >= 0; index -= 1) {
    const value = record(progress[index]!.progress)?.[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

function pretty(value: JsonValue): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  return JSON.stringify(value, null, 2);
}

function shellWord(value: string): string {
  return /^[a-zA-Z0-9_./:=@%+,-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

function commandText(value: JsonValue): string | null {
  const input = record(value);
  if (!input || typeof input.command !== "string") return null;
  const args = Array.isArray(input.args)
    ? input.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  return [input.command, ...args].map(shellWord).join(" ");
}

function contentText(value: JsonValue | undefined): string | null {
  if (!Array.isArray(value)) return null;
  const text = value.flatMap((entry) => {
    const item = record(entry);
    if (!item || item.type !== "content") return [];
    const content = record(item.content);
    return content?.type === "text" && typeof content.text === "string"
      ? [content.text]
      : [];
  });
  return text.join("\n").trim() || null;
}

function detailLabel(capability: string): string {
  if (capability === "shell" || capability === "acp.execute") return "Shell";
  if (capability === "workspace.files" || capability.startsWith("acp.")) {
    return "Tool";
  }
  return capability;
}

export function toolCallPresentation(
  call: ToolCallEvent,
  progress: readonly ToolProgressEvent[],
  result: ToolResultEvent | undefined,
): ToolCallPresentation {
  const updatedTitle = latestValue(progress, "title");
  const title =
    typeof updatedTitle === "string" && updatedTitle.trim()
      ? updatedTitle.trim()
      : call.operation;
  const updatedStatus = latestValue(progress, "status");
  const active =
    !result && updatedStatus !== "completed" && updatedStatus !== "failed";
  const failed = result?.outcome === "failed" || updatedStatus === "failed";
  const rawInput = latestValue(progress, "rawInput") ?? call.input;
  const rawOutput =
    result?.output ?? latestValue(progress, "rawOutput") ?? null;
  const command = commandText(rawInput);
  const toolContent = contentText(latestValue(progress, "content"));
  const outputRecord = record(rawOutput);
  const output =
    (outputRecord && typeof outputRecord.output === "string"
      ? outputRecord.output.trim()
      : null) ??
    contentText(outputRecord?.content) ??
    pretty(rawOutput);
  const details: ToolCallDetail[] = [];

  if (command) {
    details.push({
      label: detailLabel(call.capability),
      text: `$ ${command}${output ? `\n\n${output}` : ""}`,
    });
  } else {
    const input = pretty(rawInput);
    if (input) details.push({ label: "Input", text: input });
    if (toolContent) details.push({ label: "Progress", text: toolContent });
    if (output) details.push({ label: "Output", text: output });
  }

  return {
    active,
    details,
    endedAt: result?.occurredAt ?? null,
    failed,
    title,
  };
}
