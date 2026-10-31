/** ACP agent that drives LangGraph graphs. */

import {
  PROTOCOL_VERSION,
  RequestError,
  agent,
  methods,
  type AgentApp,
  type AgentContext,
} from "@agentclientprotocol/sdk";
import type * as schema from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";

import type {
  InterruptLike,
  LoadedGraph,
  RunnableGraph,
  StateSnapshotLike,
} from "./loader.js";
import type { ProjectLibraries } from "./project.js";
import { VERSION } from "./version.js";

export const AGENT_NAME = "radius-langgraph";
const AFFIRMATIVE = new Set([
  "y",
  "yes",
  "ok",
  "okay",
  "approve",
  "approved",
  "allow",
  "accept",
  "continue",
]);

interface Session {
  readonly id: string;
  mode: string;
  /** The turn in progress, which the next prompt waits behind. */
  queue: Promise<unknown>;
  abort?: AbortController;
}

const CANCELLED = Symbol("cancelled");
const UNSUPPORTED = Symbol("unsupported");

/** A LangChain message from the project's copy, read structurally. */
interface MessageLike {
  readonly content: unknown;
  readonly tool_calls?: ReadonlyArray<{
    readonly id?: string;
    readonly name: string;
    readonly args?: unknown;
  }>;
  readonly tool_call_id?: string;
  readonly status?: string;
  getType?(): string;
  _getType?(): string;
}

function isMessage(value: unknown): value is MessageLike {
  if (typeof value !== "object" || value === null) return false;
  const message = value as MessageLike;
  return (
    typeof message.getType === "function" ||
    typeof message._getType === "function"
  );
}

function messageType(message: MessageLike): string {
  return message.getType?.() ?? message._getType?.() ?? "";
}

export function messageText(message: MessageLike): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") parts.push(block);
    else if (isObject(block) && block.type === "text") {
      parts.push(String(block.text ?? ""));
    }
  }
  return parts.join("");
}

function messageThoughts(message: MessageLike): string {
  if (!Array.isArray(message.content)) return "";
  const parts: string[] = [];
  for (const block of message.content) {
    if (!isObject(block)) continue;
    if (block.type === "thinking") parts.push(String(block.thinking ?? ""));
    else if (block.type === "reasoning") {
      parts.push(String(block.reasoning ?? ""));
    }
  }
  return parts.join("");
}

export function promptText(prompt: readonly schema.ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of prompt) {
    if (block.type === "text") parts.push(block.text);
    else if (block.type === "resource_link") {
      parts.push(`[${block.name}](${block.uri})`);
    } else if (block.type === "resource") {
      const resource = block.resource;
      if ("text" in resource && typeof resource.text === "string") {
        parts.push(
          `<resource uri=${JSON.stringify(resource.uri)}>\n${resource.text}\n</resource>`,
        );
      }
    }
  }
  return parts.join("\n");
}

function messagesIn(update: unknown): MessageLike[] {
  if (isMessage(update)) return [update];
  if (Array.isArray(update)) return update.flatMap(messagesIn);
  if (!isObject(update)) return [];
  if (update.lg_name === "Command") return messagesIn(update.update);
  const messages = update.messages;
  if (messages == null) return [];
  return (Array.isArray(messages) ? messages : [messages]).filter(isMessage);
}

function jsonSafe(value: unknown): unknown {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? null : JSON.parse(text);
  } catch {
    return String(value);
  }
}

/**
 * The actions of a LangChain human-in-the-loop request. Python's middleware
 * spells it `action_requests`, the JavaScript one `actionRequests`.
 */
function hitlActions(value: unknown): unknown[] | undefined {
  if (!isObject(value)) return undefined;
  const actions = value.actionRequests ?? value.action_requests;
  return Array.isArray(actions) ? actions : undefined;
}

function interruptTitle(value: unknown): string {
  if (typeof value === "string") return value;
  const actions = hitlActions(value);
  if (actions) {
    const names = actions.map((action) =>
      String((isObject(action) && action.name) || "action"),
    );
    return `Approve ${names.join(", ")}`;
  }
  if (isObject(value)) {
    for (const key of [
      "question",
      "message",
      "description",
      "title",
      "prompt",
    ]) {
      if (typeof value[key] === "string") return value[key] as string;
    }
  }
  const text = JSON.stringify(jsonSafe(value));
  return text.length <= 200 ? text : `${text.slice(0, 197)}...`;
}

function customOptions(value: unknown): string[] | undefined {
  if (!isObject(value) || !Array.isArray(value.options)) return undefined;
  const options = value.options.map(String);
  return options.length > 0 ? options : undefined;
}

function hitlResume(
  actions: readonly unknown[],
  approved: boolean,
  message: string | undefined,
): { decisions: Record<string, unknown>[] } {
  const decision: Record<string, unknown> = approved
    ? { type: "approve" }
    : { type: "reject" };
  if (!approved && message) decision.message = message;
  return { decisions: actions.map(() => ({ ...decision })) };
}

/** Resume value for an interrupt answered by a plain-text prompt. */
export function resumeFromText(value: unknown, text: string): unknown {
  const answer = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  const affirmative = AFFIRMATIVE.has(answer);
  const actions = hitlActions(value);
  if (actions)
    return hitlResume(actions, affirmative, affirmative ? undefined : text);
  for (const option of customOptions(value) ?? []) {
    if (option.toLowerCase() === text.trim().toLowerCase()) return option;
  }
  return text;
}

function permissionOptions(
  value: unknown,
): [schema.PermissionOption[], (optionId: string) => unknown] {
  const custom = customOptions(value);
  if (custom) {
    return [
      custom.map((option) => ({
        optionId: option,
        name: option,
        kind: ["no", "reject", "deny", "cancel"].includes(option.toLowerCase())
          ? "reject_once"
          : "allow_once",
      })),
      (optionId) => optionId,
    ];
  }
  const options: schema.PermissionOption[] = [
    { optionId: "approve", name: "Approve", kind: "allow_once" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ];
  const actions = hitlActions(value);
  if (actions) {
    return [
      options,
      (optionId) =>
        hitlResume(
          actions,
          optionId === "approve",
          optionId === "approve" ? undefined : "Rejected by user.",
        ),
    ];
  }
  return [options, (optionId) => optionId === "approve"];
}

/** Translates LangGraph stream events into ACP session updates for one turn. */
class Turn {
  readonly openToolCalls = new Map<string, string>();

  constructor(
    readonly client: AgentContext,
    readonly sessionId: string,
  ) {}

  async send(update: schema.SessionUpdate): Promise<void> {
    await this.client.notify(methods.client.session.update, {
      sessionId: this.sessionId,
      update,
    });
  }

  async onMessageChunk(message: unknown): Promise<void> {
    if (!isMessage(message) || messageType(message) !== "ai") return;
    const thoughts = messageThoughts(message);
    if (thoughts) {
      await this.send({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: thoughts },
      });
    }
    const text = messageText(message);
    if (text) {
      await this.send({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      });
    }
  }

  async onUpdate(update: unknown): Promise<void> {
    if (!isObject(update)) return;
    for (const [node, value] of Object.entries(update)) {
      if (node === "__interrupt__") continue;
      for (const message of messagesIn(value)) {
        await this.onToolActivity(message);
      }
    }
  }

  async onToolActivity(message: MessageLike): Promise<void> {
    const type = messageType(message);
    if (type === "ai") {
      for (const call of message.tool_calls ?? []) {
        const callId = call.id;
        if (!callId || this.openToolCalls.has(callId)) continue;
        this.openToolCalls.set(callId, call.name);
        await this.send({
          sessionUpdate: "tool_call",
          toolCallId: callId,
          title: call.name,
          kind: "other",
          status: "in_progress",
          rawInput: jsonSafe(call.args ?? {}),
        });
      }
    } else if (type === "tool" && message.tool_call_id) {
      this.openToolCalls.delete(message.tool_call_id);
      const output = messageText(message);
      await this.send({
        sessionUpdate: "tool_call_update",
        toolCallId: message.tool_call_id,
        status: message.status === "error" ? "failed" : "completed",
        content: [{ type: "content", content: { type: "text", text: output } }],
        rawOutput: output,
      });
    }
  }

  async failOpenToolCalls(): Promise<void> {
    for (const callId of [...this.openToolCalls.keys()]) {
      this.openToolCalls.delete(callId);
      await this.send({
        sessionUpdate: "tool_call_update",
        toolCallId: callId,
        status: "failed",
      });
    }
  }

  async replay(messages: readonly MessageLike[]): Promise<void> {
    for (const message of messages) {
      const type = messageType(message);
      if (type === "human") {
        const text = messageText(message);
        if (text) {
          await this.send({
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text },
          });
        }
      } else if (type === "ai") {
        await this.onMessageChunk(message);
        await this.onToolActivity(message);
      } else if (type === "tool") {
        await this.onToolActivity(message);
      }
    }
  }
}

export interface LangGraphAgentOptions {
  readonly graphs: readonly LoadedGraph[];
  readonly libraries: ProjectLibraries;
  readonly warn?: (message: string) => void;
}

export function createLangGraphAgent({
  graphs: loaded,
  libraries,
  warn = (message) => process.stderr.write(`${message}\n`),
}: LangGraphAgentOptions): AgentApp {
  if (loaded.length === 0) throw new Error("at least one graph is required");
  const graphs = new Map(loaded.map((entry) => [entry.name, entry]));
  const defaultMode = loaded[0]!.name;
  const sessions = new Map<string, Session>();

  const modes = (current: string): schema.SessionModeState => ({
    currentModeId: current,
    availableModes: loaded.map((entry) => ({
      id: entry.name,
      name: entry.name,
      ...(entry.description ? { description: entry.description } : {}),
    })),
  });

  const sessionFor = (sessionId: string): Session => {
    const session = sessions.get(sessionId);
    if (!session) {
      throw RequestError.invalidParams({
        sessionId,
        reason: "unknown session",
      });
    }
    return session;
  };

  // One thread per session; graphs with different state schemas never share a thread.
  const threadId = (mode: string, sessionId: string): string =>
    graphs.size === 1 ? sessionId : `${sessionId}:${mode}`;

  const runConfig = (mode: string, sessionId: string) => ({
    configurable: { thread_id: threadId(mode, sessionId) },
  });

  const readState = async (
    graph: RunnableGraph,
    config: Record<string, unknown>,
  ): Promise<StateSnapshotLike | null> => {
    if (typeof graph.checkpointer !== "object" || graph.checkpointer === null) {
      return null;
    }
    try {
      return await graph.getState(config);
    } catch (error) {
      if ((error as Error | undefined)?.name === "GraphValueError") return null;
      throw error;
    }
  };

  const history = async (
    mode: string,
    sessionId: string,
  ): Promise<MessageLike[] | null> => {
    const state = await readState(
      graphs.get(mode)!.graph,
      runConfig(mode, sessionId),
    );
    if (!state || !hasValues(state.values)) return null;
    const messages = isObject(state.values) ? state.values.messages : undefined;
    return Array.isArray(messages) ? messages.filter(isMessage) : [];
  };

  const pendingInterrupts = async (
    graph: RunnableGraph,
    config: Record<string, unknown>,
  ): Promise<InterruptLike[]> => {
    const state = await readState(graph, config);
    if (!state) return [];
    const interrupts = [...(state.interrupts ?? [])];
    if (interrupts.length === 0) {
      for (const task of state.tasks ?? []) {
        interrupts.push(...(task.interrupts ?? []));
      }
    }
    return interrupts;
  };

  const resumeCommand = (
    answers: ReadonlyArray<[InterruptLike, unknown]>,
  ): unknown => {
    if (answers.length === 1 && answers[0]![0].id == null) {
      return new libraries.Command({ resume: answers[0]![1] });
    }
    return new libraries.Command({
      resume: Object.fromEntries(
        answers.map(([interrupt, value]) => [interrupt.id, value]),
      ),
    });
  };

  const initialInput = async (
    graph: RunnableGraph,
    config: Record<string, unknown>,
    text: string,
  ): Promise<unknown> => {
    const pending = await pendingInterrupts(graph, config);
    if (pending.length > 0) {
      return resumeCommand(
        pending.map((interrupt) => [
          interrupt,
          resumeFromText(interrupt.value, text),
        ]),
      );
    }
    const messages: unknown[] = [];
    const state = await readState(graph, config);
    if (state && isObject(state.values)) {
      const past = state.values.messages;
      if (Array.isArray(past)) {
        messages.push(
          ...danglingToolResults(past.filter(isMessage), libraries),
        );
      }
    }
    messages.push(new libraries.HumanMessage({ content: text }));
    return { messages };
  };

  const askPermission = async (
    turn: Turn,
    interrupt: InterruptLike,
    signal: AbortSignal,
  ): Promise<unknown> => {
    const value = interrupt.value;
    const title = interruptTitle(value);
    const [options, resolveOption] = permissionOptions(value);

    let callId: string;
    let synthesized: boolean;
    if (turn.openToolCalls.size === 1) {
      callId = turn.openToolCalls.keys().next().value!;
      synthesized = false;
    } else {
      callId = `interrupt-${interrupt.id ?? randomUUID().replaceAll("-", "")}`;
      synthesized = true;
      await turn.send({
        sessionUpdate: "tool_call",
        toolCallId: callId,
        title,
        kind: "other",
        status: "pending",
        rawInput: jsonSafe(value),
      });
    }

    let response: schema.RequestPermissionResponse;
    try {
      response = await abortable(
        turn.client.request(
          methods.client.session.requestPermission,
          {
            sessionId: turn.sessionId,
            toolCall: { toolCallId: callId, title, rawInput: jsonSafe(value) },
            options,
          },
          { cancellationSignal: signal },
        ),
        signal,
      );
    } catch (error) {
      if (signal.aborted) throw error;
      if (!(error instanceof RequestError)) throw error;
      warn(
        `radius-langgraph: request_permission failed (${error.message}); asking in text instead`,
      );
      if (synthesized) {
        await turn.send({
          sessionUpdate: "tool_call_update",
          toolCallId: callId,
          status: "failed",
        });
      }
      return UNSUPPORTED;
    }

    const outcome = response.outcome;
    if (outcome.outcome !== "selected") {
      if (synthesized) {
        await turn.send({
          sessionUpdate: "tool_call_update",
          toolCallId: callId,
          status: "failed",
        });
      }
      return CANCELLED;
    }
    const answer = resolveOption(outcome.optionId);
    if (synthesized) {
      await turn.send({
        sessionUpdate: "tool_call_update",
        toolCallId: callId,
        status: "completed",
        rawOutput: jsonSafe(answer),
      });
    }
    return answer;
  };

  const askInText = async (
    turn: Turn,
    pending: readonly InterruptLike[],
  ): Promise<void> => {
    const lines = ["The graph is waiting for input:"];
    for (const interrupt of pending) {
      let line = `- ${interruptTitle(interrupt.value)}`;
      const options = customOptions(interrupt.value);
      if (options) line += ` (options: ${options.join(", ")})`;
      lines.push(line);
    }
    lines.push("Reply to continue.");
    await turn.send({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: lines.join("\n") },
    });
  };

  const runTurn = async (
    client: AgentContext,
    session: Session,
    text: string,
    signal: AbortSignal,
  ): Promise<schema.StopReason> => {
    const graph = graphs.get(session.mode)!.graph;
    const config = runConfig(session.mode, session.id);
    const turn = new Turn(client, session.id);
    let input = await initialInput(graph, config, text);
    try {
      for (;;) {
        const stream = await graph.stream(input, {
          ...config,
          streamMode: ["messages", "updates"],
          signal,
        });
        for await (const event of stream) {
          const [mode, data] = event as [string, unknown];
          if (mode === "messages") {
            await turn.onMessageChunk((data as unknown[])[0]);
          } else if (mode === "updates") {
            await turn.onUpdate(data);
          }
        }
        if (signal.aborted) throw signal.reason;

        const pending = await pendingInterrupts(graph, config);
        if (pending.length === 0) return "end_turn";
        const answers: Array<[InterruptLike, unknown]> = [];
        for (const interrupt of pending) {
          const answer = await askPermission(turn, interrupt, signal);
          if (answer === CANCELLED) return "cancelled";
          if (answer === UNSUPPORTED) {
            await askInText(turn, pending);
            return "end_turn";
          }
          answers.push([interrupt, answer]);
        }
        input = resumeCommand(answers);
      }
    } catch (error) {
      await turn.failOpenToolCalls();
      throw error;
    }
  };

  return agent({ name: AGENT_NAME })
    .onRequest(methods.agent.initialize, ({ params }) => ({
      protocolVersion: Math.min(params.protocolVersion, PROTOCOL_VERSION),
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: true,
        },
      },
      agentInfo: { name: AGENT_NAME, title: "LangGraph", version: VERSION },
    }))
    .onRequest(methods.agent.session.new, () => {
      const session: Session = {
        id: randomUUID().replaceAll("-", ""),
        mode: defaultMode,
        queue: Promise.resolve(),
      };
      sessions.set(session.id, session);
      return { sessionId: session.id, modes: modes(session.mode) };
    })
    .onRequest(methods.agent.session.load, async ({ params, client }) => {
      let mode = defaultMode;
      let messages: MessageLike[] = [];
      const order = [
        defaultMode,
        ...[...graphs.keys()].filter((name) => name !== defaultMode),
      ];
      for (const name of order) {
        const found = await history(name, params.sessionId);
        if (found !== null) {
          mode = name;
          messages = found;
          break;
        }
      }
      const session = sessions.get(params.sessionId) ?? {
        id: params.sessionId,
        mode,
        queue: Promise.resolve(),
      };
      session.mode = mode;
      sessions.set(params.sessionId, session);
      if (messages.length > 0) {
        await new Turn(client, params.sessionId).replay(messages);
      }
      return { modes: modes(mode) };
    })
    .onRequest(methods.agent.session.setMode, ({ params }) => {
      const session = sessionFor(params.sessionId);
      if (!graphs.has(params.modeId)) {
        throw RequestError.invalidParams({
          modeId: params.modeId,
          availableModes: [...graphs.keys()],
        });
      }
      session.mode = params.modeId;
      return {};
    })
    .onRequest(
      methods.agent.session.prompt,
      async ({ params, client, signal: requestSignal }) => {
        const session = sessionFor(params.sessionId);
        const previous = session.queue;
        let release!: () => void;
        session.queue = new Promise<void>((resolve) => (release = resolve));
        await previous;
        const abort = new AbortController();
        const onRequestAbort = () => abort.abort(requestSignal.reason);
        requestSignal.addEventListener("abort", onRequestAbort, { once: true });
        session.abort = abort;
        try {
          const stopReason = await runTurn(
            client,
            session,
            promptText(params.prompt),
            abort.signal,
          );
          return { stopReason };
        } catch (error) {
          // A cancel from the client ends the turn; a dropped connection or
          // a graph error is still an error.
          if (abort.signal.aborted && !requestSignal.aborted) {
            return { stopReason: "cancelled" as const };
          }
          throw error;
        } finally {
          requestSignal.removeEventListener("abort", onRequestAbort);
          session.abort = undefined;
          release();
        }
      },
    )
    .onNotification(methods.agent.session.cancel, ({ params }) => {
      sessions.get(params.sessionId)?.abort?.abort(new CancelledError());
    });
}

class CancelledError extends Error {
  override name = "AbortError";
  constructor() {
    super("cancelled by the client");
  }
}

/** Rejects as soon as `signal` aborts, even if `promise` never settles. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Tool results for calls a cancelled turn never answered, so providers accept the history. */
function danglingToolResults(
  history: readonly MessageLike[],
  libraries: ProjectLibraries,
): unknown[] {
  const lastAi = [...history]
    .reverse()
    .find((message) => messageType(message) === "ai");
  if (!lastAi?.tool_calls?.length) return [];
  const answered = new Set(
    history
      .filter((message) => messageType(message) === "tool")
      .map((message) => message.tool_call_id),
  );
  return lastAi.tool_calls
    .filter((call) => call.id && !answered.has(call.id))
    .map(
      (call) =>
        new libraries.ToolMessage({
          content: "Cancelled before completion.",
          tool_call_id: call.id!,
          name: call.name,
          status: "error",
        }),
    );
}

function hasValues(values: unknown): boolean {
  if (values == null) return false;
  if (isObject(values)) return Object.keys(values).length > 0;
  return true;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
