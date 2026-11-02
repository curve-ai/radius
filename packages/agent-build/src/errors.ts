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

/**
 * The Docker failures every builder can hit, said in terms of what to do.
 * Null for anything else, which the caller reports as it always has.
 */
export function recognisedDockerFailure(stderr: string): BuildError | null {
  // Radius needs an OCI layout, which the default docker driver cannot
  // export. The raw message names neither Radius nor the fix.
  if (/OCI exporter is not supported for the docker driver/.test(stderr)) {
    return new BuildError(
      "This Docker builder cannot export an OCI layout, which is the only thing Radius can ship.\n" +
        "Create one once with:\n" +
        "  docker buildx create --name radius-oci --driver docker-container --bootstrap\n" +
        "then build with BUILDX_BUILDER=radius-oci.",
    );
  }
  // Building for the other architecture runs the image's RUN steps under
  // emulation. Without it registered, the first one fails with a kernel
  // error that does not mention architecture at all.
  if (/exec format error/i.test(stderr)) {
    return new BuildError(
      "Docker could not run the build steps for the other CPU architecture, because emulation for it is not set up.",
      'In Docker Desktop, turn on Settings → General → "Use Rosetta for x86_64/amd64 emulation", or register QEMU once with:\n' +
        "  docker run --privileged --rm tonistiigi/binfmt --install all\n" +
        "Building only for this machine's own architecture needs neither.",
    );
  }
  return null;
}
