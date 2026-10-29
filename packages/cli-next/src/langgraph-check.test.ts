import assert from "node:assert/strict";
import { lookup } from "node:dns/promises";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
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

const ADAPTER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../langgraph-acp-python",
);

async function skipReason(): Promise<string | false> {
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
