/**
 * A build failure the developer can act on.
 *
 * The builders threw plain `Error` for ordinary, expected conditions — a
 * harness with no Linux build, an image larger than its budget, a `docker`
 * that cannot export OCI. The CLI has no way to tell those from a genuine
 * defect, so each one reached the user as "Internal error — please report
 * this" with a stack trace, which is both alarming and wrong.
 *
 * This package cannot import the CLI's error taxonomy without depending on
 * the CLI, so it exports its own marker and the CLI maps it across.
 */
export class BuildError extends Error {
  /** What the developer should do about it, when there is something. */
  readonly nextAction?: string;

  constructor(message: string, nextAction?: string) {
    super(message);
    this.name = "BuildError";
    this.nextAction = nextAction;
  }
}

export function isBuildError(error: unknown): error is BuildError {
  // Checked by name rather than `instanceof`, so a build that loads two
  // copies of this package still classifies correctly.
  return error instanceof Error && error.name === "BuildError";
}
