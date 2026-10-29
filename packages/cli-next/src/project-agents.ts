import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { parse } from "jsonc-parser";

/**
 * The agents a project defines for itself, read from its own files.
 *
 * This is the other half of `radius check`'s second question. A harness that
 * lost the project tree, or a framework bin that ignores the project
 * altogether, still handshakes cleanly — what gives it away is that the agents
 * it offers are not the ones written here. So the expectation has to come
 * from the project, never from what the harness reports about itself.
 */
export type ProjectAgents =
  | {
      readonly framework: "opencode";
      /** Agents opencode will offer as a session mode, so these must be advertised. */
      readonly primary: readonly string[];
      /**
       * Agents opencode only runs as a delegate of another. It leaves them out
       * of the mode list, so their absence from the handshake is not evidence
       * of anything and they are reported, not compared.
       */
      readonly subagents: readonly string[];
      readonly disabled: readonly string[];
      readonly sources: readonly string[];
    }
  | {
      readonly framework: "langgraph";
      readonly graphs: readonly string[];
      readonly sources: readonly string[];
    }
  | { readonly framework: "unknown" };

/** opencode reads both spellings; the plural is the one its docs now use. */
const OPENCODE_AGENT_DIRECTORIES = [".opencode/agent", ".opencode/agents"];

/**
 * Root first, then `.opencode/`, matching opencode's own precedence so a key
 * set in both ends up with the value opencode would actually use.
 */
const OPENCODE_CONFIG_FILES = [
  "opencode.json",
  "opencode.jsonc",
  ".opencode/opencode.json",
  ".opencode/opencode.jsonc",
];

interface OpencodeAgentEntry {
  disable?: boolean;
  mode?: string;
}

export async function discoverProjectAgents(
  root: string,
): Promise<ProjectAgents> {
  const opencode = await discoverOpencode(root);
  if (opencode) return opencode;
  const langgraph = await discoverLanggraph(root);
  if (langgraph) return langgraph;
  return { framework: "unknown" };
}

async function discoverOpencode(root: string): Promise<ProjectAgents | null> {
  const agents = new Map<string, OpencodeAgentEntry>();
  const sources: string[] = [];

  for (const directory of OPENCODE_AGENT_DIRECTORIES) {
    const files = await markdownFiles(join(root, directory));
    if (files.length === 0) continue;
    sources.push(directory);
    for (const file of files) {
      // opencode names a nested agent by its path below the agent directory,
      // so `agent/review/strict.md` is `review/strict`, not `strict`.
      const name = relative(join(root, directory), file)
        .replaceAll("\\", "/")
        .replace(/\.md$/i, "");
      const frontMatter = readFrontMatter(await readFile(file, "utf8"));
      agents.set(name, { ...agents.get(name), ...frontMatter });
    }
  }

  for (const file of OPENCODE_CONFIG_FILES) {
    const config = await readJsonc(join(root, file));
    if (config === null) continue;
    sources.push(file);
    const declared = (config as { agent?: unknown }).agent;
    if (!declared || typeof declared !== "object") continue;
    for (const [name, raw] of Object.entries(declared)) {
      const entry =
        raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      // Merged over the markdown, not replacing it: shopfloor declares `ops`
      // in both places — the prompt in the file, the model and tools in JSON.
      agents.set(name, {
        ...agents.get(name),
        ...(typeof entry.disable === "boolean"
          ? { disable: entry.disable }
          : {}),
        ...(typeof entry.mode === "string" ? { mode: entry.mode } : {}),
      });
    }
  }

  if (sources.length === 0) return null;

  const primary: string[] = [];
  const subagents: string[] = [];
  const disabled: string[] = [];
  for (const [name, entry] of [...agents].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (entry.disable) disabled.push(name);
    else if (entry.mode === "subagent") subagents.push(name);
    // `all` and an unset mode both make the agent selectable as a mode.
    else primary.push(name);
  }
  return { framework: "opencode", primary, subagents, disabled, sources };
}

async function discoverLanggraph(root: string): Promise<ProjectAgents | null> {
  const graphs = await readLanggraphGraphs(join(root, "langgraph.json"));
  if (graphs === null) return null;
  return {
    framework: "langgraph",
    graphs: Object.keys(graphs).sort(),
    sources: ["langgraph.json"],
  };
}

/**
 * The `graphs` map of a `langgraph.json`, or null when there is no such
 * file. A file without a usable `graphs` object reads as empty rather than
 * missing, so callers can tell "not a LangGraph project" from "one that
 * defines nothing".
 */
export async function readLanggraphGraphs(
  path: string,
): Promise<Readonly<Record<string, unknown>> | null> {
  const config = await readJsonc(path);
  if (config === null) return null;
  const graphs = (config as { graphs?: unknown } | undefined)?.graphs;
  return graphs && typeof graphs === "object" && !Array.isArray(graphs)
    ? (graphs as Record<string, unknown>)
    : {};
}

async function markdownFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownFiles(path)));
    else if (/\.md$/i.test(entry.name)) found.push(path);
  }
  return found;
}

/**
 * Reads only the two top-level keys the comparison needs.
 *
 * Not a YAML parser, deliberately: pulling one in to read `disable` and
 * `mode` would be the largest dependency in the CLI, and a front matter this
 * reader cannot follow only costs a less precise expectation, never a wrong
 * pass.
 */
export function readFrontMatter(source: string): OpencodeAgentEntry {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(source);
  if (!match) return {};
  const entry: OpencodeAgentEntry = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    // Indented lines belong to a nested map such as `tools:`, whose own
    // `disable` would otherwise be misread as the agent's.
    const pair = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(line);
    if (!pair) continue;
    const value = pair[2]!.replace(/^["']|["']$/g, "");
    if (pair[1] === "disable") entry.disable = value === "true";
    if (pair[1] === "mode" && value) entry.mode = value;
  }
  return entry;
}

async function readJsonc(path: string): Promise<unknown> {
  try {
    if (!(await stat(path)).isFile()) return null;
  } catch {
    return null;
  }
  return parse(await readFile(path, "utf8"), [], { allowTrailingComma: true });
}
