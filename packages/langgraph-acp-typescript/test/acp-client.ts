/** A raw JSON-RPC ACP client that drives `radius-langgraph` as a subprocess. */

import { spawn, type ChildProcess } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(here, "..", "bin", "radius-langgraph.mjs");
const FIXTURES = join(here, "fixtures");
const REPO_NODE_MODULES = resolve(here, "..", "..", "..", "node_modules");

type Json = Record<string, any>;
export type PermissionHandler = (params: Json) => Json | "error";

export const approve: PermissionHandler = () => ({
  outcome: { outcome: "selected", optionId: "approve" },
});

export interface Project {
  readonly dir: string;
  cleanup(): void;
}

/**
 * A project in a temporary directory, so checkpoints never leak between
 * tests: a copy of a fixture, or the given files. Graphs import LangGraph by
 * bare specifier, so the workspace's `node_modules` is linked in the way a
 * project would have it installed, unless `linkModules` is false.
 */
export function makeProject(
  source: { fixture: string } | { files: Record<string, string> },
  { linkModules = true }: { linkModules?: boolean } = {},
): Project {
  const parent = mkdtempSync(join(tmpdir(), "radius-langgraph-"));
  const dir = join(parent, "project");
  if ("fixture" in source) {
    cpSync(join(FIXTURES, source.fixture), dir, { recursive: true });
  } else {
    mkdirSync(dir);
    for (const [name, text] of Object.entries(source.files)) {
      writeFileSync(join(dir, name), text);
    }
  }
  if (linkModules) {
    symlinkSync(REPO_NODE_MODULES, join(dir, "node_modules"), "junction");
  }
  return {
    dir,
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  };
}

export class AcpProcess {
  readonly stdoutLines: string[] = [];
  readonly badLines: string[] = [];
  readonly notifications: Json[] = [];
  readonly permissionRequests: Json[] = [];
  onPermission: PermissionHandler = approve;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve(message: Json): void; reject(error: Error): void }
  >();
  private readonly waiters = new Set<() => void>();
  private stderrText = "";
  private buffer = "";
  private readonly exited: Promise<number>;

  private constructor(readonly proc: ChildProcess) {
    proc.stdout!.setEncoding("utf8");
    proc.stdout!.on("data", (chunk: string) => this.onData(chunk));
    proc.stderr!.setEncoding("utf8");
    proc.stderr!.on("data", (chunk: string) => (this.stderrText += chunk));
    this.exited = new Promise((resolve) =>
      proc.on("exit", (code, signal) => resolve(code ?? (signal ? 128 : 0))),
    );
  }

  static start(cwd: string, ...args: string[]): AcpProcess {
    const proc = spawn(process.execPath, [BIN, ...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    return new AcpProcess(proc);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      this.stdoutLines.push(line);
      let message: Json;
      try {
        message = JSON.parse(line);
      } catch {
        this.badLines.push(line);
        continue;
      }
      this.onMessage(message);
    }
  }

  private onMessage(message: Json): void {
    if ("method" in message && "id" in message) {
      this.answer(message);
    } else if ("id" in message) {
      const waiter = this.pending.get(message.id);
      this.pending.delete(message.id);
      waiter?.resolve(message);
    } else {
      this.notifications.push(message);
      for (const wake of this.waiters) wake();
    }
  }

  private answer(message: Json): void {
    if (message.method === "session/request_permission") {
      this.permissionRequests.push(message.params);
      const result = this.onPermission(message.params);
      if (result === "error") {
        this.send({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32601,
            message: `method not found: ${message.method}`,
          },
        });
      } else {
        this.send({ jsonrpc: "2.0", id: message.id, result });
      }
    } else {
      this.send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `method not found: ${message.method}` },
      });
    }
  }

  private send(payload: Json): void {
    this.proc.stdin!.write(`${JSON.stringify(payload)}\n`);
  }

  async request(
    method: string,
    params: Json,
    timeoutMs = 20_000,
  ): Promise<Json> {
    const id = this.nextId++;
    const response = await new Promise<Json>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${method} timed out\n${this.stderrText}`)),
        timeoutMs,
      );
      this.pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject,
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
    if (response.error) {
      throw new Error(`${method} failed: ${JSON.stringify(response.error)}`);
    }
    return response.result;
  }

  notify(method: string, params: Json): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  initialize(): Promise<Json> {
    return this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
    });
  }

  newSession(cwd: string): Promise<Json> {
    return this.request("session/new", { cwd, mcpServers: [] });
  }

  prompt(sessionId: string, text: string): Promise<Json> {
    return this.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  updates(sessionId: string, kind?: string): Json[] {
    return this.notifications
      .filter(
        (n) =>
          n.method === "session/update" &&
          n.params.sessionId === sessionId &&
          (kind === undefined || n.params.update.sessionUpdate === kind),
      )
      .map((n) => n.params.update);
  }

  agentText(sessionId: string): string {
    return this.updates(sessionId, "agent_message_chunk")
      .map((u) => u.content.text)
      .join("");
  }

  async waitForUpdate(sessionId: string, kind: string, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (this.updates(sessionId, kind).length === 0) {
      if (Date.now() > deadline) throw new Error(`no ${kind} update`);
      await new Promise<void>((resolve) => {
        const wake = () => {
          this.waiters.delete(wake);
          resolve();
        };
        this.waiters.add(wake);
        setTimeout(wake, 100);
      });
    }
  }

  clear(): void {
    this.notifications.length = 0;
  }

  /** Closes stdin, the way a client hangs up, and waits for the exit. */
  async close(): Promise<{ code: number; stderr: string }> {
    this.proc.stdin!.end();
    const timer = setTimeout(() => this.proc.kill("SIGKILL"), 10_000);
    const code = await this.exited;
    clearTimeout(timer);
    return { code, stderr: this.stderrText };
  }
}
