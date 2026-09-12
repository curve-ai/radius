import {
  assertDesktopAuthenticated,
  platformAgentCredential,
  platformAgentId,
} from "./desktop-auth";
import {
  clearComposerDraft,
  createSession,
  ensureBuiltinToolBinding,
  ensureBuiltinToolProvider,
  getLatestAgentProviderSession,
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
  setSessionArchived,
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
  type AcpElicitationHandler,
  type AcpRuntimeHandlers,
  type AcpAuthenticationHandler,
  type AcpPermissionDecision,
  type AgentReleaseDescriptor,
  type AcpRuntimePromptResult,
  type ContentBlock,
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
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import type {
  DesktopAgentSummary,
  DesktopRuntimeStatus,
  SessionTranscriptStreamUpdate,
  SessionWorkingStateUpdate,
  SetAgentSessionConfigOptionInput,
  StartAgentPromptInput,
  StartAgentPromptResult,
  StreamingSessionTranscriptMessage,
  ToolApprovalSelection,
  DesktopAgentSessionFeatures,
} from "../radius-api";
import {
  SESSION_RUN_ACTIVITY_DETAIL,
  SESSION_TRANSCRIPT_STREAM_CHANNEL,
  SESSION_WORKING_STATE_CHANNEL,
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
  removeAgentPlanJournalEvents,
  type AgentPlanJournalState,
} from "./agent-plan-events";
import {
  agentPlanReasoningSummaries,
  applyAgentPlanProjectionUpdate,
  createAgentPlanProjectionState,
  type AgentPlanProjectionState,
} from "./agent-plan-projection";
import {
  AGENT_SESSION_FEATURE_CLIENT_CAPABILITIES,
  agentSessionFeatureOverrideKey,
  applyAgentSessionFeatureUpdate,
  resolveAgentSessionConfigSelection,
  resolveAgentSessionFeatureOwner,
  resolveAgentSessionModeSelection,
  type AgentSessionFeatureOwner,
  type AgentSessionFeatureState,
} from "./agent-session-features";
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
  type TerminalExecutionProgress,
  type TerminalExecutionResult,
} from "./terminal-execution";
import { applyAgentSessionTitleUpdate } from "./agent-session-title";
import {
  RuntimeSessionJournal,
  type RuntimeSessionEvent,
} from "./runtime-session-journal";
import {
  AgentElicitationManager,
  type PendingElicitationSummary,
  type ResolveElicitationInput,
} from "./agent-elicitation-manager";
import {
  assertPromptAttachmentCapabilities,
  parsePromptAttachments,
  validatePromptAttachments,
  type ValidatedPromptAttachment,
} from "./prompt-attachments";
import { writeContentAddressedFile } from "./content-addressed-file";
import {
  createAgentRunStartup,
  type AgentRunStartup,
} from "./agent-run-startup";
import {
  developmentPromptCapabilitiesKey,
  releasePromptCapabilitiesKey,
  sameAgentPromptCapabilities,
  type AgentPromptCapabilities,
} from "./agent-prompt-capabilities";
import { acceptAgentPrompt } from "./agent-prompt-acceptance";

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
  planProjection: AgentPlanProjectionState;
  toolCallEventIds: Map<string, string>;
}
type StreamedMessageEvent = NonNullable<SessionTranscriptStreamUpdate["event"]>;
type AgentTarget =
  | { kind: "development"; connection: DevelopmentAgentConnection }
  | { kind: "release"; release: AgentReleaseDescriptor };

function agentProviderKey(target: AgentTarget): string {
  return target.kind === "release"
    ? `${target.release.providerId}:${target.release.agentId}`
    : `radius-development:${target.connection.agentId}`;
}

interface RunningAgentRuntime {
  prompt(content: ContentBlock[]): Promise<AcpRuntimePromptResult>;
  setConfigOption(
    configId: string,
    value: string | boolean,
  ): Promise<AcpRuntimeSession["sessionConfigOptions"]>;
  setMode(modeId: string): Promise<void>;
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

interface PersistedArtifact {
  artifactLink: SessionArtifactLink;
  fileLocation: string;
}

type CollectedResponsePart =
  { kind: "text"; text: string } | { kind: "image"; image: PersistedArtifact };

async function persistAgentImage(
  sessionId: string,
  content: AgentImageContent,
): Promise<PersistedArtifact> {
  const { bytes, extension, mimeType } = decodeAgentImage(content);
  return persistAgentImageBytes(sessionId, bytes, mimeType, extension);
}

async function persistAgentImageBytes(
  sessionId: string,
  bytes: Buffer,
  mimeType: string,
  extension: string,
  displayName?: string,
): Promise<PersistedArtifact> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AGENT_IMAGE_BYTES) {
    throw new Error("AGENT_IMAGE_TOO_LARGE");
  }
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
  const name = safeDisplayName ? `${safeDisplayName}.${extension}` : undefined;
  return persistArtifactBytes({
    sessionId,
    bytes,
    extension,
    name,
    artifactType: "image",
    mimeType,
    relationship: "output",
    conflictCode: "AGENT_IMAGE_STORE_CONFLICT",
  });
}

async function persistPromptAttachment(
  sessionId: string,
  attachment: ValidatedPromptAttachment,
): Promise<PersistedArtifact> {
  const providedExtension = path
    .extname(attachment.name)
    .slice(1)
    .toLowerCase();
  const extension = /^[a-z0-9]{1,12}$/.test(providedExtension)
    ? providedExtension
    : attachment.artifactType === "image"
      ? (radiusImageExtension(attachment.mimeType) ?? "img")
      : "bin";
  return persistArtifactBytes({
    sessionId,
    bytes: attachment.bytes,
    extension,
    name: attachment.name,
    artifactType: attachment.artifactType,
    mimeType: attachment.mimeType,
    relationship: "input",
    conflictCode: "PROMPT_ATTACHMENT_STORE_CONFLICT",
  });
}

async function persistArtifactBytes(input: {
  sessionId: string;
  bytes: Buffer;
  extension: string;
  name?: string;
  artifactType: SessionArtifactLink["artifact"]["artifactType"];
  mimeType: string;
  relationship: SessionArtifactLink["relationship"];
  conflictCode: string;
}): Promise<PersistedArtifact> {
  const contentSha256 = createHash("sha256").update(input.bytes).digest("hex");
  const fileLocation = path.posix.join(
    "sha256",
    contentSha256.slice(0, 2),
    `${contentSha256}.${input.extension}`,
  );
  const artifactRoot = path.join(app.getPath("userData"), "artifacts");
  const targetPath = path.join(artifactRoot, ...fileLocation.split("/"));
  await writeContentAddressedFile({
    bytes: input.bytes,
    conflictCode: input.conflictCode,
    contentSha256,
    targetPath,
  });
  return {
    fileLocation,
    artifactLink: {
      relationship: input.relationship,
      artifact: {
        id: randomUUID(),
        sessionId: input.sessionId,
        name:
          input.name ??
          `generated-image-${contentSha256.slice(0, 12)}.${input.extension}`,
        artifactType: input.artifactType,
        storageKind: "file",
        mimeType: input.mimeType,
        contentSha256,
        byteSize: input.bytes.byteLength,
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
const agentSessionFeatures = new Map<string, AgentSessionFeatureOwner>();
const agentSessionConfigOverrides = new Map<
  string,
  Map<string, string | boolean>
>();
const agentSessionModeOverrides = new Map<string, string>();
const agentPromptCapabilities = new Map<string, AgentPromptCapabilities>();
const agentElicitations = new AgentElicitationManager();
const streamingSessionMessages = new Map<
  string,
  StreamingSessionTranscriptMessage
>();

function desktopAgentSessionFeatures(
  owner: AgentSessionFeatureOwner,
): DesktopAgentSessionFeatures {
  const { state } = owner;
  return {
    agentId: owner.agentId,
    availableCommands: state.availableCommands.map((command) => ({
      name: command.name,
      description: command.description,
      inputHint: command.input?.hint ?? null,
    })),
    configOptions: state.configOptions.map((option) =>
      option.type === "boolean"
        ? {
            id: option.id,
            label: option.name,
            description: option.description ?? null,
            category: option.category ?? null,
            type: "boolean" as const,
            currentValue: option.currentValue,
          }
        : {
            id: option.id,
            label: option.name,
            description: option.description ?? null,
            category: option.category ?? null,
            type: "select" as const,
            currentValue: option.currentValue,
            options: option.options.flatMap((entry) =>
              "options" in entry
                ? entry.options.map((value) => ({
                    id: value.value,
                    label: value.name,
                    description: value.description ?? null,
                    groupId: entry.group,
                    groupLabel: entry.name,
                  }))
                : [
                    {
                      id: entry.value,
                      label: entry.name,
                      description: entry.description ?? null,
                      groupId: null,
                      groupLabel: null,
                    },
                  ],
            ),
          },
    ),
    modes: state.modes
      ? {
          currentModeId: state.modes.currentModeId,
          availableModes: state.modes.availableModes.map((mode) => ({
            id: mode.id,
            label: mode.name,
            description: mode.description ?? null,
          })),
        }
      : null,
    usage: state.usage
      ? {
          used: state.usage.used,
          size: state.usage.size,
          cost: state.usage.cost
            ? {
                amount: state.usage.cost.amount,
                currency: state.usage.cost.currency,
              }
            : null,
        }
      : null,
  };
}

export async function getAgentSessionFeatures(
  rawInput: unknown,
): Promise<DesktopAgentSessionFeatures | null> {
  if (!rawInput || typeof rawInput !== "object") return null;
  const input = rawInput as Record<string, unknown>;
  if (
    typeof input.sessionId !== "string" ||
    !input.sessionId ||
    typeof input.agentId !== "string" ||
    !input.agentId
  ) {
    return null;
  }
  const owner = agentSessionFeatures.get(input.sessionId);
  return owner?.agentId === input.agentId
    ? desktopAgentSessionFeatures(owner)
    : null;
}

export async function listPendingAgentElicitations(
  sessionId: string,
): Promise<PendingElicitationSummary[]> {
  return agentElicitations.listPending(sessionId);
}

export async function resolveAgentElicitation(
  input: ResolveElicitationInput,
): Promise<void> {
  agentElicitations.resolve(input);
}

export async function setAgentSessionConfigOption(
  rawInput: SetAgentSessionConfigOptionInput,
): Promise<DesktopAgentSessionFeatures | null> {
  if (
    !rawInput ||
    typeof rawInput !== "object" ||
    typeof rawInput.sessionId !== "string" ||
    !rawInput.sessionId ||
    typeof rawInput.agentId !== "string" ||
    !rawInput.agentId ||
    typeof rawInput.configId !== "string" ||
    !rawInput.configId ||
    (typeof rawInput.value !== "string" && typeof rawInput.value !== "boolean")
  ) {
    throw new Error("ACP_SESSION_CONFIG_OPTION_INVALID");
  }
  const owner = agentSessionFeatures.get(rawInput.sessionId);
  if (!owner || owner.agentId !== rawInput.agentId) return null;
  const { state } = owner;
  const selection = resolveAgentSessionConfigSelection(
    state.configOptions,
    rawInput.configId,
    rawInput.value,
  );
  if (!selection) throw new Error("ACP_SESSION_CONFIG_OPTION_INVALID");

  const runtime = runningSessions.get(rawInput.sessionId);
  if (runtime) {
    state.configOptions = await runtime.setConfigOption(
      selection.configId,
      selection.value,
    );
  } else {
    state.configOptions = state.configOptions.map((option) =>
      option.id === selection.configId
        ? { ...option, currentValue: selection.value }
        : option,
    ) as AgentSessionFeatureState["configOptions"];
  }
  const overrides =
    agentSessionConfigOverrides.get(
      agentSessionFeatureOverrideKey(rawInput.sessionId, owner.providerKey),
    ) ?? new Map();
  overrides.set(selection.configId, selection.value);
  agentSessionConfigOverrides.set(
    agentSessionFeatureOverrideKey(rawInput.sessionId, owner.providerKey),
    overrides,
  );
  return desktopAgentSessionFeatures(owner);
}

export async function setAgentSessionMode(rawInput: {
  sessionId: string;
  agentId: string;
  modeId: string;
}): Promise<DesktopAgentSessionFeatures | null> {
  if (
    !rawInput ||
    typeof rawInput !== "object" ||
    typeof rawInput.sessionId !== "string" ||
    !rawInput.sessionId ||
    typeof rawInput.agentId !== "string" ||
    !rawInput.agentId ||
    typeof rawInput.modeId !== "string" ||
    !rawInput.modeId
  ) {
    throw new Error("ACP_SESSION_MODE_INVALID");
  }
  const owner = agentSessionFeatures.get(rawInput.sessionId);
  if (!owner || owner.agentId !== rawInput.agentId) return null;
  const { state } = owner;
  if (!state.modes) return desktopAgentSessionFeatures(owner);
  const selection = resolveAgentSessionModeSelection(
    state.modes,
    rawInput.modeId,
  );
  if (!selection) {
    throw new Error("ACP_SESSION_MODE_INVALID");
  }
  const runtime = runningSessions.get(rawInput.sessionId);
  if (runtime) await runtime.setMode(selection.modeId);
  state.modes = { ...state.modes, currentModeId: selection.modeId };
  agentSessionModeOverrides.set(
    agentSessionFeatureOverrideKey(rawInput.sessionId, owner.providerKey),
    selection.modeId,
  );
  return desktopAgentSessionFeatures(owner);
}

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

function broadcastSessionWorkingState(update: SessionWorkingStateUpdate): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(SESSION_WORKING_STATE_CHANNEL, update);
  }
}

function markSessionWorking(sessionId: string): void {
  if (workingSessions.has(sessionId)) return;
  workingSessions.add(sessionId);
  broadcastSessionWorkingState({ sessionId, working: true });
}

function clearSessionWorking(sessionId: string): void {
  if (!workingSessions.delete(sessionId)) return;
  broadcastSessionWorkingState({ sessionId, working: false });
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
    agents.push(
      desktopAgentSummary(release, authentication, installation.updatedAt),
    );
  }
  const agentId = platformAgentId();
  return agentId ? agents.filter((agent) => agent.id === agentId) : agents;
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
  return desktopAgentSummary(release, authentication, installation.updatedAt);
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
  return desktopAgentSummary(release, authentication, installation.updatedAt);
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
  assertDesktopAuthenticated();
  platformAgentCredential(rawInput.agentId);
  const input = parsePromptInput(rawInput);
  const prompt = input.prompt.trim();
  const promptAttachments = validatePromptAttachments(input.attachments ?? [], {
    image: true,
    audio: true,
    embeddedContext: true,
  });
  if (!prompt && promptAttachments.length === 0) {
    throw new Error("A prompt or attachment is required");
  }
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
  const [existingRevision, existingSessionContext] = input.sessionId
    ? await Promise.all([
        getSessionRevision(context.database, input.sessionId),
        getSessionProjectContext(context.database, input.sessionId),
      ])
    : [null, null];
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
      title: promptTitle(prompt || promptAttachments[0]!.name),
    });
  }
  const journal = new RuntimeSessionJournal(
    context.database,
    identity.clientInstanceId,
    session.id,
    session.revision,
  );
  const userMessageEventId = randomUUID();
  const persistedPromptAttachments = await Promise.all(
    promptAttachments.map((attachment) =>
      persistPromptAttachment(session.id, attachment),
    ),
  );
  const providerKey = agentProviderKey(target);
  const previousProviderSession = input.sessionId
    ? await getLatestAgentProviderSession(
        context.database,
        input.sessionId,
        providerKey,
      )
    : null;
  const startup = createAgentRunStartup();
  markSessionWorking(session.id);
  void runAgentSession({
    accessMode: input.accessMode,
    context,
    continuingSession: Boolean(input.sessionId),
    modelId,
    persistedPromptAttachments,
    promptAttachments,
    providerSessionId: previousProviderSession?.providerSessionId ?? null,
    startup,
    target,
    prompt,
    projectRoots,
    sessionId: session.id,
    thinkingEffortId,
    userMessageEventId,
    journal,
  });
  try {
    await startup.promise;
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
  } catch (error) {
    if (!input.sessionId) {
      await setSessionArchived(context.database, {
        originClientInstanceId: identity.clientInstanceId,
        sessionId: session.id,
      }).catch(() => undefined);
    }
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
    attachments: parsePromptAttachments(value.attachments),
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
  currentMessageEventId: string,
): string {
  const messages = events.filter(
    (
      event,
    ): event is Extract<(typeof events)[number], { eventType: "message" }> =>
      event.eventType === "message" &&
      event.eventId !== currentMessageEventId &&
      Boolean(event.text.trim()),
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
  agentElicitations.cancelSession(sessionId);
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
    agentElicitations.cancelSession(sessionId);
  }
  for (const sessionId of [...streamingSessionMessages.keys()]) {
    clearStreamingSessionMessage(sessionId);
  }
  runningSessions.clear();
  runningTerminalManagers.clear();
  for (const sessionId of [...workingSessions]) {
    clearSessionWorking(sessionId);
  }
  agentSessionFeatures.clear();
  agentSessionConfigOverrides.clear();
  agentSessionModeOverrides.clear();
  agentPromptCapabilities.clear();
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
    operation: "Running command",
    inputSchemaId: "radius.shell.execute",
    inputSchemaVersion: 1,
    input: {
      command: request.command,
      args: request.args,
      cwd: request.cwd,
      environment: request.environment,
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

async function appendTerminalProgress(
  journal: RuntimeSessionJournal,
  agentRunId: string,
  result: TerminalExecutionProgress,
): Promise<void> {
  await journal.append({
    eventId: randomUUID(),
    agentRunId,
    eventType: "tool_progress",
    toolCallEventId: result.correlationId,
    progressSchemaId: "radius.shell.progress",
    progressSchemaVersion: 1,
    progress: {
      exitCode: result.exitCode,
      output: result.output,
      outputTruncated: result.outputTruncated,
      signal: result.signal,
      status:
        result.exitCode === null && result.signal === null
          ? "in_progress"
          : result.exitCode === 0
            ? "completed"
            : "failed",
    },
  });
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
      output: result.output,
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
    operation: `${request.operation === "read" ? "Reading" : "Writing"} ${path.basename(request.path)}`,
    inputSchemaId: `radius.workspace.files.${request.operation}`,
    inputSchemaVersion: 1,
    input: {
      path: request.path,
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
  continuingSession: boolean;
  modelId: string | null;
  persistedPromptAttachments: PersistedArtifact[];
  promptAttachments: ValidatedPromptAttachment[];
  providerSessionId: string | null;
  startup: AgentRunStartup;
  target: AgentTarget;
  prompt: string;
  projectRoots: string[];
  sessionId: string;
  thinkingEffortId: string | null;
  userMessageEventId: string;
  journal: RuntimeSessionJournal;
}): Promise<void> {
  const agentRunId = randomUUID();
  let assistantMessageEventId = randomUUID();
  let assistantMessageOccurredAt = new Date().toISOString();
  let responseProviderMessageId: string | null = null;
  let responseText = "";
  let responseParts: CollectedResponsePart[] | null = null;
  let thoughtMessageId: string | null = null;
  let thoughtText = "";
  const streamedMessage = <Status extends StreamedMessageEvent["status"]>(
    status: Status,
    text: string,
    artifacts: StreamingSessionTranscriptMessage["artifacts"] = [],
    messageKind: "progress" | "final" = "progress",
  ): Extract<StreamedMessageEvent, { status: Status }> =>
    ({
      eventId: assistantMessageEventId,
      sessionRevision: Number.MAX_SAFE_INTEGER,
      occurredAt: assistantMessageOccurredAt,
      agentRunId,
      eventType: "message",
      role: "assistant",
      messageKind,
      status,
      text,
      artifacts,
    }) as Extract<StreamedMessageEvent, { status: Status }>;
  const updateState: RuntimeUpdateState = {
    hostToolKinds: new Set(),
    plan: createAgentPlanJournalState(),
    planProjection: createAgentPlanProjectionState(),
    toolCallEventIds: new Map(),
  };
  const release = input.target.kind === "release" ? input.target.release : null;
  const developmentConnection =
    input.target.kind === "development" ? input.target.connection : null;
  const displayName =
    release?.displayName ?? developmentConnection!.displayName;
  const providerKey = agentProviderKey(input.target);
  const agentId = release?.agentId ?? developmentConnection!.agentId;
  const existingFeatureOwner = agentSessionFeatures.get(input.sessionId);
  const featureOwner = resolveAgentSessionFeatureOwner(
    existingFeatureOwner,
    agentId,
    providerKey,
  );
  const featureState = featureOwner.state;
  agentSessionFeatures.set(input.sessionId, featureOwner);
  const capabilities =
    release?.capabilities ?? developmentConnection!.capabilities;
  let runtime: RunningAgentRuntime | null = null;
  let credentialExpiryTimer: NodeJS.Timeout | null = null;
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

  const resetResponseBuffer = (providerMessageId: string | null): void => {
    assistantMessageEventId = randomUUID();
    assistantMessageOccurredAt = new Date().toISOString();
    responseProviderMessageId = providerMessageId;
    responseText = "";
    responseParts = null;
  };

  const persistBufferedResponse = async (
    messageKind: "progress" | "final",
    status: "completed" | "cancelled",
    finishReason: string | null,
  ): Promise<boolean> => {
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
    const messageText = finalizedResponseParts
      .flatMap((part) => (part.kind === "text" ? [part.text] : []))
      .join("");
    const messageParts = durableMessageParts(finalizedResponseParts);
    if (messageParts.length === 0) return false;

    const images = finalizedResponseParts.flatMap((part) =>
      part.kind === "image" ? [part.image] : [],
    );
    await input.journal.append(
      {
        eventId: assistantMessageEventId,
        agentRunId,
        eventType: "message",
        role: "assistant",
        messageKind,
        status,
        model: input.modelId,
        providerMessageId: responseProviderMessageId,
        finishReason,
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
        status,
        messageText.trim(),
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
        messageKind,
      ),
      mode: "replace",
    });
    streamingSessionMessages.delete(input.sessionId);
    return true;
  };

  const flushProgressResponse = async (): Promise<void> => {
    if (await persistBufferedResponse("progress", "completed", null)) {
      resetResponseBuffer(null);
    }
  };

  const flushThought = async (): Promise<void> => {
    const summaryText = thoughtText.trim();
    thoughtMessageId = null;
    thoughtText = "";
    if (!summaryText) return;
    await input.journal.append({
      eventId: randomUUID(),
      agentRunId,
      eventType: "reasoning_summary",
      summaryKind: "analysis",
      summaryText,
    });
  };

  let agentRunRecorded = false;
  let userMessageRecorded = false;
  const recordAgentRun = async (
    providerRunId: string | null,
  ): Promise<void> => {
    if (agentRunRecorded) return;
    await input.journal.append({
      eventId: randomUUID(),
      agentRunId,
      eventType: "agent_run",
      providerKey,
      providerRunId,
      triggeringMessageEventId: input.userMessageEventId,
    });
    agentRunRecorded = true;
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
  };

  try {
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
        onProgress: (result) =>
          appendTerminalProgress(input.journal, agentRunId, result),
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
    const handleElicitation = async (
      request: Parameters<AcpElicitationHandler>[0],
      signal: Parameters<AcpElicitationHandler>[1],
      waitingDetail: string,
    ): ReturnType<AcpElicitationHandler> => {
      if (agentRunRecorded) {
        await input.journal.append({
          eventId: randomUUID(),
          agentRunId,
          eventType: "agent_run_state_update",
          state: "waiting_for_user",
          detail: waitingDetail,
        });
      }
      try {
        return await agentElicitations.handle(input.sessionId, request, signal);
      } finally {
        if (!signal.aborted && agentRunRecorded) {
          await input.journal.append({
            eventId: randomUUID(),
            agentRunId,
            eventType: "agent_run_state_update",
            state: "working",
            detail: SESSION_RUN_ACTIVITY_DETAIL.resumingWork,
          });
        }
      }
    };
    const handlers: AcpRuntimeHandlers = {
      elicitation: {
        form: (request, signal) =>
          handleElicitation(
            request,
            signal,
            "Waiting for requested information",
          ),
        url: (request, signal) =>
          handleElicitation(
            request,
            signal,
            "Waiting for external authorization",
          ),
        onComplete: (notification) => {
          agentElicitations.completeUrl(
            input.sessionId,
            notification.elicitationId,
          );
        },
      },
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
      onReplayUpdate: ({ update }) => {
        applyAgentSessionFeatureUpdate(featureState, update);
      },
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
        applyAgentSessionFeatureUpdate(featureState, update);
        if (
          update.sessionUpdate !== "agent_thought_chunk" &&
          thoughtText.trim()
        ) {
          await flushThought();
        }
        if (
          update.sessionUpdate === "tool_call" &&
          (responseText.trim() || responseParts?.length)
        ) {
          await flushProgressResponse();
        }
        if (update.sessionUpdate === "agent_thought_chunk") {
          if (responseText.trim() || responseParts?.length) {
            await flushProgressResponse();
          }
          if (update.content.type === "text") {
            const nextMessageId = update.messageId?.trim() || null;
            if (
              thoughtText.trim() &&
              nextMessageId &&
              thoughtMessageId &&
              nextMessageId !== thoughtMessageId
            ) {
              await flushThought();
            }
            thoughtMessageId ??= nextMessageId;
            thoughtText += update.content.text;
          }
          return;
        }
        if (update.sessionUpdate === "agent_message_chunk") {
          const nextMessageId = update.messageId?.trim() || null;
          if (
            (responseText.trim() || responseParts?.length) &&
            nextMessageId &&
            responseProviderMessageId &&
            nextMessageId !== responseProviderMessageId
          ) {
            await flushProgressResponse();
          }
          responseProviderMessageId ??= nextMessageId;
          if (update.content.type === "text") {
            const textOffset = responseText.length;
            responseText += update.content.text;
            if (responseParts) {
              appendResponseText(responseParts, update.content.text);
            }
            publishStreamingSessionMessage(
              input.sessionId,
              streamedMessage("streaming", responseText, [], "progress"),
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
    const platformCredential = platformAgentCredential(
      input.target.kind === "release"
        ? input.target.release.agentId
        : input.target.connection.agentId,
    );
    if (platformCredential)
      credentialExpiryTimer = setTimeout(
        () => {
          input.startup.reject(new Error("AUTH_SESSION_EXPIRED"));
          void runtime?.stop();
        },
        Math.max(0, Date.parse(platformCredential.expiresAt) - Date.now()),
      );
    const authenticate: AcpAuthenticationHandler = async (methods) => {
      assertDesktopAuthenticated();
      if (!platformCredential) {
        const supported = methods.filter(
          (method) =>
            method.id !== "radius-oauth" &&
            !("type" in method && method.type === "terminal"),
        );
        if (!supported.length) return null;
        if (supported.length === 1) return supported[0]!.id;
        throw new Error("ACP_AUTHENTICATION_SELECTION_REQUIRED");
      }
      if (!methods.some((method) => method.id === "radius-oauth"))
        throw new Error("AGENT_NATIVE_AUTH_UNSUPPORTED");
      return {
        methodId: "radius-oauth",
        credential: {
          accessToken: platformCredential.accessToken,
          expiresAt: platformCredential.expiresAt,
        },
      };
    };
    let acpSession: AcpRuntimeSession;
    const sessionStart = input.providerSessionId
      ? ({ kind: "auto", sessionId: input.providerSessionId } as const)
      : ({ kind: "new" } as const);
    const additionalDirectories = input.projectRoots.slice(1);
    if (developmentConnection) {
      const session = await AcpRuntimeSession.connect(
        acpStreamFromWebSocket(
          developmentConnection.endpoint,
          developmentConnection.authorization,
        ),
        {
          additionalDirectories,
          clientCapabilities: AGENT_SESSION_FEATURE_CLIENT_CAPABILITIES,
          cwd: input.projectRoots[0] ?? developmentConnection.cwd,
          modelId: input.modelId,
          mcpServers,
          handlers,
          clientName: "radius-desktop-development",
          onAuthenticate: authenticate,
          session: sessionStart,
        },
      );
      acpSession = session;
      runtime = {
        prompt: (content) => session.prompt(content, { collectText: false }),
        setConfigOption: (configId, value) =>
          session.setConfigOption(configId, value),
        setMode: (modeId) => session.setMode(modeId),
        cancel: () => session.cancel(),
        stop: async () => session.close(),
      };
    } else {
      const microvm = await MicrovmAcpRuntime.start({
        additionalDirectories,
        clientCapabilities: AGENT_SESSION_FEATURE_CLIENT_CAPABILITIES,
        release: release!,
        modelId: input.modelId,
        paths: resolveMicrovmPaths(release!, fxProfile?.path),
        cwd: input.projectRoots[0] ?? release!.process.statePath,
        mcpServers,
        handlers,
        onAuthenticate:
          !platformCredential && release && isFxRelease(release)
            ? undefined
            : authenticate,
        session: sessionStart,
        onStderr: (chunk) => {
          if (process.env.RADIUS_RUNTIME_DEBUG === "1") {
            console.error("[runtime]", chunk.trimEnd());
          }
        },
      });
      acpSession = microvm.session;
      runtime = {
        prompt: (content) => microvm.prompt(content, { collectText: false }),
        setConfigOption: (configId, value) =>
          acpSession.setConfigOption(configId, value),
        setMode: (modeId) => acpSession.setMode(modeId),
        cancel: () => microvm.cancel(),
        stop: () => microvm.stop(),
      };
    }
    featureState.configOptions = [...acpSession.sessionConfigOptions];
    featureState.modes = acpSession.sessionModes
      ? {
          currentModeId: acpSession.sessionModes.currentModeId,
          availableModes: [...acpSession.sessionModes.availableModes],
        }
      : null;
    const overrideKey = agentSessionFeatureOverrideKey(
      input.sessionId,
      providerKey,
    );
    const overrides = agentSessionConfigOverrides.get(overrideKey);
    if (overrides) {
      for (const [configId, value] of overrides) {
        const selection = resolveAgentSessionConfigSelection(
          featureState.configOptions,
          configId,
          value,
        );
        if (!selection) continue;
        featureState.configOptions = await runtime.setConfigOption(
          selection.configId,
          selection.value,
        );
      }
    }
    const modeOverride = agentSessionModeOverrides.get(overrideKey);
    const modeSelection = modeOverride
      ? resolveAgentSessionModeSelection(featureState.modes, modeOverride)
      : null;
    if (modeSelection) {
      await runtime.setMode(modeSelection.modeId);
      featureState.modes = {
        ...featureState.modes!,
        currentModeId: modeSelection.modeId,
      };
    }
    const promptCapabilityKey =
      input.target.kind === "release"
        ? releasePromptCapabilitiesKey(input.target.release)
        : developmentPromptCapabilitiesKey(input.target.connection);
    const promptCapabilities = {
      image: acpSession.agentCapabilities.promptCapabilities?.image === true,
      audio: acpSession.agentCapabilities.promptCapabilities?.audio === true,
      embeddedContext:
        acpSession.agentCapabilities.promptCapabilities?.embeddedContext ===
        true,
    };
    if (
      !sameAgentPromptCapabilities(
        agentPromptCapabilities.get(promptCapabilityKey),
        promptCapabilities,
      )
    ) {
      agentPromptCapabilities.set(promptCapabilityKey, promptCapabilities);
    }
    await acceptAgentPrompt({
      assertCapabilities: () =>
        assertPromptAttachmentCapabilities(
          input.promptAttachments,
          acpSession.agentCapabilities.promptCapabilities,
        ),
      appendPrompt: async () => {
        await input.journal.append(
          {
            eventId: input.userMessageEventId,
            agentRunId: null,
            eventType: "message",
            role: "user",
            messageKind: "prompt",
            status: "completed",
            model: null,
            providerMessageId: null,
            finishReason: null,
            parts: [
              ...(input.prompt
                ? [
                    {
                      id: randomUUID(),
                      position: 0,
                      partType: "text" as const,
                      text: input.prompt,
                    },
                  ]
                : []),
              ...input.persistedPromptAttachments.map((attachment, index) => ({
                id: randomUUID(),
                position: (input.prompt ? 1 : 0) + index,
                partType: "artifact_reference" as const,
                artifactId: attachment.artifactLink.artifact.id,
              })),
            ],
          },
          {
            artifactLinks: input.persistedPromptAttachments.map(
              (attachment) => attachment.artifactLink,
            ),
            fileLocations: Object.fromEntries(
              input.persistedPromptAttachments.map((attachment) => [
                attachment.artifactLink.artifact.id,
                attachment.fileLocation,
              ]),
            ),
          },
        );
        userMessageRecorded = true;
      },
      recordAgentRun: () => recordAgentRun(acpSession.sessionId),
      activate: async () => {
        if (terminalManager) {
          terminalManager.bindSession(acpSession.sessionId);
          runningTerminalManagers.set(input.sessionId, terminalManager);
        }
        fileSystemManager?.bindSession(acpSession.sessionId);
        runningSessions.set(input.sessionId, runtime!);
        runtimeErrorCode = null;
        await input.journal.append({
          eventId: randomUUID(),
          agentRunId,
          eventType: "agent_run_state_update",
          state: "working",
          detail: `Waiting for ${displayName}`,
        });
        input.startup.resolve();
      },
    });
    const promptText =
      acpSession.lifecycle === "new" && input.continuingSession
        ? promptWithHistory(
            await listSessionTranscript(
              input.context.database,
              input.sessionId,
            ),
            input.prompt,
            input.userMessageEventId,
          )
        : input.prompt;
    const promptContent: ContentBlock[] = [
      ...(promptText ? [{ type: "text" as const, text: promptText }] : []),
      ...input.promptAttachments.map((attachment) => attachment.content),
    ];
    const result = await runtime.prompt(promptContent);
    await flushThought();
    for (const summaryText of agentPlanReasoningSummaries(
      updateState.planProjection,
    )) {
      await input.journal.append({
        eventId: randomUUID(),
        agentRunId,
        eventType: "reasoning_summary",
        summaryKind: "analysis",
        summaryText,
      });
    }
    await persistBufferedResponse(
      "final",
      result.stopReason === "cancelled" ? "cancelled" : "completed",
      result.stopReason,
    );
    await input.journal.append({
      eventId: randomUUID(),
      agentRunId,
      eventType: "agent_run_state_update",
      state: result.stopReason === "cancelled" ? "cancelled" : "completed",
      detail: null,
    });
  } catch (error) {
    runtimeErrorCode = "AGENT_RUN_FAILED";
    if (!userMessageRecorded) {
      input.startup.reject(error);
      return;
    }
    await recordAgentRun(null);
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
    input.startup.reject(error);
  } finally {
    if (credentialExpiryTimer) clearTimeout(credentialExpiryTimer);
    clearStreamingSessionMessage(input.sessionId);
    clearSessionWorking(input.sessionId);
    runningSessions.delete(input.sessionId);
    runningTerminalManagers.delete(input.sessionId);
    await terminalManager?.close();
    await cancelPendingTerminalApprovals(input.sessionId);
    agentElicitations.cancelSession(input.sessionId);
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
  const planChange = applyAgentPlanProjectionUpdate(
    state.planProjection,
    update,
  );
  if (planChange) {
    if (planChange.canonicalEntries === undefined) return;
    if (planChange.canonicalEntries === null) {
      for (const event of removeAgentPlanJournalEvents(state.plan)) {
        await journal.append({ ...event, agentRunId });
      }
      return;
    }
    const events = agentPlanJournalEvents(state.plan, {
      sessionUpdate: "plan",
      entries: planChange.canonicalEntries,
    });
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
    const progress = acpToolProgress(update);
    if (progress !== null) {
      await journal.append({
        eventId: randomUUID(),
        agentRunId,
        eventType: "tool_progress",
        toolCallEventId: eventId,
        progressSchemaId: "acp.tool-progress",
        progressSchemaVersion: 1,
        progress,
      });
    }
    return;
  }
  if (update.sessionUpdate !== "tool_call_update") return;
  const toolCallEventId = state.toolCallEventIds.get(update.toolCallId);
  if (!toolCallEventId) return;
  const progress = acpToolProgress(update);
  if (progress !== null) {
    await journal.append({
      eventId: randomUUID(),
      agentRunId,
      eventType: "tool_progress",
      toolCallEventId,
      progressSchemaId: "acp.tool-progress",
      progressSchemaVersion: 1,
      progress,
    });
  }
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
    output: jsonValue(
      update.rawOutput ??
        (update.content === undefined ? null : { content: update.content }),
    ),
  });
  state.toolCallEventIds.delete(update.toolCallId);
}

function acpToolProgress(
  update: Extract<
    SessionUpdate,
    { sessionUpdate: "tool_call" | "tool_call_update" }
  >,
): JsonValue | null {
  const progress = {
    ...(update.kind !== undefined ? { kind: update.kind } : {}),
    ...(update.status !== undefined ? { status: update.status } : {}),
    ...(update.title !== undefined ? { title: update.title } : {}),
    ...(update.content !== undefined ? { content: update.content } : {}),
    ...(update.locations !== undefined ? { locations: update.locations } : {}),
    ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
    ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
  };
  return Object.keys(progress).length > 0 ? jsonValue(progress) : null;
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
  updatedAt: string,
): DesktopAgentSummary {
  return {
    id: release.agentId,
    label: release.displayName,
    releaseVersion: release.releaseVersion,
    updatedAt,
    models:
      authentication?.models ??
      release.models.map((model) => ({
        ...model,
        thinkingEfforts: [],
        defaultThinkingEffortId: null,
      })),
    defaultModelId: authentication?.defaultModelId ?? release.defaultModelId,
    promptCapabilities: agentPromptCapabilities.get(
      releasePromptCapabilitiesKey(release),
    ),
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
    releaseVersion: null,
    updatedAt: connection.registeredAt,
    models: [],
    defaultModelId: null,
    promptCapabilities: agentPromptCapabilities.get(
      developmentPromptCapabilitiesKey(connection),
    ),
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
