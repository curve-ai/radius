import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli } from "./main.js";

test("documents token lifecycle commands and validates scopes before network access", async () => {
  const help = captureIo();
  await runCli(["--help"], { io: help.io });
  assert.match(help.out.join("\n"), /radius tokens create/);
  assert.match(help.out.join("\n"), /radius members role/);
  await assert.rejects(
    runCli(["tokens", "create", "--label", "CI"], { io: help.io }),
    /At least one --scope is required/,
  );
  await assert.rejects(
    runCli(["members", "role", "11111111-1111-4111-8111-111111111111"], {
      io: help.io,
    }),
    /--role must be one of/,
  );
});

function captureIo() {
  const out: string[] = [];
  const errors: string[] = [];
  return {
    out,
    errors,
    io: {
      out: (message: string) => out.push(message),
      error: (message: string) => errors.push(message),
    },
  };
}

test("initializes and validates a TypeScript agent repository", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-cli-init-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "research-agent", private: true }),
  );
  const captured = captureIo();

  await runCli(["init", "--skip-install", "--agent-ref", "agent_example1"], {
    cwd: root,
    io: captured.io,
  });

  assert.match(
    await readFile(join(root, "radius.config.ts"), "utf8"),
    /agent_example1/,
  );
  assert.match(
    await readFile(join(root, "radius", "agent.ts"), "utf8"),
    /defineAgent/,
  );
  assert.equal(
    (await readFile(join(root, ".gitignore"), "utf8")).trim(),
    ".radius/",
  );

  const validated = captureIo();
  await runCli(["validate"], { cwd: root, io: validated.io });
  assert.ok(validated.out.includes("Agent: Research Agent"));
  assert.ok(validated.out.includes("Runtime: typescript"));
});

test("initializes and validates an existing Python repository", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-cli-python-init-"));
  await writeFile(
    join(root, "pyproject.toml"),
    `[project]
name = "operations-agent"
version = "0.1.0"
requires-python = ">=3.12,<3.15"
dependencies = []
`,
  );
  const captured = captureIo();

  await runCli(
    [
      "init",
      "--language",
      "python",
      "--skip-install",
      "--agent-ref",
      "agent_python1",
    ],
    { cwd: root, io: captured.io },
  );

  const pyproject = await readFile(join(root, "pyproject.toml"), "utf8");
  assert.match(pyproject, /\[tool\.radius\]/);
  assert.match(pyproject, /module = "radius_agent\.agent"/);
  assert.match(
    await readFile(join(root, "radius_agent", "agent.py"), "utf8"),
    /define_agent/,
  );

  const validated = captureIo();
  await runCli(["validate"], { cwd: root, io: validated.io });
  assert.ok(validated.out.includes("Agent: Operations Agent"));
  assert.ok(validated.out.includes("Runtime: python"));
});

test("refuses to overwrite generated files without force", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-cli-overwrite-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "agent" }),
  );
  const captured = captureIo();
  await runCli(["init", "--skip-install"], { cwd: root, io: captured.io });
  await assert.rejects(
    runCli(["init", "--skip-install"], { cwd: root, io: captured.io }),
    /Refusing to overwrite/,
  );
});

test("validates an agent reference before writing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "radius-cli-agent-ref-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "agent" }),
  );
  const captured = captureIo();

  await assert.rejects(
    runCli(["init", "--skip-install", "--agent-ref", "not-an-agent"], {
      cwd: root,
      io: captured.io,
    }),
  );
  await assert.rejects(readFile(join(root, "radius.config.ts"), "utf8"));
});

test("documents the separated dev, build, and deploy workflow", async () => {
  const captured = captureIo();
  await runCli(["--help"], { io: captured.io });
  const help = captured.out.join("\n");
  assert.match(help, /radius dev \[--endpoint <ws-url>\]/);
  assert.match(help, /radius build \[--config <path>\]/);
  assert.match(help, /radius deploy \[--build <digest-or-receipt>\]/);
});
