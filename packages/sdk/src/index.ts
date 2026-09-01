import {
  PROTOCOL_VERSION,
  agent,
  methods,
  ndJsonStream,
  type AgentApp,
  type AgentConnection,
  type AgentContext,
  type ContentBlock,
  type EnvVariable,
  type TerminalExitStatus,
  type StopReason,
  type Stream,
} from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";

export interface RadiusAgentRunContext {
  readonly sessionId: string;
  readonly cwd: string;
  readonly prompt: readonly ContentBlock[];
  readonly text: string;
  readonly signal: AbortSignal;
  readonly files: {
    readTextFile(input: {
      path: string;
      line?: number | null;
      limit?: number | null;
    }): Promise<string>;
    writeTextFile(input: { path: string; content: string }): Promise<void>;
  };
  readonly terminal: {
    execute(input: RadiusTerminalExecuteInput): Promise<RadiusTerminalResult>;
  };
  setSessionTitle(title: string): Promise<void>;
  sendText(text: string): Promise<void>;
}

export interface RadiusTerminalExecuteInput {
  command: string;
  args?: string[];
  cwd?: string | null;
  env?: EnvVariable[];
  outputByteLimit?: number | null;
}

export interface RadiusTerminalResult {
  exitStatus: TerminalExitStatus | null;
  output: string;
  truncated: boolean;
}

export interface RadiusAgentRunResult {
  text?: string;
  stopReason?: StopReason;
}

export interface RadiusAgentDefinition {
  name: string;
  run(
    context: RadiusAgentRunContext,
  ):
    | void
    | string
    | RadiusAgentRunResult
    | Promise<void | string | RadiusAgentRunResult>;
}

interface RadiusAgentSession {
  cwd: string;
  activeTurn: AbortController | null;
}

export class RadiusAgent {
  readonly app: AgentApp;
  private readonly sessions = new Map<string, RadiusAgentSession>();

  constructor(private readonly definition: RadiusAgentDefinition) {
    if (!definition.name.trim()) throw new Error("Agent name is required");

    this.app = agent({ name: definition.name })
      .onRequest(methods.agent.initialize, () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false },
      }))
      .onRequest(methods.agent.session.new, (context) => {
        const sessionId = randomUUID();
        this.sessions.set(sessionId, {
          cwd: context.params.cwd,
          activeTurn: null,
        });
        return { sessionId };
      })
      .onRequest(methods.agent.session.prompt, async (context) =>
        this.runPrompt(
          context.params.sessionId,
          context.params.prompt,
          context.client,
        ),
      )
      .onNotification(methods.agent.session.cancel, (context) => {
        this.sessions.get(context.params.sessionId)?.activeTurn?.abort();
      });
  }

  connect(target: Stream): AgentConnection {
    return this.app.connect(target);
  }

  serveStdio(): AgentConnection {
    const input = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
    const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
    return this.connect(ndJsonStream(input, output));
  }

  private async runPrompt(
    sessionId: string,
    prompt: ContentBlock[],
    client: AgentContext,
  ): Promise<{ stopReason: StopReason }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown Radius session ${sessionId}`);

    session.activeTurn?.abort();
    const turn = new AbortController();
    session.activeTurn = turn;

    const sendText = async (text: string) => {
      if (!text) return;
      await client.notify(methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      });
    };
    const setSessionTitle = async (title: string) => {
      const normalized = title.trim();
      if (!normalized) throw new Error("Session title is required");
      await client.notify(methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "session_info_update",
          title: normalized,
        },
      });
    };

    try {
      const result = await this.definition.run({
        sessionId,
        cwd: session.cwd,
        prompt,
        text: prompt
          .filter(
            (item): item is Extract<ContentBlock, { type: "text" }> =>
              item.type === "text",
          )
          .map((item) => item.text)
          .join("\n"),
        signal: turn.signal,
        files: {
          readTextFile: async (input) => {
            const result = await client.request(
              methods.client.fs.readTextFile,
              {
                sessionId,
                path: input.path,
                line: input.line,
                limit: input.limit,
              },
            );
            return result.content;
          },
          writeTextFile: async (input) => {
            await client.request(methods.client.fs.writeTextFile, {
              sessionId,
              path: input.path,
              content: input.content,
            });
          },
        },
        terminal: {
          execute: (input) =>
            executeTerminal(client, sessionId, session.cwd, turn.signal, input),
        },
        setSessionTitle,
        sendText,
      });

      if (turn.signal.aborted) return { stopReason: "cancelled" };
      if (typeof result === "string") {
        await sendText(result);
        return { stopReason: "end_turn" };
      }
      if (result?.text) await sendText(result.text);
      return { stopReason: result?.stopReason ?? "end_turn" };
    } catch (error) {
      if (turn.signal.aborted) return { stopReason: "cancelled" };
      throw error;
    } finally {
      if (session.activeTurn === turn) session.activeTurn = null;
    }
  }
}

async function executeTerminal(
  client: AgentContext,
  sessionId: string,
  defaultCwd: string,
  signal: AbortSignal,
  input: RadiusTerminalExecuteInput,
): Promise<RadiusTerminalResult> {
  if (signal.aborted) throw abortError();
  const terminal = await client.request(methods.client.terminal.create, {
    sessionId,
    command: input.command,
    args: input.args,
    cwd: input.cwd ?? defaultCwd,
    env: input.env,
    outputByteLimit: input.outputByteLimit,
  });
  const kill = (): void => {
    void client.request(methods.client.terminal.kill, {
      sessionId,
      terminalId: terminal.terminalId,
    });
  };
  signal.addEventListener("abort", kill, { once: true });
  try {
    await client.request(methods.client.terminal.waitForExit, {
      sessionId,
      terminalId: terminal.terminalId,
    });
    const output = await client.request(methods.client.terminal.output, {
      sessionId,
      terminalId: terminal.terminalId,
    });
    return {
      exitStatus: output.exitStatus ?? null,
      output: output.output,
      truncated: output.truncated,
    };
  } finally {
    signal.removeEventListener("abort", kill);
    await client.request(methods.client.terminal.release, {
      sessionId,
      terminalId: terminal.terminalId,
    });
  }
}

function abortError(): Error {
  const error = new Error("Radius agent turn was cancelled");
  error.name = "AbortError";
  return error;
}

export function defineAgent(definition: RadiusAgentDefinition): RadiusAgent {
  return new RadiusAgent(definition);
}

export type { ContentBlock, StopReason } from "@agentclientprotocol/sdk";
