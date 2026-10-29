import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { HarnessToolchain } from "@curve-ai/agent-contracts";
import { parse as parseToml } from "smol-toml";

/**
 * What `init` can tell about a project by looking at it.
 *
 * Every inference carries the reason it was made, because `init` prints it:
 * a developer should be able to read the output and know why each path is in
 * `include` without opening this file. Conservative by design — an entry
 * that was not needed costs a few bytes in the image, but a guess that is
 * wrong ships something nobody meant to ship, so only well-known names are
 * picked up and nothing is read beyond a manifest's version field.
 */
export interface Inferred<T> {
  readonly value: T;
  readonly reason: string;
}

export interface ProjectDetection {
  /** Set only when exactly one harness is evident from the tree. */
  readonly harness?: Inferred<string>;
  readonly include: readonly Inferred<string>[];
  readonly toolchains: readonly Inferred<HarnessToolchain>[];
  /** Things noticed and deliberately not inferred, with why. */
  readonly notes: readonly string[];
}

export async function detectProject(
  root: string,
  harnessId: string | undefined,
): Promise<ProjectDetection> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const dirs = new Set(
    entries.filter((e) => e.isDirectory()).map((e) => e.name),
  );

  const opencodeConfigs = [...files]
    .filter((name) => /^opencode[^/]*\.jsonc?$/.test(name))
    .sort((a, b) =>
      // The canonical file first, variants after it in name order.
      isCanonicalOpencode(a) === isCanonicalOpencode(b)
        ? a.localeCompare(b)
        : isCanonicalOpencode(a)
          ? -1
          : 1,
    );
  const hasOpencode = dirs.has(".opencode") || opencodeConfigs.length > 0;

  const harness: Inferred<string> | undefined = hasOpencode
    ? {
        value: "opencode",
        reason: opencodeConfigs.includes("opencode.json")
          ? "opencode.json"
          : dirs.has(".opencode")
            ? ".opencode/"
            : opencodeConfigs[0]!,
      }
    : undefined;

  const include: Inferred<string>[] = [];
  const toolchains: Inferred<HarnessToolchain>[] = [];
  const notes: string[] = [];
  const add = (value: string, reason: string): void => {
    if (!include.some((entry) => entry.value === value)) {
      include.push({ value, reason });
    }
  };

  // Only opencode's layout is known well enough to infer from. Another
  // harness gets no include at all, which is the schema's own default and
  // means "the harness is the whole agent".
  if ((harnessId ?? harness?.value) !== "opencode") {
    return { harness, include, toolchains, notes };
  }

  if (dirs.has(".opencode")) {
    add(".opencode/", "opencode's agents, tools, skills and plugins");
  }
  for (const name of opencodeConfigs) {
    add(
      name,
      isCanonicalOpencode(name)
        ? "opencode's config"
        : "an opencode config variant (selected with env OPENCODE_CONFIG)",
    );
  }
  if (files.has("AGENTS.md")) {
    add("AGENTS.md", "instructions opencode loads into every session");
  }

  if (files.has("uv.lock")) {
    if (files.has("pyproject.toml")) {
      add("pyproject.toml", "the Python project uv.lock installs");
    }
    add("uv.lock", "the Python toolchain installs from it");
    if (files.has(".python-version")) {
      add(".python-version", "uv reads the interpreter version from it");
    }
    // The usual opencode-plus-Python shape: tools are thin wrappers that
    // shell out to code beside pyproject.toml. These two names are the only
    // ones assumed; anything else is the developer's to add.
    if (files.has("pyproject.toml")) {
      for (const dir of ["src", "scripts"]) {
        if (dirs.has(dir))
          add(`${dir}/`, "Python sources beside pyproject.toml");
      }
    }
    const python = await pythonVersion(root, files);
    if (python) {
      toolchains.push({
        value: { kind: "python", version: python.version, lockfile: "uv.lock" },
        reason: `python ${python.version} from uv.lock (version from ${python.source})`,
      });
    } else {
      notes.push(
        "uv.lock found, but no Python version in .python-version or requires-python; add the python toolchain by hand.",
      );
    }
  }

  if (dirs.has(".opencode")) {
    // bun.lock first: the image installs with `bun install --frozen-lockfile`.
    const lockfile = await firstExisting(root, [
      ".opencode/bun.lock",
      ".opencode/package-lock.json",
    ]);
    if (lockfile) {
      toolchains.push({
        value: { kind: "node", version: "22", lockfile },
        reason: `node 22 from ${lockfile} (opencode's plugin dependencies)`,
      });
    }
  }

  return { harness, include, toolchains, notes };
}

function isCanonicalOpencode(name: string): boolean {
  return name === "opencode.json" || name === "opencode.jsonc";
}

async function firstExisting(
  root: string,
  candidates: readonly string[],
): Promise<string | undefined> {
  for (const candidate of candidates) {
    const info = await stat(join(root, candidate)).catch(() => null);
    if (info?.isFile()) return candidate;
  }
  return undefined;
}

/**
 * `major.minor`, from the same places uv looks: `.python-version` first, then
 * the floor of `requires-python`. A floor is the version the project was
 * written against, which is the safest one to install.
 */
async function pythonVersion(
  root: string,
  files: ReadonlySet<string>,
): Promise<{ version: string; source: string } | undefined> {
  if (files.has(".python-version")) {
    const text = await readFile(join(root, ".python-version"), "utf8");
    const match = /^\s*(?:cpython-)?(3\.\d+)/m.exec(text);
    if (match) return { version: match[1]!, source: ".python-version" };
  }
  if (files.has("pyproject.toml")) {
    try {
      const pyproject = parseToml(
        await readFile(join(root, "pyproject.toml"), "utf8"),
      ) as { project?: { "requires-python"?: unknown } };
      const requires = pyproject.project?.["requires-python"];
      const match =
        typeof requires === "string" ? /(3\.\d+)/.exec(requires) : null;
      if (match) {
        return {
          version: match[1]!,
          source: "requires-python in pyproject.toml",
        };
      }
    } catch {
      // An unparseable pyproject is uv's problem to report, not init's.
    }
  }
  return undefined;
}
