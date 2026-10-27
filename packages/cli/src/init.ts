import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";

import { AgentConfigSchema, type AgentConfig } from "@curve-ai/agent-contracts";

import type { CliIo } from "./io.js";

export interface InitOptions {
  root: string;
  agentRef?: string;
  language?: "typescript" | "python";
  skipInstall?: boolean;
  force?: boolean;
  io: CliIo;
}

const TOOLCHAIN_VERSION = "0.0.1";
const ACP_TYPESCRIPT_VERSION = "1.4.0";
const ACP_PYTHON_VERSION = "0.12.1";

export async function initializeAgentProject(
  options: InitOptions,
): Promise<void> {
  if (options.language === "python") {
    await initializePythonAgentProject(options);
    return;
  }
  const packagePath = join(options.root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
    name?: string;
  };
  const displayName = humanizeName(packageJson.name ?? basename(options.root));
  const config = AgentConfigSchema.parse({
    schemaVersion: 1,
    agent: options.agentRef ?? null,
    name: displayName,
    runtime: {
      kind: "typescript",
      entrypoint: "radius/agent.ts",
      node: "22",
    },
    development: {
      endpoint: "ws://127.0.0.1:7331/acp",
    },
    capabilities: [],
    networkAllowlist: [],
  });
  const configPath = join(options.root, "radius.config.ts");
  const agentPath = join(options.root, "radius", "agent.ts");

  await assertWritable(configPath, options.force ?? false);
  await assertWritable(agentPath, options.force ?? false);

  await writeFile(configPath, renderConfig(config), "utf8");
  await mkdir(dirname(agentPath), { recursive: true });
  await writeFile(agentPath, renderAgent(), "utf8");
  await ensureGitignore(options.root);

  if (!options.skipInstall) installToolchain(options.root);

  options.io.out(`Created ${configPath}`);
  options.io.out(`Created ${agentPath}`);
  options.io.out(
    "Next: run the agent with --radius-dev, then run radius validate && radius dev",
  );
}

async function initializePythonAgentProject(
  options: InitOptions,
): Promise<void> {
  const pyprojectPath = join(options.root, "pyproject.toml");
  let pyproject = "";
  try {
    pyproject = await readFile(pyprojectPath, "utf8");
  } catch {
    const packageName = basename(options.root)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-");
    pyproject = `[project]
name = ${JSON.stringify(packageName || "radius-agent")}
version = "0.0.1"
requires-python = ">=3.12,<3.15"
dependencies = []
`;
  }
  const parsed = parseToml(pyproject) as {
    project?: { name?: unknown };
    tool?: { radius?: unknown };
  };
  if (parsed.tool?.radius !== undefined) {
    throw new Error(
      `Refusing to overwrite existing [tool.radius] in ${pyprojectPath}`,
    );
  }
  const projectName =
    typeof parsed.project?.name === "string"
      ? parsed.project.name
      : basename(options.root);
  const displayName = humanizeName(projectName);
  const config = AgentConfigSchema.parse({
    schemaVersion: 1,
    agent: options.agentRef ?? null,
    name: displayName,
    runtime: {
      kind: "python",
      module: "radius_agent.agent",
      python: "3.12",
      lockfile: "uv.lock",
    },
    capabilities: [],
    networkAllowlist: [],
  });
  const packageRoot = join(options.root, "radius_agent");
  const initPath = join(packageRoot, "__init__.py");
  const agentPath = join(packageRoot, "agent.py");

  await assertWritable(initPath, options.force ?? false);
  await assertWritable(agentPath, options.force ?? false);
  await mkdir(packageRoot, { recursive: true });
  await writeFile(initPath, '"""Radius agent package."""\n', "utf8");
  await writeFile(agentPath, renderPythonAgent(), "utf8");
  const separator = pyproject.endsWith("\n") ? "\n" : "\n\n";
  await writeFile(
    pyprojectPath,
    `${pyproject}${separator}${renderPythonConfig(config)}`,
    "utf8",
  );
  await ensureGitignore(options.root);

  if (!options.skipInstall) installPythonToolchain(options.root);

  options.io.out(`Updated ${pyprojectPath}`);
  options.io.out(`Created ${agentPath}`);
  options.io.out(
    "Next: expose a loopback ACP WebSocket endpoint, configure development.endpoint, then run radius dev",
  );
}

async function assertWritable(path: string, force: boolean): Promise<void> {
  if (existsSync(path) && !force) {
    throw new Error(`Refusing to overwrite existing file ${path}`);
  }
}

async function ensureGitignore(root: string): Promise<void> {
  const path = join(root, ".gitignore");
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch {
    // A new repository may not have a .gitignore yet.
  }
  if (existing.split(/\r?\n/).includes(".radius/")) return;
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await appendFile(path, `${prefix}.radius/\n`, "utf8");
}

function installToolchain(root: string): void {
  const packageManager = detectPackageManager(root);
  const dependencies = [`@agentclientprotocol/sdk@${ACP_TYPESCRIPT_VERSION}`];
  const devDependencies = [
    `@curve-ai/build@${TOOLCHAIN_VERSION}`,
    `@curve-ai/radius-runtime@${TOOLCHAIN_VERSION}`,
    `@curve-ai/cli@${TOOLCHAIN_VERSION}`,
  ];
  const commands: Array<[string, string[]]> =
    packageManager === "bun"
      ? [
          ["bun", ["add", ...dependencies]],
          ["bun", ["add", "--dev", ...devDependencies]],
        ]
      : packageManager === "pnpm"
        ? [
            ["pnpm", ["add", ...dependencies]],
            ["pnpm", ["add", "--save-dev", ...devDependencies]],
          ]
        : packageManager === "yarn"
          ? [
              ["yarn", ["add", ...dependencies]],
              ["yarn", ["add", "--dev", ...devDependencies]],
            ]
          : [
              ["npm", ["install", ...dependencies]],
              ["npm", ["install", "--save-dev", ...devDependencies]],
            ];

  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `${command} ${args.join(" ")} failed with ${result.status}`,
      );
    }
  }
}

function installPythonToolchain(root: string): void {
  const args = ["add", `agent-client-protocol==${ACP_PYTHON_VERSION}`];
  const result = spawnSync("uv", args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`uv ${args.join(" ")} failed with ${result.status}`);
  }
}

function detectPackageManager(root: string): "bun" | "pnpm" | "yarn" | "npm" {
  if (existsSync(join(root, "bun.lock"))) return "bun";
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

function humanizeName(value: string): string {
  return value
    .replace(/^@[^/]+\//, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function renderConfig(config: AgentConfig): string {
  return `// This file is validated against @curve-ai/agent-contracts by the Radius CLI.\nexport default {\n  schemaVersion: 1,\n  agent: ${JSON.stringify(config.agent)},\n  name: ${JSON.stringify(config.name)},\n  runtime: {\n    kind: "typescript",\n    entrypoint: "radius/agent.ts",\n    node: "22",\n  },\n  capabilities: [],\n  networkAllowlist: [],\n  minimumDesktopVersion: ${JSON.stringify(config.minimumDesktopVersion)},\n};\n`;
}

function renderAgent(): string {
  return 'import { PROTOCOL_VERSION, agent, methods, ndJsonStream } from "@agentclientprotocol/sdk";\nimport { randomUUID } from "node:crypto";\nimport { Readable, Writable } from "node:stream";\n\nexport function createAgent() {\n  const sessions = new Set<string>();\n  return agent({ name: "radius-agent" })\n    .onRequest(methods.agent.initialize, () => ({ protocolVersion: PROTOCOL_VERSION }))\n    .onRequest(methods.agent.session.new, () => {\n      const sessionId = randomUUID();\n      sessions.add(sessionId);\n      return { sessionId };\n    })\n    .onRequest(methods.agent.session.prompt, async ({ params, client }) => {\n      if (!sessions.has(params.sessionId)) throw new Error("Unknown session");\n      const text = params.prompt.filter((block) => block.type === "text").map((block) => block.text).join("\\n");\n      await client.notify(methods.client.session.update, {\n        sessionId: params.sessionId,\n        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Received: ${text}` } },\n      });\n      return { stopReason: "end_turn" };\n    });\n}\n\nif (process.argv.includes("--radius-dev")) {\n  const { serveDevelopmentAgent } = await import("@curve-ai/radius-runtime/development");\n  const server = await serveDevelopmentAgent(createAgent);\n  console.log(`Radius ACP development endpoint: ${server.endpoint}`);\n} else {\n  createAgent().connect(ndJsonStream(\n    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,\n    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,\n  ));\n}\n';
}

function renderPythonConfig(config: AgentConfig): string {
  if (config.runtime.kind !== "python") {
    throw new Error("Python config rendering requires a Python runtime");
  }
  return `[tool.radius]
schemaVersion = 1
${config.agent ? `agent = ${JSON.stringify(config.agent)}\n` : ""}name = ${JSON.stringify(config.name)}
capabilities = []
networkAllowlist = []
minimumDesktopVersion = ${JSON.stringify(config.minimumDesktopVersion)}

[tool.radius.runtime]
kind = "python"
module = ${JSON.stringify(config.runtime.module)}
python = ${JSON.stringify(config.runtime.python)}
lockfile = ${JSON.stringify(config.runtime.lockfile)}

[tool.radius.resources]
cpu = ${config.resources.cpu}
memoryMb = ${config.resources.memoryMb}
diskMb = ${config.resources.diskMb}
`;
}

function renderPythonAgent(): string {
  return 'from typing import Any\nfrom uuid import uuid4\n\nfrom acp import (\n    Agent, InitializeResponse, NewSessionResponse, PromptResponse,\n    run_agent, text_block, update_agent_message,\n)\nfrom acp.interfaces import Client\n\n\nclass EchoAgent(Agent):\n    def __init__(self) -> None:\n        self.client: Client | None = None\n        self.sessions: set[str] = set()\n\n    def on_connect(self, conn: Client) -> None:\n        self.client = conn\n\n    async def initialize(self, protocol_version: int, **kwargs: Any) -> InitializeResponse:\n        return InitializeResponse(protocol_version=protocol_version)\n\n    async def new_session(self, cwd: str, **kwargs: Any) -> NewSessionResponse:\n        session_id = uuid4().hex\n        self.sessions.add(session_id)\n        return NewSessionResponse(session_id=session_id)\n\n    async def prompt(self, session_id: str, prompt: list[Any], **kwargs: Any) -> PromptResponse:\n        if session_id not in self.sessions or self.client is None:\n            raise ValueError("Unknown or disconnected session")\n        text = "\\n".join(block.text for block in prompt if getattr(block, "type", None) == "text")\n        await self.client.session_update(\n            session_id=session_id,\n            update=update_agent_message(text_block(f"Received: {text}")),\n        )\n        return PromptResponse(stop_reason="end_turn")\n\n\nif __name__ == "__main__":\n    import asyncio\n\n    asyncio.run(run_agent(EchoAgent()))\n';
}
