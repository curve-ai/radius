import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";

interface Manifest {
  name?: string;
  workspaces?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export function syncDatabaseChanges(
  root: string,
  base: string | undefined,
  head: string,
  mode: "pull_request" | "push",
): { required: boolean; reason: string } {
  try {
    if (!base || /^0+$/.test(base)) throw new Error("no previous commit");
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      if (result.error || result.status !== 0)
        throw new Error("Git comparison unavailable");
      return result.stdout.trimEnd();
    };
    const before = git(
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${base}^{commit}`,
    );
    const after = git(
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${head}^{commit}`,
    );
    // A PR uses its entire branch diff, not just the latest push. Otherwise a
    // docs-only follow-up could hide an earlier failing database change.
    const range = `${before}${mode === "pull_request" ? "..." : ".."}${after}`;
    const files = git("diff", "--name-only", "--no-renames", "-z", range, "--")
      .split("\0")
      .filter(Boolean);
    const manifest = (file: string): Manifest =>
      JSON.parse(readFileSync(path.join(root, file), "utf8"));
    const packages = new Map<
      string,
      { directory: string; manifest: Manifest }
    >();
    for (const workspace of manifest("package.json").workspaces ?? []) {
      for (const file of new Bun.Glob(`${workspace}/package.json`).scanSync({
        cwd: root,
        onlyFiles: true,
      })) {
        const data = manifest(file);
        if (data.name)
          packages.set(data.name, {
            directory: path.dirname(file).replaceAll("\\", "/"),
            manifest: data,
          });
      }
    }
    const api = [...packages.values()].find(
      (entry) => entry.directory === "apps/platform-api",
    );
    if (!api) throw new Error("API workspace unavailable");
    const affected = new Set<string>();
    const pending = [api];
    while (pending.length) {
      const entry = pending.pop()!;
      if (affected.has(entry.directory)) continue;
      affected.add(entry.directory);
      for (const name of Object.keys({
        ...entry.manifest.dependencies,
        ...entry.manifest.devDependencies,
        ...entry.manifest.optionalDependencies,
        ...entry.manifest.peerDependencies,
      })) {
        const dependency = packages.get(name);
        if (dependency) pending.push(dependency);
      }
    }
    for (const file of files) {
      const shared =
        /(^|\/)package\.json$/.test(file) ||
        /^(bun\.lockb?|bunfig\.toml|\.npmrc|\.bun-version|\.node-version|\.nvmrc|\.tool-versions|tsconfig[^/]*\.json)$/.test(
          file,
        ) ||
        file === ".github/workflows/ci.yml" ||
        file.startsWith(".github/actions/") ||
        file.startsWith("scripts/ci/") ||
        file.startsWith("hosting/");
      if (
        shared ||
        [...affected].some((directory) => file.startsWith(`${directory}/`))
      ) {
        return { required: true, reason: `affected input: ${file}` };
      }
    }
    return { required: false, reason: "no sync database inputs changed" };
  } catch {
    return {
      required: true,
      reason: "change detection unavailable; running database verification",
    };
  }
}

if (import.meta.main) {
  const result = syncDatabaseChanges(
    process.cwd(),
    process.env.CI_DIFF_BASE,
    process.env.CI_DIFF_HEAD || "HEAD",
    process.env.CI_DIFF_EVENT === "pull_request" ? "pull_request" : "push",
  );
  const output = `required=${result.required}\n`;
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, output);
  console.info(`${output.trim()} (${result.reason})`);
}
