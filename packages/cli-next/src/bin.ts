#!/usr/bin/env node
import { run } from "@stricli/core";

import { app } from "./app.js";
import { buildContext } from "./context.js";
import { EXIT_INTERNAL, renderError } from "./errors.js";

const argv = process.argv.slice(2);
const context = buildContext(argv);

try {
  await run(app, argv, context);
  // Applied after run(), because Stricli assigns process.exitCode itself once
  // the handler returns and would otherwise clear a handler's failure.
  const failure = context.failure();
  if (failure !== null) process.exitCode = failure;
} catch (error) {
  // Handlers render their own failures through `handler()`, which is where the
  // taxonomy lives. Reaching here means something escaped that boundary, which
  // is by definition an internal bug.
  process.stderr.write(`${renderError(error)}\n`);
  process.exitCode = EXIT_INTERNAL;
}
