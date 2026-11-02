#!/usr/bin/env node
/**
 * Registers tsx's ESM loader, then runs the adapter.
 *
 * The loader is registered for the whole process rather than per import
 * because it is there for the user's graphs: a `langgraph.json` that points
 * at `./src/agent.ts` should run with no build step, the way the LangGraph
 * CLI runs it, and that file's own relative `.ts` imports need the same
 * loader. The adapter's sources load through it too, so the package ships
 * no build output.
 */
import { register } from "tsx/esm/api";

register();
const { main } = await import("../src/cli.ts");
await main(process.argv.slice(2));
