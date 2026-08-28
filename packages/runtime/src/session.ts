import {
  PROTOCOL_VERSION,
  client,
  methods,
  type ActiveSession,
  type AgentApp,
  type ClientConnection,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type McpServer,
  type SessionNotification,
  type SessionConfigOption,
  type StopReason,
  type Stream,
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

export interface AcpRuntimeHandlers {
  onPermissionRequest: AcpPermissionHandler;
  onUpdate?: AcpUpdateHandler;
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
      .onRequest(methods.client.fs.readTextFile, async () => {
        throw new Error("Radius did not advertise direct ACP file reads");
      })
      .onRequest(methods.client.fs.writeTextFile, async () => {
        throw new Error("Radius did not advertise direct ACP file writes");
      });

    const connection = app.connect(target as Stream & AgentApp);
    await connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
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
