import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PROTOCOL_VERSION,
  agent,
  methods,
  type AgentContext,
  type PromptRequest,
} from "@agentclientprotocol/sdk";
import { AcpRuntimeSession } from "@curve-ai/radius-runtime";

import { HostFileSystemManager } from "./file-system-access";
import { MacOsTerminalManager } from "./terminal-execution";

test(
  "ACP reaches approved macOS files and a Seatbelt terminal",
  { skip: process.platform !== "darwin" },
  async (context) => {
    const projectRoot = await realpath(
      await mkdtemp(path.join(tmpdir(), "radius-acp-host-project-")),
    );
    context.after(() => rm(projectRoot, { force: true, recursive: true }));
    const agentSessionId = "acp-host-session";
    const results: string[] = [];
    const terminalManager = new MacOsTerminalManager({
      projectRoots: [projectRoot],
      authorize: async () => "terminal-call",
      onResult: (result) => {
        results.push(`terminal:${result.exitCode}`);
      },
    });
    const fileManager = new HostFileSystemManager({
      projectRoots: [projectRoot],
      authorize: async (request) => `${request.operation}-call`,
      onResult: (result) => {
        results.push(`${result.operation}:${result.succeeded}`);
      },
    });
    const fakeAgent = agent({ name: "radius-host-capability-test" })
      .onRequest(methods.agent.initialize, (request) => {
        assert.equal(request.params.clientCapabilities?.terminal, true);
        assert.equal(request.params.clientCapabilities?.fs?.readTextFile, true);
        assert.equal(
          request.params.clientCapabilities?.fs?.writeTextFile,
          true,
        );
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { loadSession: false },
        };
      })
      .onRequest(methods.agent.session.new, (request) => {
        assert.equal(request.params.cwd, projectRoot);
        return { sessionId: agentSessionId };
      })
      .onRequest(methods.agent.session.prompt, async (request) => {
        await exerciseHostCapabilities(
          request.params,
          request.client,
          projectRoot,
        );
        return { stopReason: "end_turn" as const };
      });

    const runtime = await AcpRuntimeSession.connect(fakeAgent, {
      cwd: projectRoot,
      handlers: {
        fileSystem: fileManager,
        onPermissionRequest: async () => ({ outcome: "cancelled" }),
        terminal: terminalManager,
      },
    });
    terminalManager.bindSession(runtime.sessionId);
    fileManager.bindSession(runtime.sessionId);
    try {
      const response = await runtime.prompt("Use the Mac workspace");
      assert.equal(response.text, `host-ready:${projectRoot}`);
      assert.deepEqual(results.sort(), [
        "read:true",
        "terminal:0",
        "write:true",
      ]);
    } finally {
      runtime.close();
      await terminalManager.close();
    }
  },
);

async function exerciseHostCapabilities(
  request: PromptRequest,
  client: AgentContext,
  projectRoot: string,
): Promise<void> {
  const notePath = path.join(projectRoot, "note.txt");
  await client.request(methods.client.fs.writeTextFile, {
    sessionId: request.sessionId,
    path: notePath,
    content: "host-ready",
  });
  const note = await client.request(methods.client.fs.readTextFile, {
    sessionId: request.sessionId,
    path: notePath,
  });
  assert.equal(note.content, "host-ready");

  const terminal = await client.request(methods.client.terminal.create, {
    sessionId: request.sessionId,
    command: "/bin/pwd",
    cwd: projectRoot,
  });
  await client.request(methods.client.terminal.waitForExit, {
    sessionId: request.sessionId,
    terminalId: terminal.terminalId,
  });
  const output = await client.request(methods.client.terminal.output, {
    sessionId: request.sessionId,
    terminalId: terminal.terminalId,
  });
  await client.request(methods.client.terminal.release, {
    sessionId: request.sessionId,
    terminalId: terminal.terminalId,
  });
  await client.notify(methods.client.session.update, {
    sessionId: request.sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: `${note.content}:${output.output.trim()}`,
      },
    },
  });
}
