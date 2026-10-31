import { appendFile, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  HarnessPinSchema,
  parseHarnessPin,
  type HarnessToolchain,
  type RadiusLock,
} from "@curve-ai/agent-contracts";
import { parse, type ParseError } from "jsonc-parser";

import {
  applyConfigEdits,
  CONFIG_FILENAME,
  CONFIG_SCHEMA_URL,
  HARNESS_PROJECT_FIELDS,
  mintAgentId,
  readRawConfig,
  type ConfigEdit,
} from "../../config.js";
import { emitJson, type RadiusContext } from "../../context.js";
import { handler } from "../../handler.js";
import { OperationalError, UsageError } from "../../errors.js";
import {
  LOCK_FILENAME,
  lockFromEntry,
  lockFromInline,
  lockPath,
  parseLock,
  readRawLock,
  renderLock,
} from "../../lock.js";
import {
  canPrompt,
  promptChoice,
  promptText,
  requireFlag,
} from "../../prompt.js";
import { fetchRegistry, listHarnessIds, selectEntry } from "../../registry.js";
import {
  detectLanggraph,
  detectProject,
  type Inferred,
  type LanggraphDetection,
} from "./detect.js";

export interface InitFlags {
  readonly harness?: string;
  readonly name?: string;
  readonly list: boolean;
  readonly yes: boolean;
  readonly force: boolean;
}

export interface InitDependencies {
  /** The ACP registry document. A parameter so tests never touch the network. */
  readonly registry: () => Promise<unknown>;
}

export async function runInit(
  context: RadiusContext,
  flags: InitFlags,
  dependencies: InitDependencies = { registry: fetchRegistry },
): Promise<void> {
  // Fetched at most once, and only when something needs it. A project whose
  // pin and lock already agree re-runs `init` offline.
  let registryDocument: Promise<unknown> | undefined;
  const registry = (): Promise<unknown> =>
    (registryDocument ??= dependencies.registry());

  if (flags.list) {
    const ids = listHarnessIds(await registry());
    if (context.output === "json") {
      emitJson(context, { harnesses: ids });
      return;
    }
    context.out(`${ids.length} harnesses in the ACP registry:\n`);
    for (const id of ids) context.out(`  ${id}`);
    return;
  }

  const root = context.cwd;
  const raw = await readRawConfig(root);
  const existing = raw === null ? {} : parseExisting(raw);
  const existed = raw !== null;

  const langgraph = await chooseLanggraph(context, root, existing, flags);
  if (langgraph) {
    await initLanggraph(context, flags, root, existing, existed, langgraph);
    return;
  }

  // `runtime` written out inline is the form `init` produced before the lock
  // existed. It keeps working as it is; `--force` is the explicit request to
  // move it to the short form.
  const inline = isRecord(existing.runtime);
  const runtimeBlock = isRecord(existing.runtime) ? existing.runtime : {};
  const migrate = inline && flags.force;
  const shortForm = !inline || migrate;

  const pin = readPin(existing.harness);
  const inlineId =
    typeof runtimeBlock.registryId === "string"
      ? runtimeBlock.registryId
      : undefined;
  const pinnedId = pin?.id ?? inlineId;
  if (flags.harness && pinnedId && flags.harness !== pinnedId && !flags.force) {
    throw new UsageError(
      `${CONFIG_FILENAME} already pins ${pinnedId}. Pass --force to switch it to ${flags.harness}.`,
    );
  }

  // Detection runs before the harness is chosen so an opencode tree needs no
  // flag and no prompt: the files say which harness it is.
  const preliminary = await detectProject(root, flags.harness ?? pinnedId);
  const known = flags.harness ?? pinnedId ?? preliminary.harness?.value;
  let harnessId = known;
  const detectedHarness =
    !flags.harness && !pinnedId ? preliminary.harness : undefined;
  if (!harnessId) {
    if (!canPrompt(context, flags)) {
      requireFlag(
        "--harness <id>",
        "Run `radius init --list` to see the available ids.",
      );
    }
    harnessId = await promptChoice(context, {
      label: "Harness",
      choices: listHarnessIds(await registry()).map((id) => ({ value: id })),
    });
  }
  const detection =
    harnessId === known ? preliminary : await detectProject(root, harnessId);

  // The registry's name is the harness's, not the project's, so every
  // opencode project would be called "OpenCode" and two of them would be
  // indistinguishable in the agent list. The directory is at least the
  // developer's own word for this thing.
  let name = flags.name;
  if (!name && typeof existing.name !== "string") {
    const suggestion = basename(root) || harnessId;
    name = canPrompt(context, flags)
      ? await promptText(context, { label: "Agent name", fallback: suggestion })
      : suggestion;
  }

  const edits: ConfigEdit[] = [
    { path: ["$schema"], value: CONFIG_SCHEMA_URL },
    { path: ["agent"], value: mintAgentId() },
    { path: ["name"], value: name },
    { path: ["version"], value: "0.0.0" },
  ];

  // The pin. In the short form it is one line in radius.json and the machine
  // data in radius.lock, and the two must name the same id@version.
  let lock: RadiusLock | undefined;
  let lockText: string | undefined;
  const pinNotes: string[] = [];
  if (shortForm) {
    const currentLock = await readCurrentLock(root);
    const wantedId = harnessId;
    const lockAgrees =
      pin !== undefined &&
      currentLock !== undefined &&
      currentLock.harness.registryId === pin.id &&
      currentLock.harness.version === pin.version &&
      pin.id === wantedId;
    const inlineLock =
      migrate && inlineId === wantedId
        ? lockFromInline(runtimeBlock)
        : undefined;
    if (lockAgrees && !flags.force) {
      lock = currentLock;
    } else if (inlineLock) {
      // Migrating moves the pin; it does not upgrade it. Re-pinning to the
      // registry's latest is a separate `--force` once the lock exists.
      lock = inlineLock;
    } else {
      const entry = selectEntry(await registry(), wantedId);
      // Without --force, a pin is a promise not to move. The registry only
      // serves its latest version, so a lost lock for an older pin cannot be
      // rebuilt from it — and quietly moving the pin would be an upgrade
      // nobody asked for.
      if (
        pin &&
        pin.id === wantedId &&
        pin.version !== entry.version &&
        !flags.force
      ) {
        throw new OperationalError(
          `${CONFIG_FILENAME} pins ${pin.id}@${pin.version}, and ${LOCK_FILENAME} ${currentLock ? "does not match it" : "is missing"}. The ACP registry now offers ${entry.version}, so the old pin cannot be re-read from it.`,
          `Restore ${LOCK_FILENAME} from version control, or run \`radius init --force\` to pin ${entry.id}@${entry.version}.`,
        );
      }
      lock = lockFromEntry(entry);
      // The inline form never recorded a version, so the registry's current
      // entry is the only source for the lock. Say so when that moved the pin.
      if (
        migrate &&
        runtimeBlock.distribution !== undefined &&
        JSON.stringify(runtimeBlock.distribution) !==
          JSON.stringify(entry.distribution)
      ) {
        pinNotes.push(
          `the inline pin names no version Radius can read back, so ${LOCK_FILENAME} now holds the registry's current ${entry.id} ${entry.version}.`,
        );
      }
    }
    lockText = renderLock(lock);
    const pinValue = `${lock.harness.registryId}@${lock.harness.version}`;
    edits.push({ path: ["harness"], value: pinValue, replace: flags.force });
  } else if (runtimeBlock.distribution === undefined) {
    // An inline runtime block without a distribution — someone wrote
    // `runtime.include` first. Filled leaf by leaf, as before the lock, so
    // nothing they wrote is moved.
    const entry = selectEntry(await registry(), harnessId);
    edits.push(
      { path: ["runtime", "kind"], value: "harness" },
      { path: ["runtime", "registryId"], value: entry.id },
      { path: ["runtime", "distribution"], value: entry.distribution },
      { path: ["runtime", "license"], value: entry.license },
      { path: ["runtime", "licenseUrl"], value: entry.licenseUrl },
    );
  }

  // Where the person-written harness fields live: top level beside
  // `harness`, or inside an inline `runtime`.
  const fieldsAt = shortForm ? [] : ["runtime"];
  if (migrate) {
    // Carried across as written, ahead of anything inferred, so a hand-made
    // include survives the move.
    for (const field of HARNESS_PROJECT_FIELDS) {
      if (runtimeBlock[field] !== undefined) {
        edits.push({ path: [field], value: runtimeBlock[field] });
      }
    }
    edits.push({ path: ["runtime"], value: undefined, replace: true });
    // The inline form wrote every default out. Loading fills them in again,
    // so the short form drops the ones that say nothing.
    for (const [field, value] of Object.entries(CONFIG_DEFAULTS)) {
      if (JSON.stringify(existing[field]) === JSON.stringify(value)) {
        edits.push({ path: [field], value: undefined, replace: true });
      }
    }
  }

  // Inferred fields are only ever filled, never replaced — not even by
  // --force. A developer who edited `include` meant it; deleting the key and
  // re-running is how to ask for detection again.
  const declaredInclude = readStrings(
    migrate ? runtimeBlock.include : valueIn(existing, fieldsAt, "include"),
  );
  const declaredToolchains = migrate
    ? runtimeBlock.toolchains
    : valueIn(existing, fieldsAt, "toolchains");
  const inferredInclude =
    declaredInclude === undefined && detection.include.length > 0
      ? detection.include
      : [];
  const effectiveInclude =
    declaredInclude ?? inferredInclude.map((entry) => entry.value);
  const notes = [...pinNotes, ...detection.notes];
  const inferredToolchains: Inferred<HarnessToolchain>[] = [];
  if (declaredToolchains === undefined) {
    for (const toolchain of detection.toolchains) {
      // A toolchain whose lockfile is not shipped fails validation, so one
      // that the developer's own include leaves out is reported, not written.
      if (covers(effectiveInclude, toolchain.value.lockfile)) {
        inferredToolchains.push(toolchain);
      } else {
        notes.push(
          `${toolchain.value.lockfile} found, but include does not ship it, so no ${toolchain.value.kind} toolchain was added.`,
        );
      }
    }
  }
  const includeKey = [...fieldsAt, "include"].join(".");
  const toolchainsKey = [...fieldsAt, "toolchains"].join(".");
  if (inferredInclude.length > 0) {
    edits.push({
      path: [...fieldsAt, "include"],
      value: inferredInclude.map((entry) => entry.value),
    });
  }
  if (inferredToolchains.length > 0) {
    edits.push({
      path: [...fieldsAt, "toolchains"],
      value: inferredToolchains.map((entry) => entry.value),
    });
  }

  const changed = await applyConfigEdits(root, edits);
  // Inferred keys are listed with their reasons below, not as bare `+ key`.
  const inferredKeys = new Set([
    ...(inferredInclude.length > 0 ? [includeKey] : []),
    ...(inferredToolchains.length > 0 ? [toolchainsKey] : []),
  ]);

  let lockUpdated = false;
  if (lockText !== undefined && (await readRawLock(root)) !== lockText) {
    await writeFile(lockPath(root), lockText, "utf8");
    lockUpdated = true;
  }

  const ignored = await ensureGitignore(root);

  const inferred = [
    ...(inferredKeys.has(includeKey) && changed.includes(includeKey)
      ? inferredInclude.map((entry) => ({ field: "include", ...entry }))
      : []),
    ...(inferredKeys.has(toolchainsKey) && changed.includes(toolchainsKey)
      ? inferredToolchains.map((entry) => ({ field: "toolchains", ...entry }))
      : []),
  ];

  if (context.output === "json") {
    emitJson(context, {
      configPath: join(root, CONFIG_FILENAME),
      created: !existed,
      changed,
      harness: lock
        ? { id: lock.harness.registryId, version: lock.harness.version }
        : { id: harnessId },
      ...(lock ? { lockPath: lockPath(root), lockUpdated } : {}),
      ...(detectedHarness ? { detectedFrom: detectedHarness.reason } : {}),
      inferred,
      notes,
      gitignoreUpdated: ignored,
    });
    return;
  }

  if (detectedHarness) {
    context.out(
      `detected ${detectedHarness.value} (${detectedHarness.reason})`,
    );
  }
  if (changed.length === 0 && !lockUpdated && !ignored) {
    context.out(
      `${lock ? `${CONFIG_FILENAME} and ${LOCK_FILENAME} are` : `${CONFIG_FILENAME} is`} already complete — nothing to do.`,
    );
    for (const note of notes) context.out(`note: ${note}`);
    if (inline) context.out(inlineHint);
    return;
  }

  const reported = changed.filter((key) => !inferredKeys.has(key));
  // Removal is an edit that replaces a top-level key with nothing.
  const removed = new Set(
    edits
      .filter((edit) => edit.replace && edit.value === undefined)
      .map((edit) => edit.path[0]),
  );
  if (reported.length > 0) {
    context.out(`${existed ? "Updated" : "Created"} ${CONFIG_FILENAME}.`);
    for (const key of reported) {
      context.out(`  ${removed.has(key) ? "-" : "+"} ${key}`);
    }
  }
  if (lock && lockUpdated) context.out(describePin(lock));
  if (inferred.length > 0) {
    context.out("inferred from the project:");
    const width = Math.max(...inferred.map((entry) => label(entry).length));
    let previous: string | undefined;
    for (const entry of inferred) {
      const field = entry.field === previous ? "" : entry.field;
      previous = entry.field;
      context.out(
        `  ${field.padEnd(10)} ${label(entry).padEnd(width)}  ${entry.reason}`,
      );
    }
  }
  for (const note of notes) context.out(`note: ${note}`);
  if (ignored) context.out("  + .gitignore (.radius/)");
  if (inline && !migrate) context.out(inlineHint);
  context.out("\nNext: `radius dev` to run it against the Radius desktop app.");
}

/**
 * Whether this run sets up a LangGraph runtime instead of a harness, and if
 * it was detected just now, from which graphs.
 *
 * Only an untouched project is detected: a `--harness` flag or a pin already
 * in `radius.json` is the developer's choice, and a `langgraph.json` beside
 * it does not overrule that. opencode files win over `langgraph.json` for the
 * same reason `radius check` reads them first.
 */
async function chooseLanggraph(
  context: RadiusContext,
  root: string,
  existing: Record<string, unknown>,
  flags: InitFlags,
): Promise<{ detected?: LanggraphDetection } | undefined> {
  if (isRecord(existing.runtime) && existing.runtime.kind === "langgraph") {
    if (flags.harness) {
      throw new UsageError(
        `${CONFIG_FILENAME} declares a langgraph runtime. Remove \`runtime\` from it to switch to the ${flags.harness} harness.`,
      );
    }
    return {};
  }
  if (
    flags.harness ||
    existing.runtime !== undefined ||
    existing.harness !== undefined
  ) {
    return undefined;
  }
  const detected = await detectLanggraph(root);
  if (!detected || (await detectProject(root, undefined)).harness) {
    return undefined;
  }
  if (detected.language === "other") {
    // Said before falling through, because the harness path that follows
    // may stop to ask for --harness, and the developer should know why
    // their langgraph.json was not enough.
    context.note(
      "langgraph.json found, but its graphs are not all Python or all JavaScript/TypeScript. Radius serves one language per project, so it was not set up as a langgraph runtime.",
    );
    return undefined;
  }
  return { detected };
}

async function initLanggraph(
  context: RadiusContext,
  flags: InitFlags,
  root: string,
  existing: Record<string, unknown>,
  existed: boolean,
  { detected }: { detected?: LanggraphDetection },
): Promise<void> {
  let name = flags.name;
  if (!name && typeof existing.name !== "string") {
    const suggestion = basename(root) || "langgraph";
    name = canPrompt(context, flags)
      ? await promptText(context, { label: "Agent name", fallback: suggestion })
      : suggestion;
  }

  // No registry and no lock: the adapter is pinned by the CLI's own
  // defaults, so there is nothing to fetch and nothing to record. Only the
  // kind is written, and the language when it is not the default. Every
  // other field defaults to the layout `langgraph.json` already describes,
  // and a default written out is one more line that goes stale when the
  // default moves.
  const runtime =
    detected?.language === "typescript"
      ? { kind: "langgraph", language: "typescript" }
      : { kind: "langgraph" };
  const changed = await applyConfigEdits(root, [
    { path: ["$schema"], value: CONFIG_SCHEMA_URL },
    { path: ["agent"], value: mintAgentId() },
    { path: ["name"], value: name },
    { path: ["version"], value: "0.0.0" },
    { path: ["runtime"], value: runtime },
  ]);
  const ignored = await ensureGitignore(root);
  const reason = detected
    ? `langgraph.json: ${detected.language} graph${detected.graphs.length === 1 ? "" : "s"} ${detected.graphs.join(", ")}`
    : undefined;

  if (context.output === "json") {
    emitJson(context, {
      configPath: join(root, CONFIG_FILENAME),
      created: !existed,
      changed,
      runtime,
      ...(reason ? { detectedFrom: reason } : {}),
      inferred: [],
      notes: [],
      gitignoreUpdated: ignored,
    });
    return;
  }

  if (reason) context.out(`detected langgraph (${reason})`);
  if (changed.length === 0 && !ignored) {
    context.out(`${CONFIG_FILENAME} is already complete — nothing to do.`);
    return;
  }
  if (changed.length > 0) {
    context.out(`${existed ? "Updated" : "Created"} ${CONFIG_FILENAME}.`);
    for (const key of changed) context.out(`  + ${key}`);
  }
  if (ignored) context.out("  + .gitignore (.radius/)");
  context.out(
    "\nNext: `radius check` to confirm the graphs load, then `radius dev` to run them against the Radius desktop app.",
  );
}

/** What the schema fills in when a field is absent. */
const CONFIG_DEFAULTS: Readonly<Record<string, unknown>> = {
  schemaVersion: 1,
  capabilities: [],
  networkAllowlist: [],
  resources: { cpu: 2, memoryMb: 4096, diskMb: 5120 },
};

const inlineHint = `${CONFIG_FILENAME} pins its harness inline. \`radius init --force\` moves the pin into ${LOCK_FILENAME}.`;

function label(entry: {
  field: string;
  value: string | HarnessToolchain;
}): string {
  return typeof entry.value === "string"
    ? entry.value
    : `${entry.value.kind} ${entry.value.version}`;
}

/** e.g. `pinned opencode 1.19.4 for 6 platforms (sha256 verified at install) → radius.lock`. */
function describePin(lock: RadiusLock): string {
  const { registryId, version, distribution } = lock.harness;
  if (distribution.kind !== "binary") {
    return `pinned ${registryId} ${version} (${distribution.kind} ${distribution.package}) → ${LOCK_FILENAME}`;
  }
  const platforms = Object.values(distribution.platforms);
  const digested = platforms.filter((artifact) => artifact.sha256).length;
  const verification =
    digested === platforms.length
      ? "sha256 verified at install"
      : `sha256 verified at install for ${digested}`;
  return `pinned ${registryId} ${version} for ${platforms.length} platform${platforms.length === 1 ? "" : "s"} (${verification}) → ${LOCK_FILENAME}`;
}

function parseExisting(raw: string): Record<string, unknown> & {
  runtime?: unknown;
  harness?: unknown;
  name?: unknown;
} {
  const errors: ParseError[] = [];
  const parsed: unknown = parse(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0 || !isRecord(parsed)) {
    throw new UsageError(
      `${CONFIG_FILENAME} is not a valid JSON object, so init cannot fill it in without risking what is there.`,
    );
  }
  if ("harness" in parsed && "runtime" in parsed) {
    throw new UsageError(
      `${CONFIG_FILENAME} has both \`harness\` and \`runtime\`. Keep one: \`harness\` pins through ${LOCK_FILENAME}, \`runtime\` pins inline.`,
    );
  }
  return parsed;
}

function readPin(value: unknown): { id: string; version: string } | undefined {
  if (value === undefined) return undefined;
  const result = HarnessPinSchema.safeParse(value);
  if (!result.success) {
    throw new UsageError(
      `${CONFIG_FILENAME}: harness: ${result.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  return parseHarnessPin(result.data);
}

/** A lock `init` can trust, or nothing — a broken lock is regenerated. */
async function readCurrentLock(root: string): Promise<RadiusLock | undefined> {
  const raw = await readRawLock(root);
  if (raw === null) return undefined;
  const parsed = parseLock(raw);
  return "lock" in parsed ? parsed.lock : undefined;
}

function valueIn(
  source: Record<string, unknown>,
  prefix: readonly string[],
  key: string,
): unknown {
  let cursor: unknown = source;
  for (const segment of [...prefix, key]) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function readStrings(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** The schema's own coverage rule, applied before writing rather than after. */
function covers(include: readonly string[], path: string): boolean {
  return include.some((entry) =>
    entry.endsWith("/") ? path.startsWith(entry) : path === entry,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  await appendFile(
    path,
    current && !current.endsWith("\n") ? "\n.radius/\n" : ".radius/\n",
  );
  return true;
}

async function run(this: RadiusContext, flags: InitFlags): Promise<void> {
  await runInit(this, flags);
}

export default handler<InitFlags, []>(run);
