import {
  appendSessionEvent,
  createSession,
  installAgentRelease,
  listSessionTranscript,
  type RadiusDatabase,
  type InstalledAgentRelease,
} from "@curve-ai/radius-storage";
import {
  MicrovmAcpRuntime,
  parseAgentReleaseDescriptor,
  type AgentReleaseDescriptor,
  type RequestPermissionRequest,
  type MicrovmRuntimePaths,
  type SessionUpdate,
} from "@curve-ai/radius-runtime";
import {
  startBrowserToolServer,
  type BrowserToolServer,
} from "@curve-ai/radius-browser-tools";
import type { BrowserBridgeOperation } from "@curve-ai/radius-browser-protocol";
import { app } from "electron";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type {
  DesktopAgentSummary,
  DesktopRuntimeStatus,
  StartAgentPromptInput,
  StartAgentPromptResult,
} from "../radius-api";
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
  plan: AgentPlanJournalState;
  toolCallEventIds: Map<string, string>;
}

let runtimeErrorCode: string | null = null;
const runningSessions = new Map<string, MicrovmAcpRuntime>();

export async function listDesktopAgents(): Promise<DesktopAgentSummary[]> {
  const releases = await loadConfiguredReleases();
  if (releases.length === 0) return [];
  const context = await initializeStorage();
  const agents: DesktopAgentSummary[] = [];
  for (const release of releases) {
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
  const [release] = await loadConfiguredReleases();
  if (!release) {
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
    agentId: release.agentId,
    releaseVersion: release.releaseVersion,
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

  const release = await requireAgentRelease(input.agentId);
  const context = await initializeStorage();
  const installation = await ensureAgentInstallation(context, release);
  let modelId = input.modelId ?? release.defaultModelId;
  let thinkingEffortId: string | null = null;
  if (isFxRelease(release)) {
    const authentication = await getFxAuthenticationStatus(
      context,
      installation.installationId,
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
  } else if (modelId && !release.models.some((model) => model.id === modelId)) {
    throw new Error("The selected model is not available for this agent");
  } else if (input.thinkingEffortId) {
    throw new Error("This agent does not support thinking effort selection");
  }
  const identity = localDeviceIdentity(context.vault);
  const priorEvents = input.sessionId
    ? await listSessionTranscript(context.database, input.sessionId)
    : [];
  const session = input.sessionId
    ? {
        id: input.sessionId,
        revision: priorEvents.at(-1)?.sessionRevision ?? 1,
      }
    : await createSession(context.database, {
        originClientInstanceId: identity.clientInstanceId,
        projectId: input.projectId ?? null,
        title: promptTitle(prompt),
      });
  const journal = new RuntimeSessionJournal(
    context.database,
    identity.clientInstanceId,
    session.id,
    session.revision,
  );
  const userMessageEventId = randomUUID();
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
    release,
    prompt: promptWithHistory(priorEvents, prompt),
    sessionId: session.id,
    thinkingEffortId,
    userMessageEventId,
    journal,
  });
  return { sessionId: session.id };
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
  if (!runtime) return;
  await runtime.cancel();
}

export function stopAgentRuntime(): void {
  for (const runtime of runningSessions.values()) runtime.stop();
  runningSessions.clear();
}

async function runAgentSession(input: {
  accessMode: "ask" | "full";
  context: StorageContext;
  modelId: string | null;
  release: AgentReleaseDescriptor;
  prompt: string;
  sessionId: string;
  thinkingEffortId: string | null;
  userMessageEventId: string;
  journal: RuntimeSessionJournal;
}): Promise<void> {
  const agentRunId = randomUUID();
  const updateState: RuntimeUpdateState = {
    plan: createAgentPlanJournalState(),
    toolCallEventIds: new Map(),
  };
  let responseText = "";
  let runtime: MicrovmAcpRuntime | null = null;
  let fxProfile: FxRuntimeProfileLease | null = null;
  let browserTools: BrowserToolServer | null = null;

  try {
    await input.journal.append({
      eventId: randomUUID(),
      agentRunId,
      eventType: "agent_run",
      providerKey: input.release.providerId,
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
      label: input.release.displayName,
    });
    await input.journal.append({
      eventId: randomUUID(),
      agentRunId,
      eventType: "agent_run_state_update",
      state: "working",
      detail: isFxRelease(input.release)
        ? "Preparing the local fx runtime"
        : "Preparing the local agent runtime",
    });

    if (isFxRelease(input.release)) {
      fxProfile = await prepareFxRuntimeProfile(
        input.context,
        input.thinkingEffortId,
      );
    }
    if (
      input.release.capabilities.some((capability) =>
        capability.startsWith("browser."),
      )
    ) {
      browserTools = await startBrowserToolServer(browserBridge, {
        authorize: (operation) =>
          input.accessMode === "full" &&
          browserOperationRequested(input.release, operation),
      });
    }
    runtime = await MicrovmAcpRuntime.start({
      release: input.release,
      modelId: input.modelId,
      paths: resolveMicrovmPaths(input.release, fxProfile?.path),
      mcpServers: browserTools
        ? [
            {
              type: "http",
              name: "radius-browser",
              url: browserTools.url,
              headers: browserTools.headers,
            },
          ]
        : [],
      handlers: {
        onPermissionRequest: async (request) =>
          permissionDecision(input.accessMode, request),
        onUpdate: async ({ update }) => {
          if (
            update.sessionUpdate === "agent_message_chunk" &&
            update.content.type === "text"
          ) {
            responseText += update.content.text;
          }
          await appendRuntimeUpdate(
            input.journal,
            agentRunId,
            updateState,
            update,
          );
        },
      },
      onStderr: (chunk) => {
        if (process.env.RADIUS_RUNTIME_DEBUG === "1") {
          console.error("[runtime]", chunk.trimEnd());
        }
      },
    });
    runningSessions.set(input.sessionId, runtime);
    runtimeErrorCode = null;
    await input.journal.append({
      eventId: randomUUID(),
      agentRunId,
      eventType: "agent_run_state_update",
      state: "working",
      detail: `Waiting for ${input.release.displayName}`,
    });
    const result = await runtime.prompt(input.prompt);

    if (responseText.trim()) {
      await input.journal.append({
        eventId: randomUUID(),
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
    runningSessions.delete(input.sessionId);
    if (runtime) await runtime.stop();
    await browserTools?.close();
    await fxProfile?.finalize();
  }
}

function browserOperationRequested(
  release: AgentReleaseDescriptor,
  operation: BrowserBridgeOperation,
): boolean {
  const requested = new Set(release.capabilities);
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
