/** Import graphs named in `langgraph.json` and make them persistent. */

import { mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { GraphSpec, LangGraphConfig } from "./config.js";
import type { ProjectLibraries } from "./project.js";

export const CHECKPOINT_PATH = join(
  ".radius",
  "langgraph",
  "checkpoints.sqlite",
);

export class GraphLoadError extends Error {
  override name = "GraphLoadError";
}

/**
 * The parts of a compiled graph the adapter calls. Typed structurally
 * because the graph is built with the project's `@langchain/langgraph`, not
 * one the adapter imports.
 */
export interface RunnableGraph {
  checkpointer?: unknown;
  stream(
    input: unknown,
    options: Record<string, unknown>,
  ): Promise<AsyncIterable<unknown>>;
  getState(config: Record<string, unknown>): Promise<StateSnapshotLike>;
}

export interface StateSnapshotLike {
  readonly values: unknown;
  readonly tasks?: ReadonlyArray<{
    readonly interrupts?: ReadonlyArray<InterruptLike>;
  }>;
  readonly interrupts?: ReadonlyArray<InterruptLike>;
}

export interface InterruptLike {
  readonly id?: string;
  readonly value?: unknown;
}

export interface LoadedGraph {
  readonly name: string;
  readonly graph: RunnableGraph;
  readonly description?: string;
}

const EXTENSIONS = /\.(?:[cm]?[jt]s|[jt]sx)$/i;

/**
 * Splits `./src/agent.ts:graph` the way the LangGraph JS server does: the
 * file is everything before the first colon and the export defaults to
 * `default`. A Windows drive letter is the one colon that is not a separator.
 */
export function parseGraphSpec(spec: string): { file: string; name: string } {
  const drive = /^[A-Za-z]:[\\/]/.test(spec) ? 2 : 0;
  const colon = spec.indexOf(":", drive);
  const file = colon === -1 ? spec : spec.slice(0, colon);
  const name = colon === -1 ? "default" : spec.slice(colon + 1) || "default";
  if (!file || !EXTENSIONS.test(file)) {
    throw new GraphLoadError(
      `"${spec}" must look like "./path/to/file.ts:export" (a .ts, .mts, .js or .mjs file)`,
    );
  }
  return { file, name };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCompiledGraph(value: unknown): value is RunnableGraph {
  return (
    isRecord(value) &&
    typeof value.stream === "function" &&
    typeof value.getState === "function"
  );
}

function isUncompiledGraph(value: unknown): value is { compile(): unknown } {
  return isRecord(value) && typeof value.compile === "function";
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === "function";
}

/**
 * `createAgent` (and so `createDeepAgent`) returns a wrapper whose real
 * compiled graph is `.graph`. The LangGraph server unwraps it the same way,
 * so the checkpointer attached here is the one the runs use.
 */
function unwrapAgent(value: RunnableGraph): RunnableGraph {
  const inner = (value as { graph?: unknown }).graph;
  if (
    isCompiledGraph(inner) &&
    isRecord((inner as { builder?: unknown }).builder)
  ) {
    return inner;
  }
  return value;
}

async function resolveGraph(value: unknown, depth = 0): Promise<RunnableGraph> {
  if (depth > 4) {
    throw new GraphLoadError("graph factory did not produce a graph");
  }
  if (isThenable(value)) return resolveGraph(await value, depth + 1);
  if (isCompiledGraph(value)) return unwrapAgent(value);
  if (isUncompiledGraph(value)) return resolveGraph(value.compile(), depth + 1);
  if (typeof value === "function") {
    // A factory's second parameter is the LangGraph server's runtime, which
    // there is no server here to provide.
    if (value.length > 1) {
      throw new GraphLoadError(
        "graph factories that take a LangGraph server runtime are not supported; accept a RunnableConfig or no arguments instead",
      );
    }
    return resolveGraph(value({ configurable: {} }), depth + 1);
  }
  throw new GraphLoadError(
    `expected a compiled graph, a StateGraph, or a factory; got ${describe(value)}`,
  );
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (isRecord(value)) return value.constructor?.name ?? "object";
  return typeof value;
}

export async function loadGraph(
  spec: GraphSpec,
  root: string,
): Promise<LoadedGraph> {
  const { file, name } = parseGraphSpec(spec.spec);
  const path = resolve(root, file);
  if (!isFile(path)) throw new GraphLoadError(`graph file not found: ${path}`);

  let module: Record<string, unknown>;
  try {
    module = await import(pathToFileURL(path).href);
  } catch (error) {
    throw new GraphLoadError(
      `failed to import ${spec.spec}: ${errorText(error)}`,
    );
  }
  if (!(name in module)) {
    throw new GraphLoadError(
      `${spec.spec}: module "${file}" has no export "${name}"`,
    );
  }
  let graph: RunnableGraph;
  try {
    graph = await resolveGraph(module[name]);
  } catch (error) {
    if (error instanceof GraphLoadError) throw error;
    throw new GraphLoadError(
      `failed to build graph from ${spec.spec}: ${errorText(error)}`,
    );
  }
  return {
    name: spec.name,
    graph,
    ...(spec.description ? { description: spec.description } : {}),
  };
}

export function needsCheckpointer(graph: RunnableGraph): boolean {
  // `false` is an explicit opt-out; `true` (inherit) has nothing to inherit at the root.
  return graph.checkpointer == null || graph.checkpointer === true;
}

export interface Checkpointing {
  readonly kind: "sqlite" | "memory";
  readonly path?: string;
  close(): void;
}

/**
 * Give every graph without a checkpointer a shared SQLite one under
 * `.radius/`, so a session can be loaded by a later process.
 *
 * `better-sqlite3` is a native module, and an install that skipped its build
 * step only fails when a database is opened. Rather than refuse to serve, the
 * graphs then get the project's `MemorySaver`: everything works except
 * `session/load` across processes, and stderr says so.
 */
export async function attachCheckpointers(
  graphs: readonly LoadedGraph[],
  cwd: string,
  libraries: ProjectLibraries,
  warn: (message: string) => void,
): Promise<Checkpointing | null> {
  const missing = graphs.filter((loaded) => needsCheckpointer(loaded.graph));
  if (missing.length === 0) return null;

  const path = join(cwd, CHECKPOINT_PATH);
  let saver: { serde?: unknown; db?: { close(): void } } | undefined;
  try {
    const { SqliteSaver } =
      await import("@langchain/langgraph-checkpoint-sqlite");
    mkdirSync(dirname(path), { recursive: true });
    const sqlite = SqliteSaver.fromConnString(path);
    // Checkpoints hold LangChain messages; revive them with the project's
    // classes rather than the copy installed next to the adapter.
    if (libraries.serializer) {
      (sqlite as unknown as { serde: unknown }).serde = libraries.serializer;
    }
    // Creates the tables now, so a database that cannot be written falls
    // back here instead of failing the first prompt.
    (sqlite as unknown as { setup(): void }).setup();
    saver = sqlite as unknown as typeof saver;
  } catch (error) {
    warn(
      `radius-langgraph: the SQLite checkpointer is unavailable (${errorText(error)}); using an in-memory one, so sessions will not survive a restart`,
    );
  }

  if (saver) {
    for (const loaded of missing) loaded.graph.checkpointer = saver;
    const db = saver.db;
    return { kind: "sqlite", path, close: () => db?.close() };
  }
  const memory = new libraries.MemorySaver();
  for (const loaded of missing) loaded.graph.checkpointer = memory;
  return { kind: "memory", close: () => {} };
}

export async function loadGraphs(
  config: LangGraphConfig,
  options: { only?: string } = {},
): Promise<LoadedGraph[]> {
  let specs = config.graphs;
  if (options.only !== undefined) {
    specs = specs.filter((spec) => spec.name === options.only);
    if (specs.length === 0) {
      const names = config.graphs.map((spec) => spec.name).join(", ");
      throw new GraphLoadError(
        `graph "${options.only}" is not defined in ${config.path} (${names})`,
      );
    }
  }
  const loaded: LoadedGraph[] = [];
  for (const spec of specs) loaded.push(await loadGraph(spec, config.root));
  return loaded;
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
