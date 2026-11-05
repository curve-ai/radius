import { emitJsonError, type RadiusContext } from "./context.js";
import { errorCodeFor, exitCodeFor, renderError } from "./errors.js";

/**
 * Wraps a command handler so every failure is rendered by the three-class
 * taxonomy in ADR-008.
 *
 * Stricli catches whatever a handler throws, prints it in its own format with a
 * stack, and sets its own exit code — so a thrown error never reaches the
 * entry point's catch. Handling it here, at the boundary Stricli calls, is the
 * only place that keeps rendering and exit codes in one place.
 */
export function handler<FLAGS, ARGS extends unknown[]>(
  run: (this: RadiusContext, flags: FLAGS, ...args: ARGS) => Promise<void>,
): (this: RadiusContext, flags: FLAGS, ...args: ARGS) => Promise<void> {
  return async function wrapped(this: RadiusContext, flags, ...args) {
    try {
      await run.call(this, flags, ...args);
    } catch (error) {
      const nextAction =
        error instanceof Error &&
        "nextAction" in error &&
        typeof error.nextAction === "string"
          ? error.nextAction
          : undefined;
      if (this.output === "json") {
        emitJsonError(this, {
          code: errorCodeFor(error),
          message: error instanceof Error ? error.message : String(error),
          ...(nextAction ? { nextAction } : {}),
        });
      } else {
        this.process.stderr.write(`${renderError(error)}\n`);
      }
      this.fail(exitCodeFor(error));
    }
  };
}
