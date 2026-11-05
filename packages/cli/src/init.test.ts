import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { runInit, type InitFlags } from "./commands/init/run.js";
import { loadConfigFile } from "./config.js";
import type { RadiusContext } from "./context.js";
import { HARNESS_SUPPORT } from "./harness-support.js";

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "radius-init-test-"));
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
  return root;
}

/** The opencode-plus-Python layout the shopfloor testbed has. */
const shopfloor = {
  ".opencode/agent/ops.md": "# ops\n",
  ".opencode/tool/run_query.ts": "export default {};\n",
  ".opencode/package.json":
    '{"dependencies":{"@opencode-ai/plugin":"1.18.31"}}\n',
  ".opencode/bun.lock": "{}\n",
  ".opencode/package-lock.json": "{}\n",
  "opencode.json": '{"instructions":["AGENTS.md"]}\n',
  "opencode-async.json": "{}\n",
  "AGENTS.md": "# Forge\n",
  "pyproject.toml":
    '[project]\nname = "shopfloor-agent"\nversion = "0.1.0"\nrequires-python = ">=3.12"\n',
  "uv.lock": "version = 1\n",
  "src/store.py": "",
  "scripts/seed.py": "",
  "data/seed.sql": "",
  "README.md": "# shopfloor\n",
  ".gitignore": ".venv/\nnode_modules/\n",
};

function registryEntry(version: string) {
  const artifact = (name: string, digit: string) => ({
    archive: `https://example.invalid/v${version}/opencode-${name}`,
    sha256: digit.repeat(64),
    cmd: name.startsWith("windows") ? "./opencode.exe" : "./opencode",
    args: ["acp"],
  });
  return {
    id: "opencode",
    name: "OpenCode",
    version,
    license: "MIT",
    license_url: "https://example.invalid/LICENSE",
    distribution: {
      binary: {
        "darwin-aarch64": artifact("darwin-arm64.zip", "1"),
        "darwin-x86_64": artifact("darwin-x64.zip", "2"),
        "linux-aarch64": artifact("linux-arm64.tar.gz", "3"),
        "linux-x86_64": artifact("linux-x64.tar.gz", "4"),
        "windows-aarch64": artifact("windows-arm64.zip", "5"),
        "windows-x86_64": artifact("windows-x64.zip", "6"),
      },
    },
  };
}

function fakeRegistry(version = "1.19.4") {
  const calls = { count: 0 };
  return {
    calls,
    registry: async () => {
      calls.count += 1;
      return {
        agents: [
          registryEntry(version),
          {
            id: "goose",
            version: "1.0.0",
            distribution: { npx: { package: "goose-acp@1.0.0" } },
          },
        ],
      };
    },
  };
}

function context(cwd: string, output: "text" | "json" = "text") {
  const lines: string[] = [];
  const stdout = new PassThrough();
  const chunks: string[] = [];
  stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  const value = {
    process: {
      stdout,
      stderr: new PassThrough(),
      platform: "darwin",
      arch: "arm64",
      pid: 1,
    },
    cwd,
    env: {},
    isTTY: false,
    colour: false,
    output,
    out: (message: string) => {
      if (output === "text") lines.push(message);
    },
    note: () => {},
    untilStopped: async () => {},
    stop: () => {},
    fail: () => {},
    failure: () => null,
  } as unknown as RadiusContext;
  return {
    context: value,
    text: () => lines.join("\n"),
    json: () => JSON.parse(chunks.join("")),
  };
}

const flags = (overrides: Partial<InitFlags> = {}): InitFlags => ({
  list: false,
  yes: true,
  force: false,
  ...overrides,
});

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

test("a plain project gets five lines of radius.json and the pin in radius.lock", async () => {
  const root = await project({ "README.md": "# plain\n" });
  const run = context(root);
  await runInit(run.context, flags({ harness: "opencode" }), fakeRegistry());

  const config = await readJson(join(root, "radius.json"));
  assert.deepEqual(Object.keys(config), [
    "$schema",
    "agent",
    "name",
    "version",
    "harness",
  ]);
  assert.equal(config.harness, "opencode@1.19.4");
  assert.match(String(config.agent), /^agent_[0-9a-f]{16}$/);

  const lock = await readJson(join(root, "radius.lock"));
  assert.match(String(lock["//"]), /Do not edit/);
  assert.equal(lock.lockfileVersion, 1);
  const harness = lock.harness as Record<string, unknown>;
  assert.equal(harness.registryId, "opencode");
  assert.equal(harness.version, "1.19.4");
  assert.equal(harness.license, "MIT");

  assert.match(
    run.text(),
    /pinned opencode 1\.19\.4 for 6 platforms \(sha256 verified at install\) → radius\.lock/,
  );
  // .radius/ is ignored; the lock is committed, so it must not be.
  const ignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(ignore, /^\.radius\/$/m);
  assert.doesNotMatch(ignore, /radius\.lock/);

  const loaded = await loadConfigFile(root);
  assert.equal(loaded.config.runtime.kind, "harness");
  assert.deepEqual(loaded.config.resources, {
    cpu: 2,
    memoryMb: 4096,
    diskMb: 5120,
  });
});

test("an opencode project is detected without --harness, and its tree inferred", async () => {
  const root = await project(shopfloor);
  const run = context(root);
  await runInit(run.context, flags(), fakeRegistry());

  const config = await readJson(join(root, "radius.json"));
  assert.equal(config.harness, "opencode@1.19.4");
  assert.equal(
    config.name,
    "radius-init-test-" + root.split("radius-init-test-")[1],
  );
  assert.deepEqual(config.include, [
    ".opencode/",
    "opencode.json",
    "opencode-async.json",
    "AGENTS.md",
    "pyproject.toml",
    "uv.lock",
    "src/",
    "scripts/",
  ]);
  assert.deepEqual(config.toolchains, [
    { kind: "python", version: "3.12", lockfile: "uv.lock" },
    { kind: "node", version: "22", lockfile: ".opencode/bun.lock" },
  ]);
  // Left at its default, so not written.
  assert.equal("configRoot" in config, false);
  assert.equal("capabilities" in config, false);

  const output = run.text();
  assert.match(output, /detected opencode \(opencode\.json\)/);
  assert.match(output, /^ {2}include +\.opencode\/ +opencode's agents/m);
  assert.match(output, /^ +opencode-async\.json +an opencode config variant/m);
  assert.match(
    output,
    /toolchains +python 3\.12 +python 3\.12 from uv\.lock \(version from requires-python/,
  );

  // What init wrote is what build accepts — including the rule that every
  // toolchain's lockfile is shipped.
  const { config: loaded } = await loadConfigFile(root);
  assert.equal(loaded.runtime.kind, "harness");
  if (loaded.runtime.kind !== "harness") return;
  assert.equal(loaded.runtime.configRoot, "/opt/data");
  assert.equal(loaded.runtime.toolchains.length, 2);
});

test("a second run changes nothing, says so, and needs no registry", async () => {
  const root = await project(shopfloor);
  await runInit(context(root).context, flags(), fakeRegistry());
  const before = {
    config: await readFile(join(root, "radius.json"), "utf8"),
    lock: await readFile(join(root, "radius.lock"), "utf8"),
    ignore: await readFile(join(root, ".gitignore"), "utf8"),
  };

  const second = context(root);
  const registry = fakeRegistry("9.9.9");
  await runInit(second.context, flags(), registry);
  assert.equal(registry.calls.count, 0);
  assert.match(
    second.text(),
    /radius\.json and radius\.lock are already complete/,
  );
  assert.deepEqual(
    {
      config: await readFile(join(root, "radius.json"), "utf8"),
      lock: await readFile(join(root, "radius.lock"), "utf8"),
      ignore: await readFile(join(root, ".gitignore"), "utf8"),
    },
    before,
  );
});

test("a lost lock is rebuilt when the registry still offers the pin", async () => {
  const root = await project({ "README.md": "" });
  await runInit(
    context(root).context,
    flags({ harness: "opencode" }),
    fakeRegistry(),
  );
  const lock = await readFile(join(root, "radius.lock"), "utf8");
  await writeFile(join(root, "radius.lock"), "not json", "utf8");

  await runInit(context(root).context, flags(), fakeRegistry());
  assert.equal(await readFile(join(root, "radius.lock"), "utf8"), lock);
});

test("a lost lock for an older pin is not silently upgraded", async () => {
  const root = await project({ "README.md": "" });
  await runInit(
    context(root).context,
    flags({ harness: "opencode" }),
    fakeRegistry(),
  );
  await writeFile(join(root, "radius.lock"), "{}", "utf8");

  await assert.rejects(
    () => runInit(context(root).context, flags(), fakeRegistry("1.20.0")),
    (error: Error & { nextAction?: string }) =>
      /pins opencode@1\.19\.4/.test(error.message) &&
      /would now pin 1\.20\.0/.test(error.message) &&
      /radius init --force/.test(error.nextAction ?? ""),
  );
});

/** What the registry serves once opencode has moved to an unsupported major. */
const UNSUPPORTED = "2.2.5";

test("init pins the newest supported version when the registry's is unsupported", async () => {
  const root = await project(shopfloor);
  const run = context(root);
  await runInit(run.context, flags(), fakeRegistry(UNSUPPORTED));

  const config = await readJson(join(root, "radius.json"));
  assert.equal(config.harness, "opencode@1.19.4");
  const lock = await readJson(join(root, "radius.lock"));
  const pinned = HARNESS_SUPPORT.get("opencode")!.pinned!;
  assert.deepEqual(lock.harness, {
    registryId: "opencode",
    version: pinned.version,
    license: pinned.license,
    licenseUrl: pinned.licenseUrl,
    distribution: pinned.distribution,
  });
  assert.match(run.text(), /pinned opencode 1\.19\.4 for 6 platforms/);
  assert.match(run.text(), /registry offers opencode 2\.2\.5/);
  assert.match(run.text(), /1\.19\.4 was pinned instead/);
  await loadConfigFile(root);

  // Stable: a second run holds to the lock without asking the registry, and
  // leaves its bytes alone.
  const written = await readFile(join(root, "radius.lock"), "utf8");
  const again = fakeRegistry(UNSUPPORTED);
  const second = context(root);
  await runInit(second.context, flags(), again);
  assert.equal(again.calls.count, 0);
  assert.equal(await readFile(join(root, "radius.lock"), "utf8"), written);
  assert.match(second.text(), /already complete/);
});

test("--json carries the same note when the registry's version is passed over", async () => {
  const root = await project({ "README.md": "" });
  const run = context(root, "json");
  await runInit(
    run.context,
    flags({ harness: "opencode" }),
    fakeRegistry(UNSUPPORTED),
  );
  const result = run.json() as {
    data: { harness: { version: string }; notes: string[] };
  };
  assert.equal(result.data.harness.version, "1.19.4");
  assert.match(result.data.notes.join("\n"), /offers opencode 2\.2\.5/);
});

/** A project someone pinned to the registry's 2.x before Radius declared a range. */
async function pinnedToUnsupported(): Promise<string> {
  const root = await project(shopfloor);
  await runInit(context(root).context, flags(), fakeRegistry());
  const config = await readJson(join(root, "radius.json"));
  await writeFile(
    join(root, "radius.json"),
    JSON.stringify({ ...config, harness: `opencode@${UNSUPPORTED}` }),
    "utf8",
  );
  const lock = await readJson(join(root, "radius.lock"));
  const harness = lock.harness as Record<string, unknown>;
  await writeFile(
    join(root, "radius.lock"),
    `${JSON.stringify(
      { ...lock, harness: { ...harness, version: UNSUPPORTED } },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return root;
}

test("--force follows the same rule, moving an unsupported pin to a supported one", async () => {
  const root = await pinnedToUnsupported();
  const run = context(root);
  await runInit(run.context, flags({ force: true }), fakeRegistry(UNSUPPORTED));
  assert.equal(
    (await readJson(join(root, "radius.json"))).harness,
    "opencode@1.19.4",
  );
  const lock = await readJson(join(root, "radius.lock"));
  assert.equal((lock.harness as { version: string }).version, "1.19.4");
  assert.match(run.text(), /1\.19\.4 was pinned instead/);
  await loadConfigFile(root);
});

test("without --force an unsupported pin stays, and init says so", async () => {
  const root = await pinnedToUnsupported();
  const before = await readFile(join(root, "radius.lock"), "utf8");
  const run = context(root);
  const registry = fakeRegistry(UNSUPPORTED);
  await runInit(run.context, flags(), registry);

  assert.equal(registry.calls.count, 0);
  assert.equal(await readFile(join(root, "radius.lock"), "utf8"), before);
  assert.equal(
    (await readJson(join(root, "radius.json"))).harness,
    `opencode@${UNSUPPORTED}`,
  );
  assert.match(run.text(), /opencode 2\.2\.5 is not a version Radius supports/);
  assert.match(run.text(), /radius init --force/);
});

test("a lost lock for an unsupported pin is not rebuilt, even if the registry still serves it", async () => {
  const root = await pinnedToUnsupported();
  await writeFile(join(root, "radius.lock"), "{}", "utf8");
  await assert.rejects(
    () => runInit(context(root).context, flags(), fakeRegistry(UNSUPPORTED)),
    (error: Error & { nextAction?: string }) =>
      /pins opencode@2\.2\.5/.test(error.message) &&
      /would now pin 1\.19\.4/.test(error.message) &&
      /pin opencode@1\.19\.4/.test(error.nextAction ?? ""),
  );
});

function inlineConfig(version: string) {
  return JSON.stringify({
    agent: "agent_e8ef37424de7ded8",
    version: "0.0.0",
    name: "inline",
    runtime: {
      kind: "harness",
      registryId: "opencode",
      distribution: {
        kind: "binary",
        platforms: {
          "linux/arm64": {
            archive: `https://example.invalid/v${version}/opencode.tar.gz`,
            sha256: "3".repeat(64),
          },
        },
        cmd: "./opencode",
        args: ["acp"],
      },
    },
  });
}

test("an unsupported inline pin is reported, and --force does not carry it across", async () => {
  const root = await project({
    "README.md": "",
    "radius.json": inlineConfig(UNSUPPORTED),
  });

  const plain = context(root);
  await runInit(plain.context, flags(), fakeRegistry(UNSUPPORTED));
  assert.match(
    plain.text(),
    /opencode 2\.2\.5 is not a version Radius supports/,
  );
  assert.equal("harness" in (await readJson(join(root, "radius.json"))), false);

  const forced = context(root);
  await runInit(
    forced.context,
    flags({ force: true }),
    fakeRegistry(UNSUPPORTED),
  );
  const config = await readJson(join(root, "radius.json"));
  assert.equal(config.harness, "opencode@1.19.4");
  assert.match(forced.text(), /inline pin moved to opencode 1\.19\.4/);
  await loadConfigFile(root);
});

test("an inline runtime with no distribution yet is filled by the same rule", async () => {
  const root = await project({
    "README.md": "",
    "radius.json": JSON.stringify({
      agent: "agent_e8ef37424de7ded8",
      version: "0.0.0",
      name: "inline",
      runtime: { registryId: "opencode", include: ["README.md"] },
    }),
  });
  const run = context(root);
  await runInit(run.context, flags(), fakeRegistry(UNSUPPORTED));
  const config = await readJson(join(root, "radius.json"));
  const distribution = (
    config.runtime as { distribution: { platforms: Record<string, unknown> } }
  ).distribution;
  assert.deepEqual(
    distribution,
    HARNESS_SUPPORT.get("opencode")!.pinned!.distribution,
  );
  assert.match(run.text(), /1\.19\.4 was pinned instead/);
});

test("a harness with no declared range still pins whatever the registry offers", async () => {
  const root = await project({ "README.md": "" });
  const run = context(root);
  await runInit(
    run.context,
    flags({ harness: "goose" }),
    fakeRegistry(UNSUPPORTED),
  );
  assert.equal(
    (await readJson(join(root, "radius.json"))).harness,
    "goose@1.0.0",
  );
  assert.doesNotMatch(run.text(), /note:/);
});

test("--force re-pins to the registry's current version, keeping the agent", async () => {
  const root = await project(shopfloor);
  await runInit(context(root).context, flags(), fakeRegistry());
  const first = await readJson(join(root, "radius.json"));
  // A hand edit to an inferred field must survive --force.
  await writeFile(
    join(root, "radius.json"),
    JSON.stringify(
      { ...first, include: [...(first.include as string[]), "data/seed.sql"] },
      null,
      2,
    ),
    "utf8",
  );

  const run = context(root);
  await runInit(run.context, flags({ force: true }), fakeRegistry("1.20.0"));
  const config = await readJson(join(root, "radius.json"));
  assert.equal(config.harness, "opencode@1.20.0");
  assert.equal(config.agent, first.agent);
  assert.ok((config.include as string[]).includes("data/seed.sql"));
  const lock = await readJson(join(root, "radius.lock"));
  assert.equal((lock.harness as { version: string }).version, "1.20.0");
  await loadConfigFile(root);
});

test("switching harness needs --force", async () => {
  const root = await project({ "README.md": "" });
  await runInit(
    context(root).context,
    flags({ harness: "opencode" }),
    fakeRegistry(),
  );
  await assert.rejects(
    () =>
      runInit(
        context(root).context,
        flags({ harness: "goose" }),
        fakeRegistry(),
      ),
    /already pins opencode\. Pass --force/,
  );
});

test("an inline runtime is left alone, and --force moves it to the short form", async () => {
  const entry = registryEntry("1.19.4");
  const root = await project({
    ...shopfloor,
    "radius.json": JSON.stringify(
      {
        schemaVersion: 1,
        agent: "agent_e8ef37424de7ded8",
        version: "0.0.0",
        name: "shopfloor-agent",
        runtime: {
          kind: "harness",
          registryId: "opencode",
          distribution: {
            kind: "binary",
            platforms: {
              "linux/arm64": {
                archive: entry.distribution.binary["linux-aarch64"].archive,
                sha256: "3".repeat(64),
              },
            },
            cmd: "./opencode",
            args: ["acp"],
          },
          include: [".opencode/", "custom/"],
        },
      },
      null,
      2,
    ),
    "custom/x.txt": "",
  });

  // Without --force: a verbose config keeps working exactly as written, so
  // the only edits are the ones it was missing.
  const plain = context(root);
  const registry = fakeRegistry();
  await runInit(plain.context, flags(), registry);
  assert.equal(registry.calls.count, 0);
  assert.match(plain.text(), /pins its harness inline/);
  // The hand-written include does not ship uv.lock, so no python toolchain
  // is invented; the node one it does cover is filled into runtime.
  assert.match(plain.text(), /uv\.lock found, but include does not ship it/);
  const kept = await readJson(join(root, "radius.json"));
  assert.equal("harness" in kept, false);
  assert.deepEqual((kept.runtime as { toolchains: unknown }).toolchains, [
    { kind: "node", version: "22", lockfile: ".opencode/bun.lock" },
  ]);
  await loadConfigFile(root);

  // The registry has moved on; migrating must keep the inline pin rather
  // than upgrade it, and needs nothing from the registry to do so.
  const forced = context(root);
  const moved = fakeRegistry("2.2.0");
  await runInit(forced.context, flags({ force: true }), moved);
  assert.equal(moved.calls.count, 0);
  const config = await readJson(join(root, "radius.json"));
  assert.equal("runtime" in config, false);
  assert.equal(config.harness, "opencode@1.19.4");
  // Defaults the inline form wrote out are dropped; the lock keeps the
  // inline artifact byte for byte.
  assert.equal("schemaVersion" in config, false);
  const lock = await readJson(join(root, "radius.lock"));
  assert.deepEqual(
    (lock.harness as { distribution: { platforms: unknown } }).distribution
      .platforms,
    {
      "linux/arm64": {
        archive: entry.distribution.binary["linux-aarch64"].archive,
        sha256: "3".repeat(64),
      },
    },
  );
  assert.equal(config.agent, "agent_e8ef37424de7ded8");
  // What was in runtime moved across as it was, not re-inferred.
  assert.deepEqual(config.include, [".opencode/", "custom/"]);
  assert.deepEqual(config.toolchains, [
    { kind: "node", version: "22", lockfile: ".opencode/bun.lock" },
  ]);
  assert.match(forced.text(), /- runtime/);
  assert.match(forced.text(), /\+ include/);
  await loadConfigFile(root);
});

test("a Python version in .python-version wins over requires-python", async () => {
  const root = await project({ ...shopfloor, ".python-version": "3.13.1\n" });
  await runInit(context(root).context, flags(), fakeRegistry());
  const config = await readJson(join(root, "radius.json"));
  assert.ok((config.include as string[]).includes(".python-version"));
  assert.deepEqual((config.toolchains as unknown[])[0], {
    kind: "python",
    version: "3.13",
    lockfile: "uv.lock",
  });
});

test("a non-opencode harness gets nothing inferred", async () => {
  const root = await project({ "uv.lock": "", "pyproject.toml": "" });
  const run = context(root, "json");
  await runInit(run.context, flags({ harness: "goose" }), fakeRegistry());
  const config = await readJson(join(root, "radius.json"));
  assert.equal(config.harness, "goose@1.0.0");
  assert.equal("include" in config, false);
  const envelope = run.json() as {
    data: { inferred: unknown[]; lockUpdated: boolean };
  };
  assert.deepEqual(envelope.data.inferred, []);
  assert.equal(envelope.data.lockUpdated, true);
});

test("with nothing to detect and nobody to ask, init names the flag", async () => {
  const root = await project({ "README.md": "" });
  await assert.rejects(
    () => runInit(context(root).context, flags(), fakeRegistry()),
    /--harness <id>/,
  );
});

/** A Python LangGraph project the way `langgraph new` lays one out. */
const langgraphProject = {
  "langgraph.json": JSON.stringify({
    dependencies: ["."],
    graphs: {
      agent: "./src/agent/graph.py:graph",
      triage: { path: "agent.triage:graph", description: "Sorts tickets" },
    },
  }),
  "src/agent/graph.py": "",
  "pyproject.toml": '[project]\nname = "agent"\nversion = "0.1.0"\n',
  "uv.lock": "version = 1\n",
};

test("a Python langgraph.json becomes a langgraph runtime, with no registry and no lock", async () => {
  const root = await project(langgraphProject);
  const run = context(root);
  const registry = fakeRegistry();
  await runInit(run.context, flags(), registry);
  assert.equal(registry.calls.count, 0);

  const config = await readJson(join(root, "radius.json"));
  assert.deepEqual(Object.keys(config), [
    "$schema",
    "agent",
    "name",
    "version",
    "runtime",
  ]);
  assert.deepEqual(
    config.runtime,
    { kind: "langgraph" },
    "defaults are left to the schema",
  );
  await assert.rejects(readFile(join(root, "radius.lock"), "utf8"), {
    code: "ENOENT",
  });
  assert.match(
    run.text(),
    /^detected langgraph \(langgraph\.json: python graphs agent, triage\)$/m,
  );
  assert.match(
    await readFile(join(root, ".gitignore"), "utf8"),
    /^\.radius\/$/m,
  );

  const loaded = await loadConfigFile(root);
  assert.equal(loaded.config.runtime.kind, "langgraph");
  if (loaded.config.runtime.kind === "langgraph") {
    assert.equal(loaded.config.runtime.config, "langgraph.json");
    assert.equal(loaded.config.runtime.adapter, "radius-langgraph==0.0.1");
  }
});

test("a second langgraph init changes nothing and says so", async () => {
  const root = await project(langgraphProject);
  await runInit(context(root).context, flags(), fakeRegistry());
  const before = {
    config: await readFile(join(root, "radius.json"), "utf8"),
    ignore: await readFile(join(root, ".gitignore"), "utf8"),
  };

  const second = context(root);
  const registry = fakeRegistry();
  await runInit(second.context, flags(), registry);
  assert.equal(registry.calls.count, 0);
  assert.match(second.text(), /radius\.json is already complete/);
  assert.deepEqual(
    {
      config: await readFile(join(root, "radius.json"), "utf8"),
      ignore: await readFile(join(root, ".gitignore"), "utf8"),
    },
    before,
  );
});

test("a langgraph runtime already in radius.json is filled in, not replaced", async () => {
  const root = await project({
    ...langgraphProject,
    "radius.json": JSON.stringify({
      name: "Triage",
      runtime: { kind: "langgraph", graph: "triage" },
    }),
  });
  const run = context(root, "json");
  const registry = fakeRegistry();
  await runInit(run.context, flags(), registry);
  assert.equal(registry.calls.count, 0);
  const config = await readJson(join(root, "radius.json"));
  assert.equal(config.name, "Triage");
  assert.deepEqual(config.runtime, { kind: "langgraph", graph: "triage" });
  const envelope = run.json() as {
    data: { changed: string[]; detectedFrom?: string };
  };
  assert.deepEqual(envelope.data.changed, ["$schema", "agent", "version"]);
  assert.equal(envelope.data.detectedFrom, undefined);
});

test("--harness wins over a langgraph.json", async () => {
  const root = await project(langgraphProject);
  await runInit(
    context(root).context,
    flags({ harness: "opencode" }),
    fakeRegistry(),
  );
  const config = await readJson(join(root, "radius.json"));
  assert.equal(config.harness, "opencode@1.19.4");
  assert.equal("runtime" in config, false);
});

test("TypeScript graphs become a TypeScript langgraph runtime", async () => {
  const root = await project({
    "langgraph.json": JSON.stringify({
      graphs: { agent: "./src/agent.ts:graph", notes: "./src/notes.mjs" },
    }),
    "package-lock.json": "{}",
  });
  const run = context(root);
  const registry = fakeRegistry();
  await runInit(run.context, flags(), registry);
  assert.equal(registry.calls.count, 0);
  const config = await readJson(join(root, "radius.json"));
  assert.deepEqual(config.runtime, {
    kind: "langgraph",
    language: "typescript",
  });
  assert.match(
    run.text(),
    /^detected langgraph \(langgraph\.json: typescript graphs agent, notes\)$/m,
  );
  const loaded = await loadConfigFile(root);
  assert.equal(
    loaded.config.runtime.kind === "langgraph" &&
      loaded.config.runtime.language,
    "typescript",
  );
});

test("a langgraph.json mixing languages is not taken for a langgraph runtime", async () => {
  const root = await project({
    "langgraph.json": JSON.stringify({
      graphs: { agent: "./src/agent.ts:graph", triage: "./triage.py:graph" },
    }),
  });
  const run = context(root);
  const notes: string[] = [];
  (run.context as { note: (message: string) => void }).note = (message) =>
    notes.push(message);
  const registry = fakeRegistry();
  // The existing path takes over, and with nobody to ask it names the flag.
  await assert.rejects(
    () => runInit(run.context, flags(), registry),
    /--harness <id>/,
  );
  assert.equal(registry.calls.count, 0);
  assert.match(notes.join("\n"), /one language per project/);
});
