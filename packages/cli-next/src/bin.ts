#!/usr/bin/env node
import { run } from "@stricli/core";

import { app } from "./app.js";
import { buildContext } from "./context.js";
import { EXIT_INTERNAL, renderError } from "./errors.js";

const argv = process.argv.slice(2);
const context = buildContext(argv);

/**
 * Last line of defence for an error nobody can catch.
 *
 * Not every failure arrives as a rejected promise. A library that throws from
 * inside a socket callback — Node's own HTTP client asserts on an HTTP/1.0
 * response, which is how this was found — escapes every `await` and every
 * try/catch, and Node's default is to dump an internal stack trace and exit
 * with a code outside the 0/1/2/70 taxonomy. That is the one outcome the
 * taxonomy exists to prevent, so these are rendered as internal errors and
 * exit 70 like any other escape.
 */
for (const event of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(event, (error: unknown) => {
    process.stderr.write(`${renderError(error)}\n`);
    process.exit(EXIT_INTERNAL);
  });
}

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
