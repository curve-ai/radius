import {
  clearComposerDraft,
  createSession,
  ensureBuiltinToolBinding,
  ensureBuiltinToolProvider,
  getSessionProjectContext,
  getSessionRevision,
  grantMcpToolApproval,
  hasMcpApproval,
  hasMcpToolApproval,
  grantMcpServerApproval,
  hasMcpServerApproval,
  installAgentRelease,
  listReadyMcpProviders,
  listProjects,
  listSessionTranscript,
  type RadiusDatabase,
  type InstalledAgentRelease,
  type SessionTranscriptEventRecord,
} from "@curve-ai/radius-storage";
import type { McpConnectorClient } from "@curve-ai/radius-mcp-connector";
import {
  startBrokeredMcpServer,
  type BrokeredMcpServer,
  type BrokeredTool,
} from "@curve-ai/radius-tool-broker";
import {
  AcpRuntimeSession,
  MicrovmAcpRuntime,
  acpStreamFromWebSocket,
  parseAgentReleaseDescriptor,
  type AcpRuntimeHandlers,
  type AcpPermissionDecision,
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
import { resolveLocalArtifactPath } from "@curve-ai/radius-sync-core";
import { app, BrowserWindow } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  DesktopAgentSummary,
  DesktopRuntimeStatus,
  SessionTranscriptStreamUpdate,
  StartAgentPromptInput,
  StartAgentPromptResult,
  StreamingSessionTranscriptMessage,
  ToolApprovalSelection,
} from "../radius-api";
import {
  SESSION_RUN_ACTIVITY_DETAIL,
  SESSION_TRANSCRIPT_STREAM_CHANNEL,
} from "../radius-api";
import { splitGeneratedImageLinks } from "../generated-image-link";
import {
  needsFileApproval,
  needsTerminalApproval,
  type AgentAccessMode,
} from "./agent-access-policy";
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
import { createRuntimeMcpClient } from "./mcp-connector-auth";
import { decodeAgentImage, MAX_AGENT_IMAGE_BYTES } from "./agent-image-content";
import { fxStateRelativeImagePath } from "./fx-generated-image-link";
import {
  readBoundedImageFile,
  radiusImageExtension,
  radiusImageMatchesSignature,
  radiusImageMimeTypeForPath,
} from "./image-content";
import {
  BROWSER_MCP_TOOL_BINDINGS,
  browserMcpToolName,
  mcpAvailableSelections,
  mcpOptionIdForSelection,
  mcpPermissionOptionIds,
} from "./mcp-permission-options";
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
import { applyAgentSessionTitleUpdate } from "./agent-session-title";
import {
  RuntimeSessionJournal,
  type RuntimeSessionEvent,
} from "./runtime-session-journal";

type SessionEvent = RuntimeSessionEvent;
type SessionMessageEvent = Extract<SessionEvent, { eventType: "message" }>;
type SessionArtifactLink = SessionEvent["artifactLinks"][number];
type AgentMessageChunk = Extract<
  SessionUpdate,
  { sessionUpdate: "agent_message_chunk" }
>;
type AgentImageContent = Extract<
  AgentMessageChunk["content"],
  { type: "image" }
>;
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

interface ActiveMcpPermissionContext {
  providerId: string;
  serverLabel: string;
  serverName: string;
  bindingIds: ReadonlyMap<string, string>;
  allowedTools: Set<string>;
  oneTimeTools: Map<string, number>;
}

function resolveMcpPermissionTool(
  context: ActiveMcpPermissionContext,
  value: string,
): { bindingId: string; nativeToolName: string } | null {
  for (const [nativeToolName, bindingId] of context.bindingIds) {
    if (
      value === nativeToolName ||
      value === `mcp__${context.serverName}__${nativeToolName}` ||
      value.endsWith(`__${nativeToolName}`)
    ) {
      return { bindingId, nativeToolName };
    }
  }
  return null;
}

function consumeMcpToolAllowance(
  context: ActiveMcpPermissionContext,
  nativeToolName: string,
): boolean {
  if (context.allowedTools.has(nativeToolName)) return true;
  const remaining = context.oneTimeTools.get(nativeToolName) ?? 0;
  if (remaining < 1) return false;
  if (remaining === 1) context.oneTimeTools.delete(nativeToolName);
  else context.oneTimeTools.set(nativeToolName, remaining - 1);
  return true;
}

function rememberMcpToolAllowance(
  context: ActiveMcpPermissionContext,
  selection: ToolApprovalSelection,
  nativeToolName: string,
): void {
  if (selection === "allow_always") {
    context.allowedTools.add(nativeToolName);
  } else if (selection === "allow_once") {
    context.oneTimeTools.set(
      nativeToolName,
      (context.oneTimeTools.get(nativeToolName) ?? 0) + 1,
    );
  }
}

interface PersistedAgentImage {
  artifactLink: SessionArtifactLink;
  fileLocation: string;
}

type CollectedResponsePart =
  | { kind: "text"; text: string }
  | { kind: "image"; image: PersistedAgentImage };

async function persistAgentImage(
  sessionId: string,
  content: AgentImageContent,
): Promise<PersistedAgentImage> {
  const { bytes, extension, mimeType } = decodeAgentImage(content);
  return persistAgentImageBytes(sessionId, bytes, mimeType, extension);
}

async function persistAgentImageBytes(
  sessionId: string,
  bytes: Buffer,
  mimeType: string,
  extension: string,
  displayName?: string,
): Promise<PersistedAgentImage> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AGENT_IMAGE_BYTES) {
    throw new Error("AGENT_IMAGE_TOO_LARGE");
  }
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const artifactId = randomUUID();
  const safeDisplayName = displayName
    ? Array.from(displayName, (character) =>
        character.charCodeAt(0) < 32 ? " " : character,
      )
        .join("")
        .replace(/[/\\:]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100)
    : undefined;
  const name = safeDisplayName
    ? `${safeDisplayName}.${extension}`
    : `generated-image-${contentSha256.slice(0, 12)}.${extension}`;
  const fileLocation = path.posix.join(
    "sha256",
    contentSha256.slice(0, 2),
    `${contentSha256}.${extension}`,
  );
  const artifactRoot = path.join(app.getPath("userData"), "artifacts");
  const targetPath = path.join(artifactRoot, ...fileLocation.split("/"));
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  try {
    await writeFile(targetPath, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(targetPath);
    if (
      existing.byteLength !== bytes.byteLength ||
      createHash("sha256").update(existing).digest("hex") !== contentSha256
    ) {
      throw new Error("AGENT_IMAGE_STORE_CONFLICT");
    }
  }

  return {
    fileLocation,
    artifactLink: {
      relationship: "output",
      artifact: {
        id: artifactId,
        sessionId,
        name,
        artifactType: "image",
        storageKind: "file",
        mimeType,
        contentSha256,
        byteSize: bytes.byteLength,
        supersedesArtifactId: null,
        createdAt: new Date().toISOString(),
        deletedAt: null,
      },
    },
  };
}

async function importFxGeneratedImages(
  sessionId: string,
  stateSharePath: string,
  parts: readonly CollectedResponsePart[],
): Promise<CollectedResponsePart[]> {
  const imported: CollectedResponsePart[] = [];
  for (const part of parts) {
    if (part.kind === "image") {
      imported.push(part);
      continue;
    }
    for (const segment of splitGeneratedImageLinks(part.text)) {
      if (segment.kind === "text") {
        appendResponseText(imported, segment.text);
        continue;
      }
      const relativePath = fxStateRelativeImagePath(segment.uri);
      if (!relativePath) {
        appendResponseText(imported, segment.raw);
        continue;
      }
      try {
        const filePath = await resolveLocalArtifactPath(
          stateSharePath,
          relativePath,
        );
        const mimeType = radiusImageMimeTypeForPath(filePath);
        const extension = mimeType ? radiusImageExtension(mimeType) : null;
        if (!mimeType || !extension) {
          appendResponseText(imported, segment.raw);
          continue;
        }
        const bytes = await readBoundedImageFile(
          filePath,
          MAX_AGENT_IMAGE_BYTES,
        );
        if (!radiusImageMatchesSignature(mimeType, bytes)) {
          appendResponseText(imported, segment.raw);
          continue;
        }
        imported.push({
          kind: "image",
          image: await persistAgentImageBytes(
            sessionId,
            bytes,
            mimeType,
            extension,
            segment.alt,
          ),
        });
      } catch {
        appendResponseText(imported, segment.raw);
      }
    }
  }
  return imported;
}

function appendResponseText(
  parts: CollectedResponsePart[],
  text: string,
): void {
  const last = parts.at(-1);
  if (last?.kind === "text") last.text += text;
  else parts.push({ kind: "text", text });
}

function durableMessageParts(
  parts: readonly CollectedResponsePart[],
): SessionMessageEvent["parts"] {
  const firstTextIndex = parts.findIndex((part) => part.kind === "text");
  const lastTextIndex = parts.findLastIndex((part) => part.kind === "text");
  const durable: SessionMessageEvent["parts"] = [];
  for (const [index, part] of parts.entries()) {
    if (part.kind === "image") {
      durable.push({
        id: randomUUID(),
        position: durable.length,
        partType: "artifact_reference",
        artifactId: part.image.artifactLink.artifact.id,
      });
      continue;
    }
    let text = part.text;
    if (index === firstTextIndex) text = text.trimStart();
    if (index === lastTextIndex) text = text.trimEnd();
    if (!text) continue;
    durable.push({
      id: randomUUID(),
      position: durable.length,
      partType: "text",
      text,
    });
  }
  return durable;
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
type ToolApprovalResolution = ToolApprovalSelection | "cancelled" | "expired";

interface PendingToolApproval {
  sessionId: string;
  exactReason: string;
  exactToolInput: JsonValue;
  toolCallEventId: string;
  allowedSelections: ReadonlySet<ToolApprovalSelection>;
  decide(selection: ToolApprovalResolution): Promise<void>;
}

const pendingToolApprovals = new Map<string, PendingToolApproval>();
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
  const pending = [...pendingToolApprovals.entries()].filter(
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

export async function resolveToolApproval(rawInput: unknown): Promise<void> {
  if (!rawInput || typeof rawInput !== "object") {
    throw new Error("Tool approval decision is invalid");
  }
  const input = rawInput as Record<string, unknown>;
  if (typeof input.sessionId !== "string" || !input.sessionId) {
    throw new Error("Tool approval session is required");
  }
  if (
    typeof input.approvalRequestEventId !== "string" ||
    !input.approvalRequestEventId
  ) {
    throw new Error("Tool approval request is required");
  }
  if (
    input.selection !== "allow_once" &&
    input.selection !== "allow_always" &&
    input.selection !== "allow_server" &&
    input.selection !== "denied"
  ) {
    throw new Error("Tool approval selection is invalid");
  }
  const pending = pendingToolApprovals.get(input.approvalRequestEventId);
  if (!pending || pending.sessionId !== input.sessionId) {
    throw new Error("Tool approval request is no longer pending");
  }
  if (!pending.allowedSelections.has(input.selection)) {
    throw new Error("That approval option is not available for this request");
  }
  await pending.decide(input.selection);
}

async function cancelPendingTerminalApprovals(
  sessionId: string,
): Promise<void> {
  const pending = [...pendingToolApprovals.values()].filter(
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

    await clearComposerDraft(context.database, {
      clientInstanceId: identity.clientInstanceId,
      context: input.sessionId
        ? { kind: "session", sessionId: input.sessionId }
        : { kind: "new_chat", projectId },
    }).catch((error) => {
      console.error(
        "[drafts] The submitted composer draft could not be cleared",
        error,
      );
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
    accessMode:
      value.accessMode === "project" || value.accessMode === "full"
        ? value.accessMode
        : "ask",
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
    const finish = async (selection: ToolApprovalResolution): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      pendingToolApprovals.delete(approvalRequestEventId);
      const decision: TerminalApprovalDecision =
        selection === "allow_once" ||
        selection === "allow_always" ||
        selection === "allow_server"
          ? "approved"
          : selection === "denied"
            ? "denied"
            : selection;
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
          selection === "allow_once"
            ? SESSION_RUN_ACTIVITY_DETAIL.resumingWork
            : null,
      });
      resolve(decision);
    };
    const onAbort = (): void => void finish("cancelled");
    const timeout = setTimeout(
      () => void finish("expired"),
      TERMINAL_APPROVAL_TIMEOUT_MS,
    );
    timeout.unref();
    pendingToolApprovals.set(approvalRequestEventId, {
      sessionId: input.sessionId,
      exactReason: request.exactReason,
      exactToolInput: request.exactToolInput,
      toolCallEventId: request.toolCallEventId,
      allowedSelections: new Set(["allow_once", "denied"]),
      decide: finish,
    });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) void finish("cancelled");
  });
}

async function awaitMcpPermission(
  input: ToolApprovalContext & {
    database: RadiusDatabase;
    providerId: string;
    serverLabel: string;
    serverName: string;
    toolCallEventIds: Map<string, string>;
    resolveTool(toolName: string): {
      bindingId: string;
      nativeToolName: string;
    } | null;
    recordApproval(
      selection: ToolApprovalSelection,
      toolName: string,
    ): Promise<void>;
  },
  request: RequestPermissionRequest,
  signal: AbortSignal,
): Promise<AcpPermissionDecision> {
  const optionIds = mcpPermissionOptionIds(request.options);
  const rawToolName =
    request.toolCall.name?.trim() ||
    request.toolCall.title?.trim() ||
    "MCP tool";
  const resolvedTool = input.resolveTool(rawToolName);
  const toolName = resolvedTool?.nativeToolName ?? rawToolName;
  const bindingId = resolvedTool?.bindingId ?? null;
  if (
    await hasMcpServerApproval(input.database, input.providerId).catch(
      () => false,
    )
  ) {
    const optionId = mcpOptionIdForSelection(optionIds, "allow_server");
    return optionId
      ? { outcome: "selected", optionId }
      : { outcome: "cancelled" };
  }
  if (
    bindingId &&
    (await hasMcpToolApproval(input.database, bindingId).catch(() => false))
  ) {
    const optionId = mcpOptionIdForSelection(optionIds, "allow_always");
    return optionId
      ? { outcome: "selected", optionId }
      : { outcome: "cancelled" };
  }
  let toolCallEventId = input.toolCallEventIds.get(request.toolCall.toolCallId);
  if (!toolCallEventId) {
    toolCallEventId = randomUUID();
    input.toolCallEventIds.set(request.toolCall.toolCallId, toolCallEventId);
    await input.journal.append({
      eventId: toolCallEventId,
      agentRunId: input.agentRunId,
      eventType: "tool_call",
      triggeringMessageEventId: null,
      capability: `mcp.${input.serverName}`,
      operation: toolName,
      inputSchemaId: "radius.mcp.tool-call",
      inputSchemaVersion: 1,
      input: null,
    });
  }
  const allowedSelections = mcpAvailableSelections(optionIds);
  if (allowedSelections.size === 0) return { outcome: "cancelled" };

  const approvalRequestEventId = randomUUID();
  const expiresAt = new Date(Date.now() + TERMINAL_APPROVAL_TIMEOUT_MS);
  const exactToolInput: JsonValue = {
    approvalKind: "mcp",
    allowAlwaysAvailable: Boolean(optionIds.allowAlways),
    allowServerAvailable: true,
    pendingLocally: true,
    serverLabel: input.serverLabel,
    toolName,
  };
  await input.journal.append({
    eventId: randomUUID(),
    agentRunId: input.agentRunId,
    eventType: "agent_run_state_update",
    state: "waiting_for_approval",
    detail: "Waiting for MCP approval",
  });
  await input.journal.append({
    eventId: approvalRequestEventId,
    agentRunId: input.agentRunId,
    eventType: "approval_request",
    toolCallEventId,
    reason: `Allow ${toolName} on ${input.serverLabel}`,
    expiresAt: expiresAt.toISOString(),
  });

  return new Promise<AcpPermissionDecision>((resolve) => {
    let settled = false;
    const finish = async (selection: ToolApprovalResolution): Promise<void> => {
      if (settled) return;
      if (selection === "allow_server") {
        await grantMcpServerApproval(input.database, input.providerId);
      }
      if (selection === "allow_always" && bindingId) {
        await grantMcpToolApproval(input.database, bindingId);
      }
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      pendingToolApprovals.delete(approvalRequestEventId);
      const approved =
        selection === "allow_once" ||
        selection === "allow_always" ||
        selection === "allow_server";
      if (approved) await input.recordApproval(selection, toolName);
      const decision = approved
        ? "approved"
        : selection === "denied"
          ? "denied"
          : selection;
      await input.journal.append({
        eventId: randomUUID(),
        agentRunId: input.agentRunId,
        eventType: "approval_decision",
        approvalRequestEventId,
        decision,
        actorType: approved || selection === "denied" ? "user" : "system",
        actorId: null,
        note: approved ? `mcp:${selection}` : null,
      });
      await input.journal.append({
        eventId: randomUUID(),
        agentRunId: input.agentRunId,
        eventType: "agent_run_state_update",
        state: "working",
        detail: approved ? SESSION_RUN_ACTIVITY_DETAIL.resumingWork : null,
      });
      if (!approved) {
        if (selection === "denied" && optionIds.reject) {
          resolve({ outcome: "selected", optionId: optionIds.reject });
        } else {
          resolve({ outcome: "cancelled" });
        }
        return;
      }
      const optionId = mcpOptionIdForSelection(optionIds, selection);
      resolve(
        optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" },
      );
    };
    const onAbort = (): void => void finish("cancelled");
    const timeout = setTimeout(
      () => void finish("expired"),
      TERMINAL_APPROVAL_TIMEOUT_MS,
    );
    timeout.unref();
    pendingToolApprovals.set(approvalRequestEventId, {
      sessionId: input.sessionId,
      exactReason: `Allow ${toolName} on ${input.serverLabel}`,
      exactToolInput,
      toolCallEventId,
      allowedSelections,
      decide: finish,
    });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) void finish("cancelled");
  });
}

async function authorizeTerminal(
  input: {
    accessMode: AgentAccessMode;
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

  const needsApproval = needsTerminalApproval(
    input.accessMode,
    request.outsideProjectRoots,
  );
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
  input: ToolApprovalContext & { accessMode: AgentAccessMode },
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
  const needsApproval = needsFileApproval(
    input.accessMode,
    request.operation,
    request.outsideProjectRoots,
  );
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
  accessMode: AgentAccessMode;
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
    artifacts: StreamingSessionTranscriptMessage["artifacts"] = [],
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
      artifacts,
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
  let responseParts: CollectedResponsePart[] | null = null;
  let runtime: RunningAgentRuntime | null = null;
  let fxProfile: FxRuntimeProfileLease | null = null;
  let browserTools: BrowserToolServer | null = null;
  let browserToolProviderId: string | null = null;
  const browserToolBindingIds = new Map<string, string>();
  let browserMcpContext: ActiveMcpPermissionContext | null = null;
  const connectorMcpClients: McpConnectorClient[] = [];
  const connectorMcpServers: BrokeredMcpServer[] = [];
  const connectorMcpContexts: ActiveMcpPermissionContext[] = [];
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
      mode: "collapsible",
      initialState: "collapsed",
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
          ? SESSION_RUN_ACTIVITY_DETAIL.startingFxAgent
          : developmentConnection
            ? SESSION_RUN_ACTIVITY_DETAIL.connectingAgent
            : SESSION_RUN_ACTIVITY_DETAIL.startingLocalAgent,
    });

    if (release && isFxRelease(release)) {
      fxProfile = await prepareFxRuntimeProfile(
        input.context,
        input.thinkingEffortId,
      );
    }
    if (capabilities.some((capability) => capability.startsWith("browser."))) {
      browserToolProviderId = await ensureBuiltinToolProvider(
        input.context.database,
        {
          clientInstanceId: input.context.vault.clientInstanceId,
          providerKey: "radius-browser",
          label: "Chrome browser",
          connected: true,
        },
      );
      for (const binding of BROWSER_MCP_TOOL_BINDINGS) {
        const inputSchemaVersion = 1;
        browserToolBindingIds.set(
          binding.nativeToolName,
          await ensureBuiltinToolBinding(input.context.database, {
            providerId: browserToolProviderId,
            capabilityKey: "mcp.radius-browser",
            contractVersion: 1,
            displayName: "Chrome browser MCP",
            description: "Browser tools exposed through Radius.",
            operationName: binding.nativeToolName,
            nativeToolName: binding.nativeToolName,
            inputSchemaId: `mcp.radius-browser.${binding.nativeToolName}`,
            inputSchemaVersion,
            inputSchemaSha256: createHash("sha256")
              .update(
                `mcp.radius-browser.${binding.nativeToolName}@${inputSchemaVersion}`,
              )
              .digest("hex"),
            outputSchemaId: "mcp.radius-browser.result",
            outputSchemaVersion: 1,
            riskClass: binding.riskClass,
          }),
        );
      }
      browserMcpContext = {
        providerId: browserToolProviderId,
        serverLabel: "Chrome browser",
        serverName: "radius-browser",
        bindingIds: browserToolBindingIds,
        allowedTools: new Set(),
        oneTimeTools: new Map(),
      };
      browserTools = await startBrowserToolServer(browserBridge, {
        authorize: async (operation) => {
          if (!browserOperationRequested(capabilities, operation)) return false;
          const toolName = browserMcpToolName(operation);
          const bindingId = browserToolBindingIds.get(toolName);
          if (
            browserToolProviderId &&
            bindingId &&
            (await hasMcpApproval(input.context.database, {
              providerId: browserToolProviderId,
              bindingId,
            }))
          ) {
            return true;
          }
          return browserMcpContext
            ? consumeMcpToolAllowance(browserMcpContext, toolName)
            : false;
        },
      });
    }
    if (capabilities.includes("mcp.connectors")) {
      const readyProviders = await listReadyMcpProviders(
        input.context.database,
        input.context.vault.clientInstanceId,
      );
      for (const [providerIndex, provider] of readyProviders.entries()) {
        let client: McpConnectorClient | null = null;
        try {
          client = await createRuntimeMcpClient({
            endpoint: provider.endpointUrl,
            vault: input.context.vault,
            credentialRef: provider.credentialRef,
          });
          await client.connect();
          const discovered = await client.listTools();
          const brokeredTools = provider.bindings.flatMap(
            (binding): BrokeredTool[] => {
              const tool = discovered.find(
                (candidate) =>
                  candidate.name === binding.nativeToolName &&
                  candidate.inputSchemaSha256 === binding.inputSchemaSha256 &&
                  candidate.outputSchemaSha256 === binding.outputSchemaSha256,
              );
              return tool
                ? [
                    {
                      bindingId: binding.bindingId,
                      providerId: provider.providerId,
                      capabilityKey: `mcp.connector.${provider.providerKey}`,
                      operation: binding.nativeToolName,
                      contractVersion: 1,
                      effect: "ask",
                      tool,
                    },
                  ]
                : [];
            },
          );
          if (brokeredTools.length === 0) {
            await client.close();
            client = null;
            continue;
          }
          const serverName = connectorMcpServerName(
            provider.label,
            provider.providerId,
            providerIndex,
          );
          const permissionContext: ActiveMcpPermissionContext = {
            providerId: provider.providerId,
            serverLabel: provider.label,
            serverName,
            bindingIds: new Map(
              brokeredTools.map((tool) => [tool.tool.name, tool.bindingId]),
            ),
            allowedTools: new Set(),
            oneTimeTools: new Map(),
          };
          const server = await startBrokeredMcpServer({
            name: serverName,
            providerId: provider.providerId,
            client,
            tools: brokeredTools,
            approvalResolver: {
              isApproved: ({ providerId, bindingId }) =>
                hasMcpApproval(input.context.database, {
                  providerId,
                  bindingId,
                }),
            },
            authorize: (binding) =>
              consumeMcpToolAllowance(permissionContext, binding.tool.name),
          });
          connectorMcpClients.push(client);
          connectorMcpServers.push(server);
          connectorMcpContexts.push(permissionContext);
          client = null;
        } catch (error) {
          await client?.close().catch(() => undefined);
          if (process.env.RADIUS_RUNTIME_DEBUG === "1") {
            console.error(
              "[mcp] connector unavailable",
              provider.label,
              error instanceof Error ? error.message : "unknown error",
            );
          }
        }
      }
    }
    if (
      capabilities.includes("shell.execute") &&
      input.projectRoots.length > 0
    ) {
      terminalManager = new MacOsTerminalManager({
        fullAccess: input.accessMode === "full",
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
    const mcpServers = [
      ...(browserTools
        ? [
            {
              type: "http" as const,
              name: "radius-browser",
              url: browserTools.url,
              headers: browserTools.headers,
            },
          ]
        : []),
      ...connectorMcpServers.map((server) => ({
        type: "http" as const,
        name: server.name,
        url: server.url,
        headers: server.headers,
      })),
    ];
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
      onPermissionRequest: async (
        request: RequestPermissionRequest,
        signal: AbortSignal,
      ) => {
        const rawToolName =
          request.toolCall.name?.trim() || request.toolCall.title?.trim() || "";
        const contexts = [
          ...(browserMcpContext ? [browserMcpContext] : []),
          ...connectorMcpContexts,
        ];
        const permissionContext =
          contexts.find((context) =>
            rawToolName.startsWith(`mcp__${context.serverName}__`),
          ) ??
          contexts.find((context) =>
            Boolean(resolveMcpPermissionTool(context, rawToolName)),
          );
        if (!permissionContext) return { outcome: "cancelled" };
        return awaitMcpPermission(
          {
            agentRunId,
            database: input.context.database,
            journal: input.journal,
            providerId: permissionContext.providerId,
            serverLabel: permissionContext.serverLabel,
            serverName: permissionContext.serverName,
            sessionId: input.sessionId,
            toolCallEventIds: updateState.toolCallEventIds,
            resolveTool: (toolName) =>
              resolveMcpPermissionTool(permissionContext, toolName),
            recordApproval: async (selection, nativeToolName) => {
              if (selection === "allow_server") return;
              rememberMcpToolAllowance(
                permissionContext,
                selection,
                nativeToolName,
              );
            },
          },
          request,
          signal,
        );
      },
      terminal: terminalManager ?? undefined,
      onUpdate: async ({ update }: { update: SessionUpdate }) => {
        if (update.sessionUpdate === "agent_message_chunk") {
          if (update.content.type === "text") {
            const textOffset = responseText.length;
            responseText += update.content.text;
            if (responseParts) {
              appendResponseText(responseParts, update.content.text);
            }
            publishStreamingSessionMessage(
              input.sessionId,
              streamedMessage("streaming", responseText),
              update.content.text,
              textOffset,
            );
          } else if (update.content.type === "image") {
            responseParts ??= responseText
              ? [{ kind: "text", text: responseText }]
              : [];
            responseParts.push({
              kind: "image",
              image: await persistAgentImage(input.sessionId, update.content),
            });
          }
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

    const collectedResponseParts =
      responseParts ??
      (responseText ? [{ kind: "text" as const, text: responseText }] : []);
    const finalizedResponseParts = fxProfile
      ? await importFxGeneratedImages(
          input.sessionId,
          fxProfile.path,
          collectedResponseParts,
        )
      : collectedResponseParts;
    responseText = finalizedResponseParts
      .flatMap((part) => (part.kind === "text" ? [part.text] : []))
      .join("");
    const messageParts = durableMessageParts(finalizedResponseParts);
    if (messageParts.length > 0) {
      const images = finalizedResponseParts.flatMap((part) =>
        part.kind === "image" ? [part.image] : [],
      );
      await input.journal.append(
        {
          eventId: assistantMessageEventId,
          agentRunId,
          eventType: "message",
          role: "assistant",
          messageKind: "final",
          status: result.stopReason === "cancelled" ? "cancelled" : "completed",
          model: input.modelId,
          providerMessageId: null,
          finishReason: result.stopReason,
          parts: messageParts,
        },
        {
          artifactLinks: images.map((image) => image.artifactLink),
          fileLocations: Object.fromEntries(
            images.map((image) => [
              image.artifactLink.artifact.id,
              image.fileLocation,
            ]),
          ),
        },
      );
      broadcastSessionTranscriptStream({
        sessionId: input.sessionId,
        eventId: assistantMessageEventId,
        event: streamedMessage(
          result.stopReason === "cancelled" ? "cancelled" : "completed",
          responseText.trim(),
          images.map((image) => ({
            id: image.artifactLink.artifact.id,
            name: image.artifactLink.artifact.name,
            artifactType: "image",
            storageKind: "file",
            mimeType:
              image.artifactLink.artifact.storageKind === "file"
                ? image.artifactLink.artifact.mimeType
                : null,
            availability: "local",
            url: null,
          })),
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
    await Promise.allSettled(
      connectorMcpServers.map((server) => server.close()),
    );
    await Promise.allSettled(
      connectorMcpClients.map((client) => client.close()),
    );
    await fxProfile?.finalize();
  }
}

function connectorMcpServerName(
  label: string,
  providerId: string,
  index: number,
): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const identity = providerId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  return `radius-${slug || "connector"}-${identity || index + 1}`;
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

async function appendRuntimeUpdate(
  journal: RuntimeSessionJournal,
  agentRunId: string,
  state: RuntimeUpdateState,
  update: SessionUpdate,
): Promise<void> {
  if (await applyAgentSessionTitleUpdate(journal, update)) return;
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
