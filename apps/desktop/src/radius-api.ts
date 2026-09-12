import type { DesktopUpdateStatus } from "./update-types";
import type {
  ConnectorCatalogEntry,
  ConnectorCatalogCategoryPreview,
  ConnectorCatalogListResponse,
  ConnectorCatalogTaxonomyCategory,
} from "@curve-ai/radius-connector-protocol";
import type {
  ComposerDraftContext,
  ConnectorSummary,
  ConnectorEnabledToolSummary,
  SessionTranscriptEventRecord,
} from "@curve-ai/radius-storage";

export type ThemePreference = "system" | "light" | "dark";
export type SessionStatus = "active" | "completed" | "cancelled" | "failed";

export type NativeControlMenuIcon =
  | "archivebox"
  | "checkmark"
  | "document.on.document"
  | "eye"
  | "folder"
  | "macwindow"
  | "pencil"
  | "pin"
  | "pin.slash"
  | "square.and.arrow.up"
  | "xmark";

interface NativeControlMenuActionItemBase {
  type?: "normal";
  id: string;
  label: string;
  enabled?: boolean;
  icon?: NativeControlMenuIcon;
  toolTip?: string;
  widthHint?: number;
}

export interface NativeControlMenuLeafActionItem extends NativeControlMenuActionItemBase {
  submenu?: never;
}

export type NativeControlMenuLeafItem =
  { type: "separator" } | NativeControlMenuLeafActionItem;

export interface NativeControlMenuSubmenuItem extends NativeControlMenuActionItemBase {
  submenu: NativeControlMenuLeafItem[];
}

export type NativeControlMenuItem =
  NativeControlMenuLeafItem | NativeControlMenuSubmenuItem;

export interface NativeControlMenuPoint {
  x: number;
  y: number;
}

export interface NativeControlMenuInput {
  items: NativeControlMenuItem[];
  point?: NativeControlMenuPoint;
  positioningItem?: number;
}

export interface ProjectSessionSummary {
  id: string;
  title: string;
  status: SessionStatus;
  updatedAt: string;
  lastAssistantMessageAt: string | null;
  pinnedAt: string | null;
  working: boolean;
}

export interface SessionWorkingStateUpdate {
  sessionId: string;
  working: boolean;
}

export interface ProjectRootSummary {
  id: string;
  name: string;
  rootPath: string;
}

export interface ProjectSidebarRecord {
  id: string;
  name: string;
  roots: ProjectRootSummary[];
  sessions: ProjectSessionSummary[];
}

export type RecentSidebarSession = ProjectSessionSummary;
type StoredSessionTranscriptMessage = Extract<
  SessionTranscriptEventRecord,
  { eventType: "message" }
>;
export type StreamingSessionTranscriptMessage = Omit<
  StoredSessionTranscriptMessage,
  "status"
> & {
  status: "streaming";
};
export type SessionTranscriptEvent =
  SessionTranscriptEventRecord | StreamingSessionTranscriptMessage;
export interface SessionTranscriptStreamUpdate {
  sessionId: string;
  eventId: string;
  event: Extract<SessionTranscriptEvent, { eventType: "message" }> | null;
  mode: "append" | "replace";
  textOffset?: number;
}
export const SESSION_TRANSCRIPT_STREAM_CHANNEL =
  "radius:session-transcript-stream";
export const SESSION_WORKING_STATE_CHANNEL = "radius:session-working-state";
export const SESSION_RUN_ACTIVITY_DETAIL = {
  connectingAgent: "Connecting to the development agent",
  resumingWork: "Continuing with approved access",
  startingFxAgent: "Preparing the local fx runtime",
  startingLocalAgent: "Preparing the local agent runtime",
} as const;
export const AGENTS_CHANGED_CHANNEL = "radius:agents-changed";
export type DesktopConnector = ConnectorSummary;
export type DesktopConnectorCatalogEntry = ConnectorCatalogEntry;
export type DesktopConnectorCatalogCategoryPreview =
  ConnectorCatalogCategoryPreview;
export type DesktopConnectorCatalogCategory = ConnectorCatalogTaxonomyCategory;
export type DesktopConnectorEnabledTool = ConnectorEnabledToolSummary;

export interface DesktopConnectorCatalogQuery {
  category?: string;
  cursor?: string;
  search?: string;
}

export interface ProjectFolderSelection {
  selectionId: string;
  rootPath: string;
  defaultName: string;
}

export type { ComposerDraftContext } from "@curve-ai/radius-storage";

export interface SaveComposerDraftInput {
  context: ComposerDraftContext;
  content: string;
}

export interface DesktopAgentSummary {
  id: string;
  label: string;
  releaseVersion: string | null;
  updatedAt?: string | null;
  models: Array<{
    id: string;
    label: string;
    thinkingEfforts: Array<{ id: string; label: string }>;
    defaultThinkingEffortId: string | null;
  }>;
  defaultModelId: string | null;
  /**
   * ACP prompt content advertised by the agent when Radius has already
   * initialized it. Omitted means the desktop main process must negotiate and
   * validate content against the live initialize response before prompting.
   */
  promptCapabilities?: {
    image: boolean;
    audio: boolean;
    embeddedContext: boolean;
  };
  authentication: {
    state:
      | "not_required"
      | "needs_authentication"
      | "connected"
      | "expired"
      | "error";
    label: string | null;
    detail: string;
  };
}

export type PromptAttachment =
  | {
      type: "image";
      name: string;
      mimeType: string;
      /** Base64-encoded file bytes. */
      data: string;
    }
  | {
      type: "audio";
      name: string;
      mimeType: string;
      /** Base64-encoded file bytes. */
      data: string;
    }
  | {
      type: "resource";
      name: string;
      resource:
        | {
            uri: string;
            mimeType: string;
            text: string;
          }
        | {
            uri: string;
            mimeType: string;
            /** Base64-encoded file bytes. */
            blob: string;
          };
    };

export const MAX_PROMPT_ATTACHMENT_COUNT = 10;
export const MAX_PROMPT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PROMPT_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_PROMPT_RESOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_PROMPT_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

export interface DesktopRuntimeStatus {
  state: "unconfigured" | "ready" | "running" | "error";
  agentId: string | null;
  releaseVersion: string | null;
  errorCode: string | null;
}

export interface DesktopAgentSessionConfigSelectOption {
  id: string;
  label: string;
  description: string | null;
  groupId: string | null;
  groupLabel: string | null;
}

interface DesktopAgentSessionConfigOptionBase {
  id: string;
  label: string;
  description: string | null;
  /** ACP semantic category. Unknown and extension categories are retained. */
  category: string | null;
}

export type DesktopAgentSessionConfigOption =
  | (DesktopAgentSessionConfigOptionBase & {
      type: "select";
      currentValue: string;
      options: DesktopAgentSessionConfigSelectOption[];
    })
  | (DesktopAgentSessionConfigOptionBase & {
      type: "boolean";
      currentValue: boolean;
    });

export interface DesktopAgentSessionFeatures {
  agentId: string;
  availableCommands: Array<{
    name: string;
    description: string;
    inputHint: string | null;
  }>;
  configOptions: DesktopAgentSessionConfigOption[];
  modes: {
    currentModeId: string;
    availableModes: Array<{
      id: string;
      label: string;
      description: string | null;
    }>;
  } | null;
  usage: {
    used: number;
    size: number;
    cost: { amount: number; currency: string } | null;
  } | null;
}

export interface GetAgentSessionFeaturesInput {
  sessionId: string;
  agentId: string;
}

export interface SetAgentSessionConfigOptionInput {
  sessionId: string;
  agentId: string;
  configId: string;
  value: string | boolean;
}

export interface SetAgentSessionModeInput {
  sessionId: string;
  agentId: string;
  modeId: string;
}

export interface BrowserConnectionStatus {
  state:
    "unsupported" | "waiting_for_extension" | "connected" | "paused" | "error";
  extensionId: string;
  profile: { id: string; label: string } | null;
  controlledTabs: number;
  errorCode: string | null;
}

export interface StartAgentPromptInput {
  accessMode: "ask" | "project" | "full";
  agentId: string;
  /**
   * Serializable prompt content prepared by the renderer. Desktop main must
   * revalidate names, MIME types, decoded sizes, and ACP prompt capabilities
   * before constructing ContentBlocks.
   */
  attachments?: PromptAttachment[];
  modelId?: string | null;
  prompt: string;
  projectId?: string | null;
  sessionId?: string | null;
  thinkingEffortId?: string | null;
}

export interface StartAgentPromptResult {
  sessionId: string;
  userMessageEventId: string;
}

export type ToolApprovalSelection =
  "allow_once" | "allow_always" | "allow_server" | "denied";

export interface ResolveToolApprovalInput {
  approvalRequestEventId: string;
  selection: ToolApprovalSelection;
  sessionId: string;
}

export type AgentElicitationValue = string | number | boolean | string[];

export interface AgentElicitationOption {
  value: string;
  title: string;
  description: string | null;
}

export interface AgentElicitationField {
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "array";
  title: string | null;
  description: string | null;
  required: boolean;
  defaultValue: AgentElicitationValue | null;
  options: AgentElicitationOption[] | null;
  format: "email" | "uri" | "date" | "date-time" | null;
  minimum: number | null;
  maximum: number | null;
  minimumLength: number | null;
  maximumLength: number | null;
  pattern: string | null;
}

export type PendingAgentElicitation = {
  requestId: string;
  sessionId: string;
  message: string;
  toolCallId: string | null;
  createdAt: string;
} & (
  | {
      mode: "form";
      title: string | null;
      description: string | null;
      fields: AgentElicitationField[];
    }
  | {
      mode: "url";
      elicitationId: string;
      url: string;
    }
);

export type AgentElicitationResponse =
  | {
      action: "accept";
      content?: Record<string, AgentElicitationValue> | null;
    }
  | { action: "decline" }
  | { action: "cancel" };

export interface ResolveAgentElicitationInput {
  sessionId: string;
  requestId: string;
  response: AgentElicitationResponse;
}

export interface McpApprovalGrantSummary {
  grantId: string;
  scope: "server" | "tool";
  providerId: string;
  providerLabel: string;
  toolName: string | null;
  grantedAt: string;
}

export type MarkdownMediaResolution =
  | {
      state: "ready";
      contentType: string;
      dataUrl: string;
      finalUrl: string;
    }
  | {
      state: "blocked";
      reason: "too_large" | "unsafe_url" | "unsupported_type";
    }
  | { state: "unavailable" };

export type MarkdownLinkPreviewResolution =
  | {
      state: "ready";
      faviconDataUrl: string | null;
      faviconDarkDataUrl: string | null;
    }
  | { state: "blocked"; reason: "unsafe_url" }
  | { state: "unavailable" };

export interface OpenSessionFileInput {
  href: string;
  sessionId: string;
}

export interface RadiusApi {
  authenticationStatus(): Promise<
    import("./auth-types").DesktopAuthenticationStatus
  >;
  signIn(): Promise<import("./auth-types").DesktopAuthenticationStatus>;
  signOut(): Promise<import("./auth-types").DesktopAuthenticationStatus>;
  cancelSignIn(): Promise<void>;

  platform: string;
  handleTitlebarDoubleClick(): Promise<void>;
  setNativeTheme(preference: ThemePreference): Promise<boolean>;
  showNativeControlMenu(input: NativeControlMenuInput): Promise<string | null>;
  writeClipboardText(text: string): Promise<void>;
  storageStatus(): Promise<{ ready: true }>;
  listProjects(): Promise<ProjectSidebarRecord[]>;
  listRecentSessions(): Promise<RecentSidebarSession[]>;
  listSessionTranscript(sessionId: string): Promise<SessionTranscriptEvent[]>;
  getComposerDraft(context: ComposerDraftContext): Promise<string | null>;
  saveComposerDraft(input: SaveComposerDraftInput): Promise<void>;
  clearComposerDraft(context: ComposerDraftContext): Promise<void>;
  onSessionTranscriptStream(
    listener: (update: SessionTranscriptStreamUpdate) => void,
  ): () => void;
  onSessionWorkingStateChanged(
    listener: (update: SessionWorkingStateUpdate) => void,
  ): () => void;
  chooseProjectFolder(): Promise<ProjectFolderSelection | null>;
  createProject(input: {
    selectionIds?: string[];
    name: string;
  }): Promise<ProjectSidebarRecord>;
  discardProjectFolderSelection(selectionId: string): Promise<void>;
  addProjectFolder(projectId: string): Promise<ProjectRootSummary | null>;
  removeProjectFolder(input: {
    projectId: string;
    rootId: string;
  }): Promise<void>;
  renameProject(input: { projectId: string; name: string }): Promise<void>;
  renameSession(input: { sessionId: string; title: string }): Promise<void>;
  revealProject(projectId: string): Promise<void>;
  setSessionPinned(sessionId: string, pinned: boolean): Promise<void>;
  setSessionArchived(sessionId: string): Promise<void>;
  listConnectors(): Promise<DesktopConnector[]>;
  listConnectorTools(
    installationId: string,
  ): Promise<DesktopConnectorEnabledTool[]>;
  listConnectorCatalog(
    query?: DesktopConnectorCatalogQuery,
  ): Promise<ConnectorCatalogListResponse>;
  installCatalogConnector(id: string): Promise<DesktopConnector>;
  installConnector(input: {
    name: string;
    url: string;
  }): Promise<DesktopConnector>;
  connectConnector(installationId: string): Promise<DesktopConnector>;
  disconnectConnector(providerId: string): Promise<void>;
  deleteConnector(installationId: string): Promise<void>;
  listAgents(): Promise<DesktopAgentSummary[]>;
  onAgentsChanged(listener: () => void): () => void;
  connectAgentAuthentication(agentId: string): Promise<DesktopAgentSummary>;
  disconnectAgentAuthentication(agentId: string): Promise<DesktopAgentSummary>;
  runtimeStatus(): Promise<DesktopRuntimeStatus>;
  getAgentSessionFeatures(
    input: GetAgentSessionFeaturesInput,
  ): Promise<DesktopAgentSessionFeatures | null>;
  setAgentSessionConfigOption(
    input: SetAgentSessionConfigOptionInput,
  ): Promise<DesktopAgentSessionFeatures | null>;
  setAgentSessionMode(
    input: SetAgentSessionModeInput,
  ): Promise<DesktopAgentSessionFeatures | null>;
  browserStatus(): Promise<BrowserConnectionStatus>;
  revealBrowserExtension(): Promise<boolean>;
  onBrowserStatus(
    listener: (status: BrowserConnectionStatus) => void,
  ): () => void;
  startAgentPrompt(
    input: StartAgentPromptInput,
  ): Promise<StartAgentPromptResult>;
  resolveToolApproval(input: ResolveToolApprovalInput): Promise<void>;
  listPendingAgentElicitations(
    sessionId: string,
  ): Promise<PendingAgentElicitation[]>;
  resolveAgentElicitation(input: ResolveAgentElicitationInput): Promise<void>;
  listMcpApprovalGrants(): Promise<McpApprovalGrantSummary[]>;
  revokeMcpApproval(input: {
    grantId: string;
    scope: "server" | "tool";
  }): Promise<void>;
  resolveMarkdownMedia(url: string): Promise<MarkdownMediaResolution>;
  resolveMarkdownLinkPreview(
    url: string,
  ): Promise<MarkdownLinkPreviewResolution>;
  openSessionFile(input: OpenSessionFileInput): Promise<void>;
  resolveSessionArtifactImage(input: {
    sessionId: string;
    artifactId: string;
  }): Promise<MarkdownMediaResolution>;
  cancelAgentSession(sessionId: string): Promise<void>;
  updateStatus(): Promise<DesktopUpdateStatus>;
  checkForUpdates(): Promise<DesktopUpdateStatus>;
  performUpdate(): Promise<DesktopUpdateStatus>;
  onUpdateStatus(listener: (status: DesktopUpdateStatus) => void): () => void;
}
