/**
 * The three-class taxonomy from ADR-008, keyed on what the reader should do,
 * not on what went wrong internally.
 */
export const EXIT_OK = 0;
export const EXIT_OPERATIONAL = 1;
export const EXIT_USAGE = 2;
export const EXIT_INTERNAL = 70;

/** Something outside the CLI's control failed. Print the cause and a next action. */
export class OperationalError extends Error {
  readonly exitCode = EXIT_OPERATIONAL;
  readonly nextAction?: string;
  constructor(message: string, nextAction?: string) {
    super(message);
    this.name = "OperationalError";
    this.nextAction = nextAction;
  }
}

/**
 * No microVM runtime exists on this machine.
 *
 * Its own class because `build` has to distinguish it from every other
 * verification failure: a missing runtime is a reason to skip the check and
 * still write the layout, while an image that will not boot is a failed
 * build. Catching `OperationalError` broadly conflated the two and reported
 * success for a broken image.
 */
export class RuntimeUnavailableError extends OperationalError {
  constructor(message: string, nextAction?: string) {
    super(message, nextAction);
    this.name = "RuntimeUnavailableError";
  }
}

/** The invocation or the config was wrong. Print the correct usage. */
export class UsageError extends Error {
  readonly exitCode = EXIT_USAGE;
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function exitCodeFor(error: unknown): number {
  if (error instanceof OperationalError) return EXIT_OPERATIONAL;
  if (error instanceof UsageError) return EXIT_USAGE;
  return EXIT_INTERNAL;
}

/** The stable identifier a `--json` consumer switches on. */
export function errorCodeFor(error: unknown): string {
  if (error instanceof OperationalError) return "OPERATIONAL";
  if (error instanceof UsageError) return "USAGE";
  return "INTERNAL";
}

export function renderError(error: unknown): string {
  if (error instanceof OperationalError) {
    return error.nextAction
      ? `${error.message}\n\n${error.nextAction}`
      : error.message;
  }
  if (error instanceof UsageError) return error.message;
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return `Internal error — please report this with the trace below.\n\n${detail}`;
}
