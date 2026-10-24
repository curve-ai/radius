import { appendFile, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  applyConfigEdits,
  CONFIG_FILENAME,
  CONFIG_SCHEMA_URL,
  mintAgentId,
  readRawConfig,
} from "../../config.js";
import { emitJson, type RadiusContext } from "../../context.js";
import { handler } from "../../handler.js";
import { UsageError } from "../../errors.js";
import { fetchRegistry, listHarnessIds, selectEntry } from "../../registry.js";

interface InitFlags {
  readonly harness?: string;
  readonly name?: string;
  readonly list: boolean;
}

async function run(
  this: RadiusContext,
  flags: InitFlags,
): Promise<void> {
  const context = this;
  const registry = await fetchRegistry();

  if (flags.list) {
    const ids = listHarnessIds(registry);
    if (context.output === "json") {
      emitJson(context, { harnesses: ids });
      return;
    }
    context.out(`${ids.length} harnesses in the ACP registry:\n`);
    for (const id of ids) context.out(`  ${id}`);
    return;
  }

  if (!flags.harness) {
    throw new UsageError(
      "radius init needs --harness <id>. Run `radius init --list` to see the available ids.",
    );
  }

  const entry = selectEntry(registry, flags.harness);
  const root = context.cwd;
  const existed = (await readRawConfig(root)) !== null;

  // Order matters only for readability of a freshly written file; every edit
  // is skipped individually if that key is already present.
  const changed = await applyConfigEdits(root, [
    { path: ["$schema"], value: CONFIG_SCHEMA_URL },
    { path: ["schemaVersion"], value: 1 },
    { path: ["agent"], value: mintAgentId() },
    { path: ["version"], value: "0.0.0" },
    { path: ["name"], value: flags.name ?? entry.name },
    // One edit per leaf, not one for the whole `runtime` block. Idempotent
    // fill-in means filling what is *missing*, and a project that already
    // declares `runtime.include` or `runtime.toolchains` has a runtime block
    // without a harness pin in it — writing at ["runtime"] would see the
    // block, skip, and leave the config permanently unbuildable.
    { path: ["runtime", "kind"], value: "harness" },
    { path: ["runtime", "registryId"], value: entry.id },
    { path: ["runtime", "distribution"], value: entry.distribution },
    ...(entry.license
      ? [{ path: ["runtime", "license"], value: entry.license }]
      : []),
    ...(entry.licenseUrl
      ? [{ path: ["runtime", "licenseUrl"], value: entry.licenseUrl }]
      : []),
    { path: ["capabilities"], value: [] },
    { path: ["networkAllowlist"], value: [] },
    { path: ["resources"], value: { cpu: 2, memoryMb: 4096, diskMb: 5120 } },
  ]);

  const ignored = await ensureGitignore(root);

  if (context.output === "json") {
    emitJson(context, {
      configPath: join(root, CONFIG_FILENAME),
      created: !existed,
      changed,
      harness: { id: entry.id, version: entry.version },
      gitignoreUpdated: ignored,
    });
    return;
  }

  if (changed.length === 0 && !ignored) {
    context.out(`${CONFIG_FILENAME} is already complete — nothing to do.`);
    return;
  }
  context.out(
    `${existed ? "Updated" : "Created"} ${CONFIG_FILENAME} for ${entry.name} ${entry.version}.`,
  );
  for (const key of changed) context.out(`  + ${key}`);
  if (ignored) context.out("  + .gitignore (.radius/)");
  context.out("\nNext: `radius dev` to run it against the Radius desktop app.");
}

/** The one foreign file init touches directly, and only ever by appending. */
async function ensureGitignore(root: string): Promise<boolean> {
  const path = join(root, ".gitignore");
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (current.split("\n").some((line) => line.trim() === ".radius/")) {
    return false;
  }
  await appendFile(path, current && !current.endsWith("\n") ? "\n.radius/\n" : ".radius/\n");
  return true;
}

export default handler<InitFlags, []>(run);
