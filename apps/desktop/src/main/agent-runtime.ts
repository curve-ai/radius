import {
  appendSessionEvent,
  createSession,
  getSessionProjectContext,
  getSessionRevision,
  installAgentRelease,
  listProjects,
  listSessionTranscript,
  type RadiusDatabase,
  type InstalledAgentRelease,
  type SessionTranscriptEventRecord,
} from "@curve-ai/radius-storage";
import {
  AcpRuntimeSession,
  MicrovmAcpRuntime,
  acpStreamFromWebSocket,
  parseAgentReleaseDescriptor,
  type AcpRuntimeHandlers,
  type AgentReleaseDescriptor,
  type AcpRuntimePromptResult,
  type DevelopmentAgentConnection,
  type RequestPermissionRequest,
  type MicrovmRuntimePaths,
  type SessionUpdate,
} from "@curve-ai/radius-runtime";
import {
  startBrowserToolServer,
  type BrowserToolServer,
} from "@curve-ai/radius-browser-tools";
import type { BrowserBridgeOperation } from "@curve-ai/radius-browser-protocol";
import { app, BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type {
  DesktopAgentSummary,
  DesktopRuntimeStatus,
  SessionTranscriptStreamUpdate,
  StartAgentPromptInput,
  StartAgentPromptResult,
  StreamingSessionTranscriptMessage,
} from "../radius-api";
import { SESSION_TRANSCRIPT_STREAM_CHANNEL } from "../radius-api";
import {
  agentPlanJournalEvents,
  createAgentPlanJournalState,
  type AgentPlanJournalState,
} from "./agent-plan-events";
import { localDeviceIdentity } from "./device-identity";
import {
  connectFxCodex,
  disconnectFxCodex,
  getFxAuthenticationStatus,
  isFxRelease,
  prepareFxRuntimeProfile,
  type FxRuntimeProfileLease,
} from "./fx-auth";
import { initializeStorage, type StorageContext } from "./storage";
import { resolveAgentReleasePaths } from "./bundled-agents";
import { browserBridge } from "./browser-bridge";
import { listDevelopmentAgentConnections } from "./development-agents";
import {
  HostFileSystemManager,
  type FileAccessResult,
  type FileAuthorizationRequest,
} from "./file-system-access";
import {
  MacOsTerminalManager,
  type TerminalAuthorizationRequest,
  type TerminalExecutionResult,
} from "./terminal-execution";

type SessionEvent = Parameters<typeof appendSessionEvent>[1];
type SessionEventBody = SessionEvent extends infer Event
  ? Event extends SessionEvent
    ? Omit<
        Event,
        | "sessionId"
        | "sessionRevision"
        | "sourceClientInstanceId"
        | "occurredAt"
        | "artifactLinks"
      >
    : never
  : never;
type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface RuntimeUpdateState {
  hostToolKinds: Set<string>;
  plan: AgentPlanJournalState;
  toolCallEventIds: Map<string, string>;
}
type StreamedMessageEvent = NonNullable<SessionTranscriptStreamUpdate["event"]>;
type AgentTarget =
  | { kind: "development"; connection: DevelopmentAgentConnection }
  | { kind: "release"; release: AgentReleaseDescriptor };
interface RunningAgentRuntime {
  prompt(text: string): Promise<AcpRuntimePromptResult>;
  cancel(): Promise<void>;
  stop(): Promise<void>;
}

let runtimeErrorCode: string | null = null;
const runningSessions = new Map<string, RunningAgentRuntime>();
const runningTerminalManagers = new Map<string, MacOsTerminalManager>();
const workingSessions = new Set<string>();
const streamingSessionMessages = new Map<
  string,
  StreamingSessionTranscriptMessage
>();

type TerminalApprovalDecision = "approved" | "denied" | "cancelled" | "expired";

interface PendingTerminalApproval {
  sessionId: string;
  exactReason: string;
  exactToolInput: JsonValue;
  toolCallEventId: string;
  decide(decision: TerminalApprovalDecision): Promise<void>;
}

const pendingTerminalApprovals = new Map<string, PendingTerminalApproval>();
const TERMINAL_APPROVAL_TIMEOUT_MS = 10 * 60 * 1_000;

function broadcastSessionTranscriptStream(
  update: SessionTranscriptStreamUpdate,
): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(SESSION_TRANSCRIPT_STREAM_CHANNEL, update);
  }
}

function publishStreamingSessionMessage(
  sessionId: string,
  event: StreamingSessionTranscriptMessage,
  textDelta: string,
  textOffset: number,
): void {
  streamingSessionMessages.set(sessionId, event);
  broadcastSessionTranscriptStream({
    sessionId,
    eventId: event.eventId,
    event: { ...event, text: textDelta },
    mode: "append",
    textOffset,
  });
}

function clearStreamingSessionMessage(sessionId: string): void {
  const event = streamingSessionMessages.get(sessionId);
  if (!event) return;

  streamingSessionMessages.delete(sessionId);
  broadcastSessionTranscriptStream({
    sessionId,
    eventId: event.eventId,
    event: null,
    mode: "replace",
  });
}

export function getStreamingSessionMessage(
  sessionId: string,
): StreamingSessionTranscriptMessage | null {
  return streamingSessionMessages.get(sessionId) ?? null;
}

export function overlayPendingHostApprovalDetails(
  sessionId: string,
  events: readonly SessionTranscriptEventRecord[],
): SessionTranscriptEventRecord[] {
  const pending = [...pendingTerminalApprovals.entries()].filter(
    ([, approval]) => approval.sessionId === sessionId,
  );
  if (pending.length === 0) return [...events];
  const toolInputByEventId = new Map(
    pending.map(([, approval]) => [
      approval.toolCallEventId,
      approval.exactToolInput,
    ]),
  );
  const reasonByEventId = new Map(
    pending.map(([approvalRequestEventId, approval]) => [
      approvalRequestEventId,
      approval.exactReason,
    ]),
  );
  return events.map((event) => {
    if (event.eventType === "tool_call") {
      const input = toolInputByEventId.get(event.eventId);
      return input ? { ...event, input } : event;
    }
    if (event.eventType === "approval_request") {
      const reason = reasonByEventId.get(event.eventId);
      return reason ? { ...event, reason } : event;
    }
    return event;
  });
}

export async function resolveTerminalApproval(
  rawInput: unknown,
): Promise<void> {
  if (!rawInput || typeof rawInput !== "object") {
    throw new Error("Terminal approval decision is invalid");
  }
  const input = rawInput as Record<string, unknown>;
  if (typeof input.sessionId !== "string" || !input.sessionId) {
    throw new Error("Terminal approval session is required");
  }
  if (
    typeof input.approvalRequestEventId !== "string" ||
    !input.approvalRequestEventId
  ) {
    throw new Error("Terminal approval request is required");
  }
  if (input.decision !== "approved" && input.decision !== "denied") {
    throw new Error("Terminal approval decision must be approved or denied");
  }
  const pending = pendingTerminalApprovals.get(input.approvalRequestEventId);
  if (!pending || pending.sessionId !== input.sessionId) {
    throw new Error("Terminal approval request is no longer pending");
  }
  await pending.decide(input.decision);
}

async function cancelPendingTerminalApprovals(
  sessionId: string,
): Promise<void> {
  const pending = [...pendingTerminalApprovals.values()].filter(
    (approval) => approval.sessionId === sessionId,
  );
  await Promise.all(pending.map((approval) => approval.decide("cancelled")));
}

export function isAgentSessionWorking(sessionId: string): boolean {
  return workingSessions.has(sessionId);
}

function markSessionWorking(sessionId: string): void {
  workingSessions.add(sessionId);
}

function clearSessionWorking(sessionId: string): void {
  workingSessions.delete(sessionId);
}

export async function listDesktopAgents(): Promise<DesktopAgentSummary[]> {
  const [releases, developmentConnections] = await Promise.all([
    loadConfiguredReleases(),
    listDevelopmentAgentConnections(),
  ]);
  if (releases.length === 0 && developmentConnections.length === 0) return [];
  const context = await initializeStorage();
  const developmentAgentIds = new Set(
    developmentConnections.map((connection) => connection.agentId),
  );
  const agents = developmentConnections.map(developmentAgentSummary);
  for (const release of releases.filter(
    (candidate) => !developmentAgentIds.has(candidate.agentId),
  )) {
    const installation = await ensureAgentInstallation(context, release);
    const authentication = isFxRelease(release)
      ? await getFxAuthenticationStatus(context, installation.installationId, {
          preferCachedDuringRuntime: true,
        })
      : null;
    agents.push(desktopAgentSummary(release, authentication));
  }
  return agents;
}

export async function connectAgentAuthentication(
  agentId: string,
): Promise<DesktopAgentSummary> {
  const release = await requireAgentRelease(agentId);
  if (!isFxRelease(release))
    throw new Error("AGENT_AUTHENTICATION_UNSUPPORTED");
  const context = await initializeStorage();
  const installation = await ensureAgentInstallation(context, release);
  const authentication = await connectFxCodex(
    context,
    installation.installationId,
  );
  return desktopAgentSummary(release, authentication);
}

export async function disconnectAgentAuthentication(
  agentId: string,
): Promise<DesktopAgentSummary> {
  const release = await requireAgentRelease(agentId);
  if (!isFxRelease(release))
    throw new Error("AGENT_AUTHENTICATION_UNSUPPORTED");
  const context = await initializeStorage();
  const installation = await ensureAgentInstallation(context, release);
  const authentication = await disconnectFxCodex(
    context,
    installation.installationId,
  );
  return desktopAgentSummary(release, authentication);
}

export async function getDesktopRuntimeStatus(): Promise<DesktopRuntimeStatus> {
  const [developmentConnections, releases] = await Promise.all([
    listDevelopmentAgentConnections(),
    loadConfiguredReleases(),
  ]);
  const developmentConnection = developmentConnections[0];
  const release = releases[0];
  if (!developmentConnection && !release) {
    return {
      state: "unconfigured",
      agentId: null,
      releaseVersion: null,
      errorCode: null,
    };
  }
  return {
    state: runtimeErrorCode
      ? "error"
      : runningSessions.size > 0
        ? "running"
        : "ready",
    agentId: developmentConnection?.agentId ?? release?.agentId ?? null,
    releaseVersion: developmentConnection
      ? "development"
      : (release?.releaseVersion ?? null),
    errorCode: runtimeErrorCode,
  };
}

export async function startAgentPrompt(
  rawInput: StartAgentPromptInput,
): Promise<StartAgentPromptResult> {
  const input = parsePromptInput(rawInput);
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("A prompt is required");
  if (prompt.length > 100_000) throw new Error("The prompt is too long");

  const target = await requireAgentTarget(input.agentId);
  const release = target.kind === "release" ? target.release : null;
  const context = await initializeStorage();
  const installation = release
    ? await ensureAgentInstallation(context, release)
    : null;
  let modelId = input.modelId ?? release?.defaultModelId ?? null;
  let thinkingEffortId: string | null = null;
  if (release && isFxRelease(release)) {
    const authentication = await getFxAuthenticationStatus(
      context,
      installation!.installationId,
    );
    if (authentication.state !== "connected") {
      throw new Error("FX_AUTHENTICATION_REQUIRED");
    }
    modelId ??= authentication.defaultModelId;
    if (
      modelId &&
      !authentication.models.some((model) => model.id === modelId)
    ) {
      throw new Error("The selected model is not available for this agent");
    }
    if (input.thinkingEffortId) {
      const selectedModel = authentication.models.find(
        (model) => model.id === modelId,
      );
      if (
        !selectedModel?.thinkingEfforts.some(
          (option) => option.id === input.thinkingEffortId,
        )
      ) {
        throw new Error(
          "The selected thinking effort is not available for this model",
        );
      }
      thinkingEffortId = input.thinkingEffortId;
    }
  } else if (
    release &&
    modelId &&
    !release.models.some((model) => model.id === modelId)
  ) {
    throw new Error("The selected model is not available for this agent");
  } else if (input.thinkingEffortId) {
    throw new Error("This agent does not support thinking effort selection");
  } else if (!release && input.modelId) {
    throw new Error(
      "This development agent has not advertised model selection",
    );
  }
  const identity = localDeviceIdentity(context.vault);
  const [priorEvents, existingRevision, existingSessionContext] =
    input.sessionId
      ? await Promise.all([
          listSessionTranscript(context.database, input.sessionId),
          getSessionRevision(context.database, input.sessionId),
          getSessionProjectContext(context.database, input.sessionId),
        ])
      : [[], null, null];
  if (input.sessionId && !existingSessionContext) {
    throw new Error("Session does not exist");
  }
  const projectId = input.sessionId
    ? (existingSessionContext?.projectId ?? null)
    : (input.projectId ?? null);
  if (
    input.sessionId &&
    input.projectId !== undefined &&
    input.projectId !== projectId
  ) {
    throw new Error("Session project context cannot be changed");
  }
  const project = projectId
    ? (await listProjects(context.database, identity.clientInstanceId)).find(
        (candidate) => candidate.id === projectId,
      )
    : null;
  const projectRoots = await Promise.all(
    (project?.roots ?? []).map((root) => realpath(root.rootPath)),
  );
  let session: { id: string; revision: number };
  if (input.sessionId) {
    if (existingRevision === null) throw new Error("Session does not exist");
    if (isAgentSessionWorking(input.sessionId)) {
      throw new Error("This chat already has an active run");
    }
    session = { id: input.sessionId, revision: existingRevision };
  } else {
    session = await createSession(context.database, {
      originClientInstanceId: identity.clientInstanceId,
      projectId,
      title: promptTitle(prompt),
    });
  }
  const journal = new RuntimeSessionJournal(
    context.database,
    identity.clientInstanceId,
    session.id,
    session.revision,
  );
  const userMessageEventId = randomUUID();
  markSessionWorking(session.id);
  try {
    await journal.append({
      eventId: userMessageEventId,
      agentRunId: null,
      eventType: "message",
      role: "user",
      messageKind: "prompt",
      status: "completed",
      model: null,
      providerMessageId: null,
      finishReason: null,
      parts: [
        {
          id: randomUUID(),
          position: 0,
          partType: "text",
          text: prompt,
        },
      ],
    });

    void runAgentSession({
      accessMode: input.accessMode,
      context,
      modelId,
      target,
      prompt: promptWithHistory(priorEvents, prompt),
      projectRoots,
      sessionId: session.id,
      thinkingEffortId,
      userMessageEventId,
      journal,
    });
  } catch (error) {
    clearSessionWorking(session.id);
    throw error;
  }
  return { sessionId: session.id, userMessageEventId };
}

function parsePromptInput(input: unknown): StartAgentPromptInput {
  if (!input || typeof input !== "object") {
    throw new Error("The prompt request is invalid");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.agentId !== "string" || !value.agentId.trim()) {
    throw new Error("An agent selection is required");
  }
  if (typeof value.prompt !== "string") {
    throw new Error("A prompt is required");
  }
  for (const field of [
    "modelId",
    "projectId",
    "sessionId",
    "thinkingEffortId",
  ] as const) {
    if (
      value[field] !== undefined &&
      value[field] !== null &&
      typeof value[field] !== "string"
    ) {
      throw new Error(`The ${field} is invalid`);
    }
  }
  return {
    accessMode: value.accessMode === "full" ? "full" : "ask",
    agentId: value.agentId,
    modelId: value.modelId as string | null | undefined,
    prompt: value.prompt,
    projectId: value.projectId as string | null | undefined,
    sessionId: value.sessionId as string | null | undefined,
    thinkingEffortId: value.thinkingEffortId as string | null | undefined,
  };
}

function promptWithHistory(
  events: Awaited<ReturnType<typeof listSessionTranscript>>,
  prompt: string,
): string {
  const messages = events.filter(
    (
      event,
    ): event is Extract<(typeof events)[number], { eventType: "message" }> =>
      event.eventType === "message" && Boolean(event.text.trim()),
  );
  if (messages.length === 0) return prompt;
  const history = messages
    .map((message) => `${message.role}: ${message.text.trim()}`)
    .join("\n\n")
    .slice(-50_000);
  return [
    "Continue this Radius conversation. Answer only the final user message.",
    "",
    history,
    "",
    `user: ${prompt}`,
  ].join("\n");
}

export async function cancelAgentSession(sessionId: string): Promise<void> {
  const runtime = runningSessions.get(sessionId);
  await Promise.all([
    runtime?.cancel(),
    runningTerminalManagers.get(sessionId)?.close(),
    cancelPendingTerminalApprovals(sessionId),
  ]);
}

export function stopAgentRuntime(): void {
  for (const runtime of runningSessions.values()) runtime.stop();
  for (const terminalManager of runningTerminalManagers.values()) {
    void terminalManager.close();
  }
  for (const sessionId of workingSessions) {
    void cancelPendingTerminalApprovals(sessionId);
  }
  for (const sessionId of [...streamingSessionMessages.keys()]) {
    clearStreamingSessionMessage(sessionId);
  }
  runningSessions.clear();
  runningTerminalManagers.clear();
  workingSessions.clear();
}

interface ToolApprovalContext {
  agentRunId: string;
  journal: RuntimeSessionJournal;
  sessionId: string;
}

async function awaitToolApproval(
  input: ToolApprovalContext,
  request: {
    detail: string;
    exactReason: string;
    exactToolInput: JsonValue;
    reason: string;
    toolCallEventId: string;
  },
  signal: AbortSignal,
): Promise<TerminalApprovalDecision> {
  const approvalRequestEventId = randomUUID();
  const expiresAt = new Date(Date.now() + TERMINAL_APPROVAL_TIMEOUT_MS);
  await input.journal.append({
    eventId: randomUUID(),
    agentRunId: input.agentRunId,
    eventType: "agent_run_state_update",
    state: "waiting_for_approval",
    detail: request.detail,
  });
  await input.journal.append({
    eventId: approvalRequestEventId,
    agentRunId: input.agentRunId,
    eventType: "approval_request",
    toolCallEventId: request.toolCallEventId,
    reason: request.reason,
    expiresAt: expiresAt.toISOString(),
  });

  return new Promise<TerminalApprovalDecision>((resolve) => {
    let settled = false;
    const finish = async (
      decision: TerminalApprovalDecision,
    ): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      pendingTerminalApprovals.delete(approvalRequestEventId);
      await input.journal.append({
        eventId: randomUUID(),
        agentRunId: input.agentRunId,
        eventType: "approval_decision",
        approvalRequestEventId,
        decision,
        actorType:
          decision === "approved" || decision === "denied" ? "user" : "system",
        actorId: null,
        note: null,
      });
      await input.journal.append({
        eventId: randomUUID(),
        agentRunId: input.agentRunId,
        eventType: "agent_run_state_update",
        state: "working",
        detail:
          decision === "approved" ? "Continuing with approved access" : null,
      });
      resolve(decision);
    };
    const onAbort = (): void => void finish("cancelled");
    const timeout = setTimeout(
      () => void finish("expired"),
      TERMINAL_APPROVAL_TIMEOUT_MS,
    );
    timeout.unref();
    pendingTerminalApprovals.set(approvalRequestEventId, {
      sessionId: input.sessionId,
      exactReason: request.exactReason,
      exactToolInput: request.exactToolInput,
      toolCallEventId: request.toolCallEventId,
      decide: finish,
    });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) void finish("cancelled");
  });
}

async function authorizeTerminal(
  input: {
    accessMode: "ask" | "full";
    agentRunId: string;
    journal: RuntimeSessionJournal;
    sessionId: string;
  },
  request: TerminalAuthorizationRequest,
  signal: AbortSignal,
): Promise<string> {
  const toolCallEventId = randomUUID();
  const exactToolInput: JsonValue = {
    command: request.command,
    args: request.args,
    cwd: request.cwd,
    environment: request.environment,
    outsideProjectRoots: request.outsideProjectRoots,
    pendingLocally: true,
  };
  await input.journal.append({
    eventId: toolCallEventId,
    agentRunId: input.agentRunId,
    eventType: "tool_call",
    triggeringMessageEventId: null,
    capability: "shell",
    operation: "execute",
    inputSchemaId: "radius.shell.execute",
    inputSchemaVersion: 1,
    input: {
      command: "Command details remain on the originating Mac",
      args: [],
      cwd: request.outsideProjectRoots
        ? "Outside project folders"
        : "Project folders",
      environment: request.environment.map((entry) => ({ name: entry.name })),
      outsideProjectRoots: request.outsideProjectRoots,
    },
  });

  const needsApproval =
    input.accessMode === "ask" || request.outsideProjectRoots;
  if (!needsApproval) return toolCallEventId;

  const decision = await awaitToolApproval(
    input,
    {
      detail: request.outsideProjectRoots
        ? "Waiting for folder access"
        : "Waiting for command approval",
      exactReason: request.outsideProjectRoots
        ? `Allow this command to read and write ${request.cwd}`
        : `Allow this command to run in ${request.cwd}`,
      exactToolInput,
      reason: request.outsideProjectRoots
        ? "Allow this command to use an outside project folder"
        : "Allow this command to run in the project folders",
      toolCallEventId,
    },
    signal,
  );

  if (decision !== "approved") {
    await input.journal.append({
      eventId: randomUUID(),
      agentRunId: input.agentRunId,
      eventType: "tool_result",
      toolCallEventId,
      outcome: "cancelled",
      outputSchemaId: "radius.shell.result",
      outputSchemaVersion: 1,
      output: { decision },
    });
    throw new Error(`Terminal command was ${decision}`);
  }
  return toolCallEventId;
}

async function appendTerminalResult(
  journal: RuntimeSessionJournal,
  agentRunId: string,
  result: TerminalExecutionResult,
): Promise<void> {
  await journal.append({
    eventId: randomUUID(),
    agentRunId,
    eventType: "tool_result",
    toolCallEventId: result.correlationId,
    outcome:
      result.exitCode === 0
        ? "succeeded"
        : result.signal
          ? "cancelled"
          : "failed",
    outputSchemaId: "radius.shell.result",
    outputSchemaVersion: 1,
    output: {
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      outputTruncated: result.outputTruncated,
      signal: result.signal,
    },
  });
}

async function authorizeFileAccess(
  input: ToolApprovalContext & { accessMode: "ask" | "full" },
  request: FileAuthorizationRequest,
  signal: AbortSignal,
): Promise<string> {
  const toolCallEventId = randomUUID();
  const exactToolInput: JsonValue = {
    path: request.path,
    outsideProjectRoots: request.outsideProjectRoots,
    pendingLocally: true,
  };
  await input.journal.append({
    eventId: toolCallEventId,
    agentRunId: input.agentRunId,
    eventType: "tool_call",
    triggeringMessageEventId: null,
    capability: "workspace.files",
    operation: request.operation,
    inputSchemaId: `radius.workspace.files.${request.operation}`,
    inputSchemaVersion: 1,
    input: {
      path: request.outsideProjectRoots
        ? "Outside project file"
        : "Project file",
      outsideProjectRoots: request.outsideProjectRoots,
    },
  });
  const needsApproval =
    request.outsideProjectRoots ||
    (input.accessMode === "ask" && request.operation === "write");
  if (!needsApproval) return toolCallEventId;

  const decision = await awaitToolApproval(
    input,
    {
      detail:
        request.operation === "read"
          ? "Waiting for file access"
          : "Waiting for file-change approval",
      exactReason: `Allow Radius to ${request.operation} ${request.path}`,
      exactToolInput,
      reason: request.outsideProjectRoots
        ? `Allow Radius to ${request.operation} an outside project file`
        : `Allow Radius to ${request.operation} a project file`,
      toolCallEventId,
    },
    signal,
  );
  if (decision !== "approved") {
    await input.journal.append({
      eventId: randomUUID(),
      agentRunId: input.agentRunId,
      eventType: "tool_result",
      toolCallEventId,
      outcome: "cancelled",
      outputSchemaId: "radius.workspace.files.result",
      outputSchemaVersion: 1,
      output: { decision },
    });
    throw new Error(`File access was ${decision}`);
  }
  return toolCallEventId;
}

async function appendFileAccessResult(
  journal: RuntimeSessionJournal,
  agentRunId: string,
  result: FileAccessResult,
): Promise<void> {
  await journal.append({
    eventId: randomUUID(),
    agentRunId,
    eventType: "tool_result",
    toolCallEventId: result.correlationId,
    outcome: result.succeeded ? "succeeded" : "failed",
    outputSchemaId: "radius.workspace.files.result",
    outputSchemaVersion: 1,
    output: {
      operation: result.operation,
      path: "Local path retained on the originating Mac",
    },
  });
}

async function runAgentSession(input: {
  accessMode: "ask" | "full";
  context: StorageContext;
  modelId: string | null;
  target: AgentTarget;
  prompt: string;
  projectRoots: string[];
  sessionId: string;
  thinkingEffortId: string | null;
  userMessageEventId: string;
  journal: RuntimeSessionJournal;
}): Promise<void> {
  const agentRunId = randomUUID();
  const assistantMessageEventId = randomUUID();
  const assistantMessageOccurredAt = new Date().toISOString();
  const streamedMessage = <Status extends StreamedMessageEvent["status"]>(
    status: Status,
    text: string,
  ): Extract<StreamedMessageEvent, { status: Status }> =>
    ({
      eventId: assistantMessageEventId,
      sessionRevision: Number.MAX_SAFE_INTEGER,
      occurredAt: assistantMessageOccurredAt,
      agentRunId,
      eventType: "message",
      role: "assistant",
      messageKind: "final",
      status,
      text,
    }) as Extract<StreamedMessageEvent, { status: Status }>;
  const updateState: RuntimeUpdateState = {
    hostToolKinds: new Set(),
    plan: createAgentPlanJournalState(),
    toolCallEventIds: new Map(),
  };
  const release = input.target.kind === "release" ? input.target.release : null;
  const developmentConnection =
    input.target.kind === "development" ? input.target.connection : null;
  const displayName =
    release?.displayName ?? developmentConnection!.displayName;
  const providerKey = release?.providerId ?? "radius-development";
  const capabilities =
    release?.capabilities ?? developmentConnection!.capabilities;
  let responseText = "";
  let runtime: RunningAgentRuntime | null = null;
  let fxProfile: FxRuntimeProfileLease | null = null;
  let browserTools: BrowserToolServer | null = null;
  let fileSystemManager: HostFileSystemManager | null = null;
  let terminalManager: MacOsTerminalManager | null = null;

  try {
    await input.journal.append({
      eventId: randomUUID(),
      agentRunId,
      eventType: "agent_run",
      providerKey,
      providerRunId: null,
      triggeringMessageEventId: input.userMessageEventId,
    });
    await input.journal.append({
      eventId: randomUUID(),
      agentRunId,
      eventType: "agent_run_presentation",
      mode: "inline",
      initialState: null,
      summaryMessageEventId: null,
      label: displayName,
    });
    await input.journal.append({
      eventId: randomUUID(),
      agentRunId,
      eventType: "agent_run_state_update",
      state: "working",
      detail:
        release && isFxRelease(release)
          ? "Preparing the local fx runtime"
          : developmentConnection
            ? "Connecting to the development agent"
            : "Preparing the local agent runtime",
    });

    if (release && isFxRelease(release)) {
      fxProfile = await prepareFxRuntimeProfile(
        input.context,
        input.thinkingEffortId,
      );
    }
    if (capabilities.some((capability) => capability.startsWith("browser."))) {
      browserTools = await startBrowserToolServer(browserBridge, {
        authorize: (operation) =>
          input.accessMode === "full" &&
          browserOperationRequested(capabilities, operation),
      });
    }
    if (
      capabilities.includes("shell.execute") &&
      input.projectRoots.length > 0
    ) {
      terminalManager = new MacOsTerminalManager({
        projectRoots: input.projectRoots,
        authorize: (request, signal) =>
          authorizeTerminal(
            {
              accessMode: input.accessMode,
              agentRunId,
              journal: input.journal,
              sessionId: input.sessionId,
            },
            request,
            signal,
          ),
        onResult: (result) =>
          appendTerminalResult(input.journal, agentRunId, result),
      });
      updateState.hostToolKinds.add("execute");
    }
    const canReadFiles = capabilities.includes("workspace.files.read");
    const canWriteFiles = capabilities.includes("workspace.files.write");
    if (input.projectRoots.length > 0 && (canReadFiles || canWriteFiles)) {
      fileSystemManager = new HostFileSystemManager({
        projectRoots: input.projectRoots,
        authorize: (request, signal) =>
          authorizeFileAccess(
            {
              accessMode: input.accessMode,
              agentRunId,
              journal: input.journal,
              sessionId: input.sessionId,
            },
            request,
            signal,
          ),
        onResult: (result) =>
          appendFileAccessResult(input.journal, agentRunId, result),
      });
      if (canReadFiles) updateState.hostToolKinds.add("read");
      if (canWriteFiles) updateState.hostToolKinds.add("edit");
    }
    const mcpServers = browserTools
      ? [
          {
            type: "http" as const,
            name: "radius-browser",
            url: browserTools.url,
            headers: browserTools.headers,
          },
        ]
      : [];
    const handlers: AcpRuntimeHandlers = {
      fileSystem: fileSystemManager
        ? {
            readTextFile: canReadFiles
              ? (request, signal) =>
                  fileSystemManager!.readTextFile(request, signal)
              : undefined,
            writeTextFile: canWriteFiles
              ? (request, signal) =>
                  fileSystemManager!.writeTextFile(request, signal)
              : undefined,
          }
        : undefined,
      onPermissionRequest: async (request: RequestPermissionRequest) =>
        permissionDecision(input.accessMode, request),
      terminal: terminalManager ?? undefined,
      onUpdate: async ({ update }: { update: SessionUpdate }) => {
        if (
          update.sessionUpdate === "agent_message_chunk" &&
          update.content.type === "text"
        ) {
          const textOffset = responseText.length;
          responseText += update.content.text;
          publishStreamingSessionMessage(
            input.sessionId,
            streamedMessage("streaming", responseText),
            update.content.text,
            textOffset,
          );
        }
        await appendRuntimeUpdate(
          input.journal,
          agentRunId,
          updateState,
          update,
        );
      },
    };
    let runtimeSessionId: string;
    if (developmentConnection) {
      const session = await AcpRuntimeSession.connect(
        acpStreamFromWebSocket(
          developmentConnection.endpoint,
          developmentConnection.authorization,
        ),
        {
          cwd: input.projectRoots[0] ?? developmentConnection.cwd,
          modelId: input.modelId,
          mcpServers,
          handlers,
          clientName: "radius-desktop-development",
        },
      );
      runtimeSessionId = session.sessionId;
      runtime = {
        prompt: (text) => session.prompt(text),
        cancel: () => session.cancel(),
        stop: async () => session.close(),
      };
    } else {
      const microvm = await MicrovmAcpRuntime.start({
        release: release!,
        modelId: input.modelId,
        paths: resolveMicrovmPaths(release!, fxProfile?.path),
        cwd: input.projectRoots[0] ?? release!.process.statePath,
        mcpServers,
        handlers,
        onStderr: (chunk) => {
          if (process.env.RADIUS_RUNTIME_DEBUG === "1") {
            console.error("[runtime]", chunk.trimEnd());
          }
        },
      });
      runtimeSessionId = microvm.session.sessionId;
      runtime = microvm;
    }
    if (terminalManager) {
      terminalManager.bindSession(runtimeSessionId);
      runningTerminalManagers.set(input.sessionId, terminalManager);
    }
    fileSystemManager?.bindSession(runtimeSessionId);
    runningSessions.set(input.sessionId, runtime);
    runtimeErrorCode = null;
    await input.journal.append({
      eventId: randomUUID(),
      agentRunId,
      eventType: "agent_run_state_update",
      state: "working",
      detail: `Waiting for ${displayName}`,
    });
    const result = await runtime.prompt(input.prompt);

    if (responseText.trim()) {
      await input.journal.append({
        eventId: assistantMessageEventId,
        agentRunId,
        eventType: "message",
        role: "assistant",
        messageKind: "final",
        status: result.stopReason === "cancelled" ? "cancelled" : "completed",
        model: input.modelId,
        providerMessageId: null,
        finishReason: result.stopReason,
        parts: [
          {
            id: randomUUID(),
            position: 0,
            partType: "text",
            text: responseText.trim(),
          },
        ],
      });
      broadcastSessionTranscriptStream({
        sessionId: input.sessionId,
        eventId: assistantMessageEventId,
        event: streamedMessage(
          result.stopReason === "cancelled" ? "cancelled" : "completed",
          responseText.trim(),
        ),
        mode: "replace",
      });
      streamingSessionMessages.delete(input.sessionId);
    }
    await input.journal.append({
      eventId: randomUUID(),
      agentRunId,
      eventType: "agent_run_state_update",
      state: result.stopReason === "cancelled" ? "cancelled" : "completed",
      detail: null,
    });
  } catch (error) {
    runtimeErrorCode = "AGENT_RUN_FAILED";
    const message =
      error instanceof Error ? error.message : "Unknown agent runtime error";
    await input.journal.append({
      eventId: randomUUID(),
      agentRunId,
      eventType: "error",
      code: "AGENT_RUN_FAILED",
      message: message.slice(0, 2_000),
      retryable: true,
      detailsSchemaId: null,
      details: null,
    });
    await input.journal.append({
      eventId: randomUUID(),
      agentRunId,
      eventType: "agent_run_state_update",
      state: "failed",
      detail: message.slice(0, 500),
    });
  } finally {
    clearStreamingSessionMessage(input.sessionId);
    clearSessionWorking(input.sessionId);
    runningSessions.delete(input.sessionId);
    runningTerminalManagers.delete(input.sessionId);
    await terminalManager?.close();
    await cancelPendingTerminalApprovals(input.sessionId);
    if (runtime) await runtime.stop();
    await browserTools?.close();
    await fxProfile?.finalize();
  }
}

function browserOperationRequested(
  capabilities: string[],
  operation: BrowserBridgeOperation,
): boolean {
  const requested = new Set(capabilities);
  if (operation === "browser.status") {
    return [...requested].some((capability) =>
      capability.startsWith("browser."),
    );
  }
  if (operation === "tabs.list") return requested.has("browser.tabs.read");
  if (operation === "tabs.create") {
    return requested.has("browser.tabs.create");
  }
  if (
    operation === "tabs.activate" ||
    operation === "tabs.close" ||
    operation === "control.release"
  ) {
    return requested.has("browser.tabs.manage");
  }
  if (operation === "page.snapshot" || operation === "page.screenshot") {
    return requested.has("browser.page.read");
  }
  return requested.has("browser.page.interact");
}

function permissionDecision(
  accessMode: "ask" | "full",
  request: RequestPermissionRequest,
): { outcome: "selected"; optionId: string } | { outcome: "cancelled" } {
  if (accessMode === "ask") return { outcome: "cancelled" };
  const option = request.options.find(
    (candidate) => candidate.kind === "allow_once",
  );
  return option
    ? { outcome: "selected", optionId: option.optionId }
    : { outcome: "cancelled" };
}

async function appendRuntimeUpdate(
  journal: RuntimeSessionJournal,
  agentRunId: string,
  state: RuntimeUpdateState,
  update: SessionUpdate,
): Promise<void> {
  if (update.sessionUpdate === "plan") {
    const events = agentPlanJournalEvents(state.plan, update);
    for (const event of events) {
      await journal.append({ ...event, agentRunId });
    }
    return;
  }
  if (update.sessionUpdate === "tool_call") {
    if (update.kind && state.hostToolKinds.has(update.kind)) return;
    const eventId = randomUUID();
    state.toolCallEventIds.set(update.toolCallId, eventId);
    await journal.append({
      eventId,
      agentRunId,
      eventType: "tool_call",
      triggeringMessageEventId: null,
      capability: `acp.${update.kind ?? "other"}`,
      operation: update.title?.trim() || "tool-call",
      inputSchemaId: "acp.tool-call",
      inputSchemaVersion: 1,
      input: jsonValue(update.rawInput),
    });
    return;
  }
  if (update.sessionUpdate !== "tool_call_update") return;
  const toolCallEventId = state.toolCallEventIds.get(update.toolCallId);
  if (!toolCallEventId) return;
  const outcome = terminalToolOutcome(update.status);
  if (!outcome) return;
  await journal.append({
    eventId: randomUUID(),
    agentRunId,
    eventType: "tool_result",
    toolCallEventId,
    outcome,
    outputSchemaId: "acp.tool-result",
    outputSchemaVersion: 1,
    output: jsonValue(update.rawOutput),
  });
}

function terminalToolOutcome(
  status: string | null | undefined,
): "succeeded" | "failed" | "cancelled" | null {
  if (status === "completed") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return null;
}

function jsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function resolveMicrovmPaths(
  release: AgentReleaseDescriptor,
  stateSharePath?: string,
): MicrovmRuntimePaths {
  const runtimeHostPath = app.isPackaged
    ? path.join(
        process.resourcesPath,
        "runtime/macos-arm64/radius-runtime-host",
      )
    : path.resolve(
        app.getAppPath(),
        "../runtime-host-macos/.build/release/radius-runtime-host",
      );
  const kernelPath = app.isPackaged
    ? path.join(process.resourcesPath, "runtime/vmlinux-arm64")
    : path.resolve(
        app.getAppPath(),
        "../runtime-host-macos/.build/runtime-assets/vmlinux-arm64",
      );
  const configuredRuntimeRoot = process.env.RADIUS_AGENT_RUNTIME_ROOT?.trim();
  const runtimeRoot = configuredRuntimeRoot
    ? path.resolve(configuredRuntimeRoot)
    : !app.isPackaged && isFxRelease(release)
      ? path.join(app.getPath("appData"), "Radius/dev/runtime/fx-image-store")
      : path.join(app.getPath("userData"), "runtime", release.agentId);
  const developerStateSharePath =
    stateSharePath ||
    process.env.RADIUS_AGENT_DEVELOPER_STATE_SHARE?.trim() ||
    undefined;
  return {
    runtimeHostPath,
    kernelPath,
    runtimeRoot,
    developerStateSharePath,
    developerStateShareUser: developerStateSharePath
      ? `${process.getuid?.() ?? 10000}:${process.getgid?.() ?? 10000}`
      : undefined,
  };
}

async function loadConfiguredReleases(): Promise<AgentReleaseDescriptor[]> {
  const releasePaths = await resolveAgentReleasePaths();
  const releases: AgentReleaseDescriptor[] = [];
  for (const releasePath of releasePaths) {
    try {
      const raw = JSON.parse(await readFile(releasePath, "utf8"));
      releases.push(parseAgentReleaseDescriptor(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return releases;
}

async function requireAgentRelease(
  agentId: string,
): Promise<AgentReleaseDescriptor> {
  const release = (await loadConfiguredReleases()).find(
    (candidate) => candidate.agentId === agentId,
  );
  if (!release) {
    throw new Error("The selected local agent is not installed");
  }
  return release;
}

async function requireAgentTarget(agentId: string): Promise<AgentTarget> {
  const developmentConnection = (await listDevelopmentAgentConnections()).find(
    (candidate) => candidate.agentId === agentId,
  );
  if (developmentConnection) {
    return { kind: "development", connection: developmentConnection };
  }
  return { kind: "release", release: await requireAgentRelease(agentId) };
}

async function ensureAgentInstallation(
  context: StorageContext,
  release: AgentReleaseDescriptor,
): Promise<InstalledAgentRelease> {
  const manifestSha256 = createHash("sha256")
    .update(JSON.stringify(release))
    .digest("hex");
  return installAgentRelease(context.database, {
    clientInstanceId: context.vault.clientInstanceId,
    providerKey: release.providerId,
    agentKey: release.agentId,
    displayName: release.displayName,
    releaseVersion: release.releaseVersion,
    imageDigest: release.image.digest,
    manifestSha256,
    protocolKind: release.protocol.kind,
    protocolVersion: release.protocol.version,
    authRequirements: release.authRequirements,
  });
}

function desktopAgentSummary(
  release: AgentReleaseDescriptor,
  authentication: Awaited<ReturnType<typeof getFxAuthenticationStatus>> | null,
): DesktopAgentSummary {
  return {
    id: release.agentId,
    label: release.displayName,
    detail: `${release.releaseVersion} · local microVM`,
    models:
      authentication?.models ??
      release.models.map((model) => ({
        ...model,
        thinkingEfforts: [],
        defaultThinkingEffortId: null,
      })),
    defaultModelId: authentication?.defaultModelId ?? release.defaultModelId,
    authentication: authentication
      ? {
          state: authentication.state,
          label: authentication.accountLabel,
          detail: authentication.detail,
        }
      : {
          state: "not_required",
          label: null,
          detail: "No sign-in required",
        },
  };
}

function developmentAgentSummary(
  connection: DevelopmentAgentConnection,
): DesktopAgentSummary {
  return {
    id: connection.agentId,
    label: connection.displayName,
    detail: "Development connection",
    models: [],
    defaultModelId: null,
    authentication: {
      state: "not_required",
      label: null,
      detail: "Connected through radius dev",
    },
  };
}

function promptTitle(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0]?.trim() || "New chat";
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 77)}...`;
}

class RuntimeSessionJournal {
  private revision: number;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly database: RadiusDatabase,
    private readonly sourceClientInstanceId: string,
    private readonly sessionId: string,
    initialRevision: number,
  ) {
    this.revision = initialRevision;
  }

  append(event: SessionEventBody): Promise<void> {
    this.tail = this.tail.then(async () => {
      this.revision += 1;
      await appendSessionEvent(this.database, {
        ...event,
        sessionId: this.sessionId,
        sessionRevision: this.revision,
        sourceClientInstanceId: this.sourceClientInstanceId,
        occurredAt: new Date().toISOString(),
        artifactLinks: [],
      } as unknown as SessionEvent);
    });
    return this.tail;
  }
}
