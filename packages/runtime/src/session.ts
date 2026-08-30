import {
  PROTOCOL_VERSION,
  client,
  methods,
  type ActiveSession,
  type AgentApp,
  type ClientConnection,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type KillTerminalRequest,
  type KillTerminalResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ReleaseTerminalRequest,
  type ReleaseTerminalResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type McpServer,
  type SessionNotification,
  type SessionConfigOption,
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

export interface AcpRuntimeHandlers {
  onPermissionRequest: AcpPermissionHandler;
  fileSystem?: AcpFileSystemHandlers;
  onUpdate?: AcpUpdateHandler;
  terminal?: AcpTerminalHandlers;
}

export interface AcpRuntimeSessionOptions {
  cwd: string;
  handlers: AcpRuntimeHandlers;
  clientName?: string;
  mcpServers?: McpServer[];
  modelId?: string | null;
}

export type AcpRuntimeConnectionTarget = Stream | AgentApp;

export interface AcpRuntimePromptResult {
  stopReason: StopReason;
  text: string;
}

export class AcpRuntimeSession {
  readonly sessionId: string;

  private constructor(
    private readonly connection: ClientConnection,
    private readonly session: ActiveSession,
    private readonly handlers: AcpRuntimeHandlers,
  ) {
    this.sessionId = session.sessionId;
  }

  static async connect(
    target: AcpRuntimeConnectionTarget,
    options: AcpRuntimeSessionOptions,
  ): Promise<AcpRuntimeSession> {
    const app = client({ name: options.clientName ?? "radius-runtime" })
      .onRequest(methods.client.session.requestPermission, async (context) => {
        const decision = await options.handlers.onPermissionRequest(
          context.params,
          context.signal,
        );
        return { outcome: decision } satisfies RequestPermissionResponse;
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
      });

    const connection = app.connect(target as Stream & AgentApp);
    await connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: {
          readTextFile: Boolean(options.handlers.fileSystem?.readTextFile),
          writeTextFile: Boolean(options.handlers.fileSystem?.writeTextFile),
        },
        terminal: Boolean(options.handlers.terminal),
      },
    });
    const session = await connection.agent
      .buildSession({
        cwd: options.cwd,
        mcpServers: options.mcpServers ?? [],
      })
      .start();
    const runtime = new AcpRuntimeSession(
      connection,
      session,
      options.handlers,
    );
    if (options.modelId) await runtime.setModel(options.modelId);
    return runtime;
  }

  availableModels(): Array<{ id: string; label: string }> {
    const option = modelConfigOption(
      this.session.newSessionResponse.configOptions ?? [],
    );
    if (!option) return [];
    return option.options.flatMap((entry) =>
      "options" in entry
        ? entry.options.map((value) => ({ id: value.value, label: value.name }))
        : [{ id: entry.value, label: entry.name }],
    );
  }

  async setModel(modelId: string): Promise<void> {
    const option = modelConfigOption(
      this.session.newSessionResponse.configOptions ?? [],
    );
    if (!option) throw new Error("The agent did not advertise model selection");
    const exists = this.availableModels().some((model) => model.id === modelId);
    if (!exists)
      throw new Error(`The agent did not advertise model ${modelId}`);
    await this.connection.agent.request(methods.agent.session.setConfigOption, {
      sessionId: this.sessionId,
      configId: option.id,
      value: modelId,
    });
  }

  async prompt(text: string): Promise<AcpRuntimePromptResult> {
    const responsePromise = this.session.prompt(text);
    let output = "";

    for (;;) {
      const message = await this.session.nextUpdate();
      if (message.kind === "stop") {
        await responsePromise;
        return { stopReason: message.stopReason, text: output };
      }

      const { notification, update } = message;
      if (
        update.sessionUpdate === "agent_message_chunk" &&
        update.content.type === "text"
      ) {
        output += update.content.text;
      }
      await this.handlers.onUpdate?.(notification);
    }
  }

  async cancel(): Promise<void> {
    await this.connection.agent.notify(methods.agent.session.cancel, {
      sessionId: this.sessionId,
    });
  }

  close(error?: unknown): void {
    this.session.dispose();
    this.connection.close(error);
  }
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
