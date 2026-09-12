import {
  PROTOCOL_VERSION,
  RequestError,
  client,
  methods,
  type AgentCapabilities,
  type AgentApp,
  type AuthMethod,
  type ClientCapabilities,
  type ClientConnection,
  type CompleteElicitationNotification,
  type ContentBlock,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type InitializeResponse,
  type KillTerminalRequest,
  type KillTerminalResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ReleaseTerminalRequest,
  type ReleaseTerminalResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type McpServer,
  type DeleteSessionRequest,
  type DeleteSessionResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type SessionNotification,
  type SessionConfigOption,
  type SessionCapabilities,
  type SessionModeState,
  type SetSessionConfigOptionResponse,
  type StopReason,
  type Stream,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from "@agentclientprotocol/sdk";

export type AcpPermissionDecision =
  { outcome: "selected"; optionId: string } | { outcome: "cancelled" };

export type AcpPermissionHandler = (
  request: RequestPermissionRequest,
  signal: AbortSignal,
) => Promise<AcpPermissionDecision>;

export type AcpUpdateHandler = (
  notification: SessionNotification,
) => void | Promise<void>;

export type AcpAuthenticationHandler = (
  authMethods: AuthMethod[],
  signal: AbortSignal,
) => Promise<
  | string
  | { methodId: string; credential: { accessToken: string; expiresAt: string } }
  | null
  | undefined
>;

export interface AcpTerminalHandlers {
  create(
    request: CreateTerminalRequest,
    signal: AbortSignal,
  ): Promise<CreateTerminalResponse>;
  output(
    request: TerminalOutputRequest,
    signal: AbortSignal,
  ): Promise<TerminalOutputResponse>;
  release(
    request: ReleaseTerminalRequest,
    signal: AbortSignal,
  ): Promise<ReleaseTerminalResponse | void>;
  waitForExit(
    request: WaitForTerminalExitRequest,
    signal: AbortSignal,
  ): Promise<WaitForTerminalExitResponse>;
  kill(
    request: KillTerminalRequest,
    signal: AbortSignal,
  ): Promise<KillTerminalResponse | void>;
}

export interface AcpFileSystemHandlers {
  readTextFile?(
    request: ReadTextFileRequest,
    signal: AbortSignal,
  ): Promise<ReadTextFileResponse>;
  writeTextFile?(
    request: WriteTextFileRequest,
    signal: AbortSignal,
  ): Promise<WriteTextFileResponse | void>;
}

export type AcpElicitationHandler = (
  request: CreateElicitationRequest,
  signal: AbortSignal,
) => Promise<CreateElicitationResponse>;

export interface AcpElicitationHandlers {
  form?: AcpElicitationHandler;
  url?: AcpElicitationHandler;
  onComplete?(
    notification: CompleteElicitationNotification,
  ): void | Promise<void>;
}

export interface AcpRuntimeHandlers {
  onPermissionRequest: AcpPermissionHandler;
  elicitation?: AcpElicitationHandlers;
  fileSystem?: AcpFileSystemHandlers;
  onReplayUpdate?: AcpUpdateHandler;
  onUpdate?: AcpUpdateHandler;
  terminal?: AcpTerminalHandlers;
}

export interface AcpRuntimeSessionOptions {
  cwd: string;
  handlers: AcpRuntimeHandlers;
  additionalDirectories?: string[];
  clientName?: string;
  clientCapabilities?: ClientCapabilities;
  mcpServers?: McpServer[];
  modelId?: string | null;
  onAuthenticate?: AcpAuthenticationHandler;
  session?: AcpRuntimeSessionStart;
}

export type AcpRuntimeSessionStart =
  | { kind: "new" }
  | { kind: "load"; sessionId: string }
  | { kind: "resume"; sessionId: string }
  | { kind: "auto"; sessionId: string };

export type AcpRuntimeSessionLifecycle = "new" | "load" | "resume";

export type AcpRuntimeConnectionTarget = Stream | AgentApp;

export interface AcpRuntimePromptResult {
  stopReason: StopReason;
  text: string;
}

export interface AcpRuntimePromptOptions {
  collectText?: boolean;
  onUpdate?: AcpUpdateHandler;
}

export type AcpRuntimePrompt = string | ContentBlock | ContentBlock[];

interface ActivePrompt {
  collectText: boolean;
  onUpdate?: AcpUpdateHandler;
  output: string;
}

interface RuntimeUpdateState {
  activePrompt?: ActivePrompt;
  expectedSessionId?: string;
  notificationTail: Promise<void>;
  replaying: boolean;
}

/**
 * The agent answered `initialize` with a protocol version Radius does not speak.
 * ACP says the client SHOULD close the connection in that case, and Radius does.
 */
export class AcpProtocolVersionMismatchError extends Error {
  readonly requestedVersion: number;
  readonly agentVersion: number;

  constructor(requestedVersion: number, agentVersion: number) {
    super(
      `The agent negotiated ACP protocol version ${agentVersion}; Radius speaks version ${requestedVersion}`,
    );
    this.name = "AcpProtocolVersionMismatchError";
    this.requestedVersion = requestedVersion;
    this.agentVersion = agentVersion;
  }
}

/**
 * The agent refused `session/new` or `session/load` with ACP `auth_required`.
 * Carries the methods the agent advertised at `initialize` so the caller can
 * say what the agent wants instead of reporting a generic failure.
 */
export class AcpAuthenticationRequiredError extends Error {
  readonly authMethods: AuthMethod[];

  constructor(authMethods: AuthMethod[], cause: RequestError) {
    const offered =
      authMethods.length > 0
        ? authMethods.map((method) => method.id).join(", ")
        : "none";
    super(
      `The agent requires ACP authentication before starting a session (advertised methods: ${offered})`,
      { cause },
    );
    this.name = "AcpAuthenticationRequiredError";
    this.authMethods = [...authMethods];
  }
}

export class AcpRuntimeSession {
  readonly sessionId: string;
  readonly initializationResponse: InitializeResponse;
  readonly lifecycle: AcpRuntimeSessionLifecycle;

  private configOptions: SessionConfigOption[];
  private modes: SessionModeState | null | undefined;

  private constructor(
    private readonly connection: ClientConnection,
    private readonly handlers: AcpRuntimeHandlers,
    private readonly updateState: RuntimeUpdateState,
    initializationResponse: InitializeResponse,
    lifecycle: AcpRuntimeSessionLifecycle,
    sessionId: string,
    sessionState: {
      configOptions?: SessionConfigOption[] | null;
      modes?: SessionModeState | null;
    },
  ) {
    this.initializationResponse = initializationResponse;
    this.lifecycle = lifecycle;
    this.sessionId = sessionId;
    this.configOptions = [...(sessionState.configOptions ?? [])];
    this.modes = sessionState.modes;
  }

  get protocolVersion(): number {
    return this.initializationResponse.protocolVersion;
  }

  get agentCapabilities(): AgentCapabilities {
    return this.initializationResponse.agentCapabilities ?? {};
  }

  get authMethods(): NonNullable<InitializeResponse["authMethods"]> {
    return [...(this.initializationResponse.authMethods ?? [])];
  }

  get sessionCapabilities(): SessionCapabilities {
    return this.agentCapabilities.sessionCapabilities ?? {};
  }

  get sessionConfigOptions(): SessionConfigOption[] {
    return [...this.configOptions];
  }

  get sessionModes(): SessionModeState | null | undefined {
    return this.modes;
  }

  static async connect(
    target: AcpRuntimeConnectionTarget,
    options: AcpRuntimeSessionOptions,
  ): Promise<AcpRuntimeSession> {
    const updateState: RuntimeUpdateState = {
      notificationTail: Promise.resolve(),
      replaying: false,
    };
    const app = client({ name: options.clientName ?? "radius-runtime" })
      .onRequest(methods.client.session.requestPermission, async (context) => {
        const decision = await options.handlers.onPermissionRequest(
          context.params,
          context.signal,
        );
        return { outcome: decision } satisfies RequestPermissionResponse;
      })
      .onRequest(methods.client.elicitation.create, async (context) => {
        const elicitation = options.handlers.elicitation;
        const handler =
          context.params.mode === "form"
            ? elicitation?.form
            : context.params.mode === "url"
              ? elicitation?.url
              : undefined;
        if (!handler) {
          throw new Error(
            `Radius did not advertise ACP ${context.params.mode} elicitation`,
          );
        }
        return handler(context.params, context.signal);
      })
      .onRequest(methods.client.fs.readTextFile, async (context) => {
        const fileSystem = options.handlers.fileSystem;
        if (!fileSystem?.readTextFile) {
          throw new Error("Radius did not advertise ACP file reads");
        }
        return fileSystem.readTextFile(context.params, context.signal);
      })
      .onRequest(methods.client.fs.writeTextFile, async (context) => {
        const fileSystem = options.handlers.fileSystem;
        if (!fileSystem?.writeTextFile) {
          throw new Error("Radius did not advertise ACP file writes");
        }
        return (
          (await fileSystem.writeTextFile(context.params, context.signal)) ?? {}
        );
      })
      .onRequest(methods.client.terminal.create, async (context) => {
        const terminal = options.handlers.terminal;
        if (!terminal)
          throw new Error("Radius did not advertise ACP terminals");
        return terminal.create(context.params, context.signal);
      })
      .onRequest(methods.client.terminal.output, async (context) => {
        const terminal = options.handlers.terminal;
        if (!terminal)
          throw new Error("Radius did not advertise ACP terminals");
        return terminal.output(context.params, context.signal);
      })
      .onRequest(methods.client.terminal.waitForExit, async (context) => {
        const terminal = options.handlers.terminal;
        if (!terminal)
          throw new Error("Radius did not advertise ACP terminals");
        return terminal.waitForExit(context.params, context.signal);
      })
      .onRequest(methods.client.terminal.kill, async (context) => {
        const terminal = options.handlers.terminal;
        if (!terminal)
          throw new Error("Radius did not advertise ACP terminals");
        return (await terminal.kill(context.params, context.signal)) ?? {};
      })
      .onRequest(methods.client.terminal.release, async (context) => {
        const terminal = options.handlers.terminal;
        if (!terminal)
          throw new Error("Radius did not advertise ACP terminals");
        return (await terminal.release(context.params, context.signal)) ?? {};
      })
      .onNotification(methods.client.session.update, async (context) => {
        const expectedSessionId = updateState.expectedSessionId;
        const replaying = updateState.replaying;
        const pending = updateState.notificationTail.then(async () => {
          if (context.params.sessionId !== expectedSessionId) return;
          if (replaying) {
            await options.handlers.onReplayUpdate?.(context.params);
            return;
          }
          const activePrompt = updateState.activePrompt;
          if (
            activePrompt?.collectText &&
            context.params.update.sessionUpdate === "agent_message_chunk" &&
            context.params.update.content.type === "text"
          ) {
            activePrompt.output += context.params.update.content.text;
          }
          await (activePrompt?.onUpdate ?? options.handlers.onUpdate)?.(
            context.params,
          );
        });
        updateState.notificationTail = pending.catch(() => undefined);
        await pending;
      })
      .onNotification(methods.client.elicitation.complete, async (context) => {
        await options.handlers.elicitation?.onComplete?.(context.params);
      });

    const connection = app.connect(target as Stream & AgentApp);
    try {
      const initializationResponse = await connection.agent.request(
        methods.agent.initialize,
        {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            ...(options.clientCapabilities ?? {}),
            fs: {
              readTextFile: Boolean(options.handlers.fileSystem?.readTextFile),
              writeTextFile: Boolean(
                options.handlers.fileSystem?.writeTextFile,
              ),
            },
            terminal: Boolean(options.handlers.terminal),
            ...(options.handlers.elicitation?.form ||
            options.handlers.elicitation?.url
              ? {
                  elicitation: {
                    ...(options.handlers.elicitation.form ? { form: {} } : {}),
                    ...(options.handlers.elicitation.url ? { url: {} } : {}),
                  },
                }
              : {}),
          },
        },
      );
      if (initializationResponse.protocolVersion !== PROTOCOL_VERSION) {
        throw new AcpProtocolVersionMismatchError(
          PROTOCOL_VERSION,
          initializationResponse.protocolVersion,
        );
      }
      await authenticateIfRequested(
        connection,
        initializationResponse,
        options.onAuthenticate,
      );
      const start = options.session ?? { kind: "new" };
      if (start.kind !== "new") {
        updateState.expectedSessionId = start.sessionId;
      }
      const additionalDirectories = supportsAdditionalDirectories(
        initializationResponse,
      )
        ? options.additionalDirectories
        : undefined;
      const commonRequest = {
        cwd: options.cwd,
        mcpServers: options.mcpServers ?? [],
        ...(additionalDirectories?.length ? { additionalDirectories } : {}),
      };

      let sessionId: string;
      let lifecycle: AcpRuntimeSessionLifecycle;
      let sessionState: {
        configOptions?: SessionConfigOption[] | null;
        modes?: SessionModeState | null;
      };
      switch (start.kind) {
        case "new": {
          const response = await requireAuthenticated(
            initializationResponse,
            () =>
              connection.agent.request<NewSessionResponse, NewSessionRequest>(
                methods.agent.session.new,
                commonRequest,
              ),
          );
          sessionId = response.sessionId;
          updateState.expectedSessionId = sessionId;
          lifecycle = "new";
          sessionState = response;
          break;
        }
        case "load": {
          if (initializationResponse.agentCapabilities?.loadSession !== true) {
            throw new Error("The agent did not advertise ACP session/load");
          }
          updateState.replaying = true;
          try {
            sessionState = await requireAuthenticated(
              initializationResponse,
              () =>
                connection.agent.request(methods.agent.session.load, {
                  ...commonRequest,
                  sessionId: start.sessionId,
                }),
            );
          } finally {
            updateState.replaying = false;
          }
          sessionId = start.sessionId;
          lifecycle = "load";
          break;
        }
        case "resume": {
          if (
            initializationResponse.agentCapabilities?.sessionCapabilities
              ?.resume == null
          ) {
            throw new Error("The agent did not advertise ACP session/resume");
          }
          sessionState = await connection.agent.request(
            methods.agent.session.resume,
            { ...commonRequest, sessionId: start.sessionId },
          );
          sessionId = start.sessionId;
          lifecycle = "resume";
          break;
        }
        case "auto": {
          let continuation:
            | {
                sessionId: string;
                lifecycle: AcpRuntimeSessionLifecycle;
                sessionState: {
                  configOptions?: SessionConfigOption[] | null;
                  modes?: SessionModeState | null;
                };
              }
            | undefined;
          if (
            initializationResponse.agentCapabilities?.sessionCapabilities
              ?.resume != null
          ) {
            try {
              continuation = {
                sessionId: start.sessionId,
                lifecycle: "resume",
                sessionState: await connection.agent.request(
                  methods.agent.session.resume,
                  { ...commonRequest, sessionId: start.sessionId },
                ),
              };
            } catch (error) {
              if (!isMissingSessionError(error, start.sessionId)) throw error;
            }
          }
          if (
            !continuation &&
            initializationResponse.agentCapabilities?.loadSession === true
          ) {
            updateState.replaying = true;
            try {
              continuation = {
                sessionId: start.sessionId,
                lifecycle: "load",
                sessionState: await connection.agent.request(
                  methods.agent.session.load,
                  { ...commonRequest, sessionId: start.sessionId },
                ),
              };
            } catch (error) {
              if (!isMissingSessionError(error, start.sessionId)) throw error;
            } finally {
              updateState.replaying = false;
            }
          }
          if (!continuation) {
            const response = await connection.agent.request<
              NewSessionResponse,
              NewSessionRequest
            >(methods.agent.session.new, commonRequest);
            continuation = {
              sessionId: response.sessionId,
              lifecycle: "new",
              sessionState: response,
            };
            updateState.expectedSessionId = response.sessionId;
          }
          ({ sessionId, lifecycle, sessionState } = continuation);
          break;
        }
      }

      const runtime = new AcpRuntimeSession(
        connection,
        options.handlers,
        updateState,
        initializationResponse,
        lifecycle,
        sessionId,
        sessionState,
      );
      if (options.modelId && lifecycle === "new") {
        await runtime.setModel(options.modelId);
      }
      return runtime;
    } catch (error) {
      connection.close(error);
      throw error;
    }
  }

  availableModels(): Array<{ id: string; label: string }> {
    const option = modelConfigOption(this.configOptions);
    if (!option) return [];
    return option.options.flatMap((entry) =>
      "options" in entry
        ? entry.options.map((value) => ({ id: value.value, label: value.name }))
        : [{ id: entry.value, label: entry.name }],
    );
  }

  async setModel(modelId: string): Promise<void> {
    const option = modelConfigOption(this.configOptions);
    if (!option) throw new Error("The agent did not advertise model selection");
    const exists = this.availableModels().some((model) => model.id === modelId);
    if (!exists)
      throw new Error(`The agent did not advertise model ${modelId}`);
    await this.setConfigOption(option.id, modelId);
  }

  async setConfigOption(
    configId: string,
    value: string | boolean,
  ): Promise<SessionConfigOption[]> {
    const option = this.configOptions.find((entry) => entry.id === configId);
    if (!option) {
      throw new Error(`The agent did not advertise config option ${configId}`);
    }
    if (option.type === "boolean") {
      if (typeof value !== "boolean") {
        throw new Error(`Config option ${configId} requires a boolean value`);
      }
    } else {
      if (
        typeof value !== "string" ||
        !option.options.some((entry) =>
          "options" in entry
            ? entry.options.some((nested) => nested.value === value)
            : entry.value === value,
        )
      ) {
        throw new Error(`Config option ${configId} value is not advertised`);
      }
    }
    const response: SetSessionConfigOptionResponse =
      option.type === "boolean"
        ? await this.connection.agent.request(
            methods.agent.session.setConfigOption,
            {
              sessionId: this.sessionId,
              configId,
              type: "boolean",
              value: value as boolean,
            },
          )
        : await this.connection.agent.request(
            methods.agent.session.setConfigOption,
            {
              sessionId: this.sessionId,
              configId,
              value: value as string,
            },
          );
    this.configOptions = [...response.configOptions];
    return this.sessionConfigOptions;
  }

  async setMode(modeId: string): Promise<void> {
    if (
      !this.modes ||
      !this.modes.availableModes.some((mode) => mode.id === modeId)
    ) {
      throw new Error(`The agent did not advertise session mode ${modeId}`);
    }
    await this.connection.agent.request(methods.agent.session.setMode, {
      sessionId: this.sessionId,
      modeId,
    });
    this.modes = { ...this.modes, currentModeId: modeId };
  }

  async prompt(
    prompt: AcpRuntimePrompt,
    options: AcpRuntimePromptOptions = {},
  ): Promise<AcpRuntimePromptResult> {
    if (this.updateState.activePrompt) {
      throw new Error("An ACP prompt is already running for this session");
    }
    const activePrompt: ActivePrompt = {
      collectText: options.collectText ?? true,
      onUpdate: options.onUpdate ?? this.handlers.onUpdate,
      output: "",
    };
    this.updateState.activePrompt = activePrompt;
    try {
      const response = await this.connection.agent.request(
        methods.agent.session.prompt,
        {
          sessionId: this.sessionId,
          prompt:
            typeof prompt === "string"
              ? [{ type: "text", text: prompt }]
              : Array.isArray(prompt)
                ? prompt
                : [prompt],
        },
      );
      await drainRuntimeNotifications(this.updateState);
      return {
        stopReason: response.stopReason,
        text: activePrompt.collectText ? activePrompt.output : "",
      };
    } finally {
      if (this.updateState.activePrompt === activePrompt) {
        delete this.updateState.activePrompt;
      }
    }
  }

  async cancel(): Promise<void> {
    await this.connection.agent.notify(methods.agent.session.cancel, {
      sessionId: this.sessionId,
    });
  }

  async logout(): Promise<void> {
    if (this.agentCapabilities.auth?.logout == null) {
      throw new Error("The agent did not advertise ACP logout");
    }
    await this.connection.agent.request(methods.agent.logout, {});
  }

  async listSessions(
    request: ListSessionsRequest = {},
  ): Promise<ListSessionsResponse> {
    if (this.sessionCapabilities.list == null) {
      throw new Error("The agent did not advertise ACP session/list");
    }
    return this.connection.agent.request(methods.agent.session.list, request);
  }

  async deleteSession(
    request: DeleteSessionRequest,
  ): Promise<DeleteSessionResponse> {
    if (this.sessionCapabilities.delete == null) {
      throw new Error("The agent did not advertise ACP session/delete");
    }
    return this.connection.agent.request(methods.agent.session.delete, request);
  }

  async closeSession(): Promise<void> {
    if (this.sessionCapabilities.close == null) {
      throw new Error("The agent did not advertise ACP session/close");
    }
    await this.connection.agent.request(methods.agent.session.close, {
      sessionId: this.sessionId,
    });
  }

  close(error?: unknown): void {
    this.connection.close(error);
  }
}

async function drainRuntimeNotifications(
  state: RuntimeUpdateState,
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const currentTail = state.notificationTail;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await currentTail;
    if (currentTail === state.notificationTail) return;
  }
  await state.notificationTail;
}

export const connectAcpRuntime = AcpRuntimeSession.connect;

function modelConfigOption(options: SessionConfigOption[]) {
  const selectOptions = options.filter(
    (option): option is Extract<SessionConfigOption, { type: "select" }> =>
      option.type === "select",
  );
  return (
    selectOptions.find((option) => option.id === "model") ??
    selectOptions.find(
      (option) =>
        option.category === "model" && option.name.toLowerCase() === "model",
    )
  );
}

function supportsAdditionalDirectories(
  initializationResponse: InitializeResponse,
): boolean {
  return (
    initializationResponse.agentCapabilities?.sessionCapabilities
      ?.additionalDirectories != null
  );
}

const ACP_AUTH_REQUIRED_CODE = -32000;

async function requireAuthenticated<T>(
  initializationResponse: InitializeResponse,
  request: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (
      error instanceof RequestError &&
      error.code === ACP_AUTH_REQUIRED_CODE
    ) {
      throw new AcpAuthenticationRequiredError(
        initializationResponse.authMethods ?? [],
        error,
      );
    }
    throw error;
  }
}

async function authenticateIfRequested(
  connection: ClientConnection,
  initializationResponse: InitializeResponse,
  handler: AcpAuthenticationHandler | undefined,
): Promise<void> {
  const authMethods = initializationResponse.authMethods ?? [];
  if (!handler) return;
  const selected = await handler([...authMethods], connection.signal);
  if (selected == null) return;
  const methodId = typeof selected === "string" ? selected : selected.methodId;
  const method = authMethods.find((candidate) => candidate.id === methodId);
  if (!method) {
    throw new Error(
      `The agent did not advertise ACP authentication method ${methodId}`,
    );
  }
  if ("type" in method && method.type === "terminal") {
    throw new Error(
      `ACP terminal authentication method ${methodId} requires interactive terminal login`,
    );
  }
  if (
    typeof selected !== "string" &&
    (methodId !== "radius-oauth" ||
      !selected.credential.accessToken ||
      Date.parse(selected.credential.expiresAt) <= Date.now() ||
      !Number.isFinite(Date.parse(selected.credential.expiresAt)))
  )
    throw new Error("Invalid Radius agent credential");
  await connection.agent.request(methods.agent.authenticate, {
    methodId,
    ...(typeof selected === "string"
      ? {}
      : { _meta: { "ai.radius/auth": selected.credential } }),
  });
}

function isMissingSessionError(error: unknown, sessionId: string): boolean {
  if (!(error instanceof RequestError)) return false;
  const message = error.message.toLowerCase();
  // FX reports a missing continuation without echoing the requested ID.
  // Only accept this exact response to session/load or session/resume;
  // unrelated invalid-parameter and authentication failures must still fail.
  if (
    error.code === -32602 &&
    message === "session not found" &&
    error.data == null
  )
    return true;
  const normalizedSessionId = sessionId.toLowerCase();
  const data = error.data;
  const dataMatches =
    data === sessionId ||
    (typeof data === "object" &&
      data !== null &&
      Object.values(data).some((value) => value === sessionId));
  if (error.code === -32002) {
    return dataMatches || message.includes(normalizedSessionId);
  }
  return (
    (error.code === -32602 || error.code === -32603) &&
    message.includes(normalizedSessionId) &&
    /session.*(?:not found|unknown|missing)|(?:not found|unknown|missing).*session/.test(
      message,
    )
  );
}
