/** `radius-langgraph`: serve the graphs in `langgraph.json` over ACP on stdio. */

import { ndJsonStream } from "@agentclientprotocol/sdk";
import { parseArgs } from "node:util";

import { createLangGraphAgent } from "./agent.js";
import { ConfigError, applyEnv, loadConfig } from "./config.js";
import {
  GraphLoadError,
  attachCheckpointers,
  errorText,
  loadGraphs,
} from "./loader.js";
import { ProjectPackageError, loadProjectLibraries } from "./project.js";
import { reserveProtocolStdout } from "./stdio.js";
import { VERSION } from "./version.js";

const USAGE = `usage: radius-langgraph [--config PATH] [--graph NAME]

Serve LangGraph graphs over the Agent Client Protocol on stdio.

options:
  --config PATH  path to langgraph.json (default: ./langgraph.json)
  --graph NAME   serve only this graph from langgraph.json
  --version      print the version and exit
  -h, --help     show this help and exit
`;

function fail(message: string): never {
  process.stderr.write(`radius-langgraph: ${message}\n`);
  process.exit(1);
}

export async function main(argv: readonly string[]): Promise<void> {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        config: { type: "string", default: "langgraph.json" },
        graph: { type: "string" },
        version: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (error) {
    process.stderr.write(USAGE);
    fail(errorText(error));
  }
  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (values.version) {
    process.stdout.write(`radius-langgraph ${VERSION}\n`);
    return;
  }

  // Claim stdout before any user module is imported.
  const streams = reserveProtocolStdout();

  let app;
  let checkpointing;
  try {
    const config = loadConfig(values.config);
    applyEnv(config);
    const libraries = await loadProjectLibraries(config.root);
    const graphs = await loadGraphs(config, { only: values.graph });
    checkpointing = await attachCheckpointers(
      graphs,
      process.cwd(),
      libraries,
      (message) => process.stderr.write(`${message}\n`),
    );
    app = createLangGraphAgent({ graphs, libraries });
  } catch (error) {
    if (
      error instanceof ConfigError ||
      error instanceof GraphLoadError ||
      error instanceof ProjectPackageError
    ) {
      fail(error.message);
    }
    process.stderr.write(
      `radius-langgraph: failed to load graphs: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  }

  const connection = app.connect(ndJsonStream(streams.output, streams.input));
  await connection.closed;
  checkpointing?.close();
  // A cancelled tool can leave timers behind that would keep the process
  // alive after the client has gone.
  process.exit(0);
}
