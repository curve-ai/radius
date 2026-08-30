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
  const dependencies = [`@curve-ai/sdk@${TOOLCHAIN_VERSION}`];
  const devDependencies = [
    `@curve-ai/build@${TOOLCHAIN_VERSION}`,
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
  const args = ["add", `radius-agent-sdk==${TOOLCHAIN_VERSION}`];
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
  return `import { defineAgent } from "@curve-ai/sdk";\n\nconst agent = defineAgent({\n  name: "radius-agent",\n  async run({ text }) {\n    return { text: \`Received: \${text}\` };\n  },\n});\n\nif (process.argv.includes("--radius-dev")) {\n  const { serveDevelopmentAgent } = await import("@curve-ai/sdk/development");\n  const server = await serveDevelopmentAgent(agent);\n  console.log(\`Radius ACP development endpoint: \${server.endpoint}\`);\n} else {\n  agent.serveStdio();\n}\n`;
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
  return `from radius_agent_sdk import RunContext, define_agent, serve_stdio


async def run(context: RunContext) -> str:
    return f"Received: {context.text}"


agent = define_agent(name="radius-agent", run=run)

if __name__ == "__main__":
    serve_stdio(agent)
`;
}
