/**
 * The project's own copies of the LangGraph and LangChain packages.
 *
 * The graph comes from the user's module, so it was built with whatever
 * `@langchain/langgraph` the project installed. The few values the adapter
 * constructs itself (a `Command` to resume, the messages it sends in, a
 * `MemorySaver`) must come from that same copy: a second copy loaded next to
 * the adapter would pass every type check and still fail the identity and
 * `instanceof` checks LangGraph and LangChain make at runtime.
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export class ProjectPackageError extends Error {
  override name = "ProjectPackageError";
}

/** The parts of the project's LangGraph and LangChain the adapter uses. */
export interface ProjectLibraries {
  readonly Command: new (fields: { resume?: unknown }) => unknown;
  readonly MemorySaver: new () => unknown;
  readonly HumanMessage: new (fields: { content: string }) => unknown;
  readonly ToolMessage: new (fields: {
    content: string;
    tool_call_id: string;
    name?: string;
    status?: "success" | "error";
  }) => unknown;
  /** The serializer the project's checkpoints are written with, if found. */
  readonly serializer?: unknown;
}

export async function loadProjectLibraries(
  root: string,
): Promise<ProjectLibraries> {
  const langgraphEntry = resolvePackage(root, "@langchain/langgraph");
  const langgraph = await import(pathToFileURL(langgraphEntry).href);
  const messages = await import(
    pathToFileURL(resolvePackage(root, "@langchain/core/messages")).href
  );
  // A dependency of `@langchain/langgraph` rather than of the project, so it
  // is looked up from there: a strict installer does not hoist it.
  let serializer: unknown;
  try {
    const checkpoint = await import(
      pathToFileURL(
        resolvePackage(
          dirname(langgraphEntry),
          "@langchain/langgraph-checkpoint",
        ),
      ).href
    );
    if (typeof checkpoint.JsonPlusSerializer === "function") {
      serializer = new checkpoint.JsonPlusSerializer();
    }
  } catch {
    serializer = undefined;
  }
  return {
    Command: langgraph.Command,
    MemorySaver: langgraph.MemorySaver,
    HumanMessage: messages.HumanMessage,
    ToolMessage: messages.ToolMessage,
    ...(serializer ? { serializer } : {}),
  };
}

/**
 * Resolves a bare specifier to the file an ESM `import` from `fromDirectory`
 * would load.
 *
 * Node resolves an import against the importing file, and the only importer
 * it offers is the adapter itself; `import.meta.resolve` takes a parent only
 * behind a flag, and `createRequire` follows the `require` condition, which
 * for these dual packages is a different module instance. So the lookup is
 * done here: walk up `node_modules` the way Node does, then read the
 * package's `exports` with the `import` conditions.
 */
export function resolvePackage(
  fromDirectory: string,
  specifier: string,
): string {
  const parts = specifier.split("/");
  const nameLength = specifier.startsWith("@") ? 2 : 1;
  const name = parts.slice(0, nameLength).join("/");
  const subpath = ["." as string, ...parts.slice(nameLength)].join("/");

  for (
    let directory = resolve(fromDirectory);
    ;
    directory = dirname(directory)
  ) {
    const packageDirectory = join(directory, "node_modules", name);
    const manifestPath = join(packageDirectory, "package.json");
    if (isFile(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const target = exportTarget(manifest, subpath);
      if (!target) {
        throw new ProjectPackageError(
          `${name} does not export "${subpath}" for import`,
        );
      }
      return join(packageDirectory, target);
    }
    if (dirname(directory) === directory) break;
  }
  throw new ProjectPackageError(
    `cannot find ${name} from ${fromDirectory}; install it in the project`,
  );
}

const CONDITIONS = new Set(["node", "import", "default"]);

function exportTarget(
  manifest: Record<string, unknown>,
  subpath: string,
): string | undefined {
  const exports = manifest.exports;
  if (exports === undefined) {
    if (subpath !== ".") return subpath;
    const main =
      typeof manifest.module === "string"
        ? manifest.module
        : typeof manifest.main === "string"
          ? manifest.main
          : "index.js";
    return main;
  }
  const isSubpathMap =
    typeof exports === "object" &&
    exports !== null &&
    !Array.isArray(exports) &&
    Object.keys(exports).some((key) => key.startsWith("."));
  if (!isSubpathMap) return subpath === "." ? conditional(exports) : undefined;

  const map = exports as Record<string, unknown>;
  if (subpath in map) return conditional(map[subpath]);
  for (const [key, value] of Object.entries(map)) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (
      subpath.startsWith(prefix) &&
      subpath.endsWith(suffix) &&
      subpath.length >= key.length - 1
    ) {
      const match = subpath.slice(
        prefix.length,
        subpath.length - suffix.length,
      );
      return conditional(value)?.replaceAll("*", match);
    }
  }
  return undefined;
}

function conditional(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (Array.isArray(target)) {
    for (const entry of target) {
      const found = conditional(entry);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof target === "object" && target !== null) {
    for (const [condition, value] of Object.entries(target)) {
      if (!CONDITIONS.has(condition)) continue;
      const found = conditional(value);
      if (found) return found;
    }
  }
  return undefined;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
