import assert from "node:assert/strict";
import { lookup } from "node:dns/promises";
import { cp, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { checkAgent } from "./check.js";
import { loadConfig } from "./config.js";
import {
  findExecutable,
  resolveStartCommand,
  startEnvironment,
} from "./start-command.js";

/**
 * The langgraph runtime end to end: the real adapter from this repository,
 * started by uv over the weather fixture, judged by the same check `radius
 * check` runs. The only test here that leaves the process, so it is skipped
 * rather than failed where uv is missing or PyPI cannot be reached — uv still
 * has to fetch langgraph for the adapter's environment.
 */

const here = dirname(fileURLToPath(import.meta.url));
const ADAPTER = resolve(here, "../../langgraph-acp-python");
const TYPESCRIPT_ADAPTER = resolve(here, "../../langgraph-acp-typescript");

async function skipReason(): Promise<string | false> {
  // The adapter refuses to start on Windows until its stdio layer supports it.
  if (process.platform === "win32")
    return "the adapter does not run on Windows yet";
  if (!(await findExecutable("uv", process))) return "uv is not on PATH";
  try {
    await lookup("pypi.org");
  } catch {
    return "no network to install the adapter's dependencies";
  }
  return false;
}

test(
  "a langgraph runtime passes check with its graph advertised",
  { skip: await skipReason(), timeout: 300_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "radius-langgraph-"));
    await cp(join(ADAPTER, "tests/fixtures/weather"), root, {
      recursive: true,
    });
    await writeFile(
      join(root, "radius.json"),
      JSON.stringify({ name: "Weather", runtime: { kind: "langgraph" } }),
    );

    // The adapter is not on PyPI, so the pinned default cannot install; the
    // override is how a checkout runs it.
    const env = { ...process.env, RADIUS_LANGGRAPH_ADAPTER: ADAPTER };
    const config = await loadConfig(root);
    const start = await resolveStartCommand(
      config,
      root,
      { platform: process.platform, arch: process.arch, env },
      () => {},
    );
    assert.equal(start.summary, "langgraph weather");

    const result = await checkAgent({
      command: start.command,
      root,
      env: startEnvironment(start, env),
      // A cold uv cache resolves and installs langgraph first.
      timeoutMs: 240_000,
    });
    assert.equal(
      result.passed,
      true,
      JSON.stringify(result.verdicts, null, 2) + result.probe.stderrTail,
    );
    assert.equal(result.agentInfo?.name, "radius-langgraph");
    assert.deepEqual(result.advertisedAgents, ["weather"]);
  },
);

/**
 * The same for TypeScript graphs. Nothing to fetch: the adapter and the
 * fixture's LangGraph both come from this workspace's `node_modules`, linked
 * into the copy the way a project has its own installed.
 */
test(
  "a TypeScript langgraph runtime passes check with its graph advertised",
  { timeout: 120_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "radius-langgraph-ts-"));
    await cp(join(TYPESCRIPT_ADAPTER, "test/fixtures/weather"), root, {
      recursive: true,
    });
    await symlink(
      resolve(here, "../../../node_modules"),
      join(root, "node_modules"),
      "junction",
    );
    await writeFile(
      join(root, "radius.json"),
      JSON.stringify({
        name: "Weather",
        runtime: { kind: "langgraph", language: "typescript" },
      }),
    );

    const env = {
      ...process.env,
      RADIUS_LANGGRAPH_ADAPTER: TYPESCRIPT_ADAPTER,
    };
    const config = await loadConfig(root);
    const start = await resolveStartCommand(
      config,
      root,
      { platform: process.platform, arch: process.arch, env },
      () => {},
    );
    assert.equal(start.summary, "langgraph weather");
    assert.equal(
      start.command[1],
      join(TYPESCRIPT_ADAPTER, "bin", "radius-langgraph.mjs"),
    );

    const result = await checkAgent({
      command: start.command,
      root,
      env: startEnvironment(start, env),
      timeoutMs: 60_000,
    });
    assert.equal(
      result.passed,
      true,
      JSON.stringify(result.verdicts, null, 2) + result.probe.stderrTail,
    );
    assert.equal(result.agentInfo?.name, "radius-langgraph");
    assert.deepEqual(result.advertisedAgents, ["weather"]);
  },
);
