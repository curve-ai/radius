import {
  PROTOCOL_VERSION,
  agent,
  methods,
  ndJsonStream,
  type AgentApp,
  type AgentConnection,
  type AgentContext,
  type ContentBlock,
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
  sendText(text: string): Promise<void>;
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
        this.runPrompt(context.params.sessionId, context.params.prompt, context.client),
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

    try {
      const result = await this.definition.run({
        sessionId,
        cwd: session.cwd,
        prompt,
        text: prompt
          .filter((item): item is Extract<ContentBlock, { type: "text" }> =>
            item.type === "text",
          )
          .map((item) => item.text)
          .join("\n"),
        signal: turn.signal,
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

export function defineAgent(definition: RadiusAgentDefinition): RadiusAgent {
  return new RadiusAgent(definition);
}

export type { ContentBlock, StopReason } from "@agentclientprotocol/sdk";
