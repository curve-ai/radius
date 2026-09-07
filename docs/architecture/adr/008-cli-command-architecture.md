# ADR-008: Build the CLI on a typed context, a three-class error taxonomy, and JSON as a public contract

**Status:** Accepted
**Date:** 2026-09-07
**Deciders:** Radius maintainers

## Context

The existing `packages/cli` hand-rolls `node:util` `parseArgs` inside a
492-line `main.ts` switch covering thirteen commands. It is being rewritten
rather than repaired, so the skeleton is chosen once, from scratch, without a
migration path to preserve.

Three properties of the current CLI shaped this decision.

The first is worth keeping. Commands are dependency-injected: `runCli` accepts
`{ cwd, io, readSecret }`, so the whole surface is callable in-process and
tests assert against captured output rather than spawning a subprocess. The
seam is a two-method `CliIo` interface maintained by hand and by convention.

The second is a consequence of the first being too thin. Because `CliIo`
carries only `out` and `error`, there is nowhere for colour support, TTY
detection, verbosity, or output mode to live. Machine-readable output is
therefore an ad-hoc `json: boolean` flag on four commands and absent from the
rest, and no command can tell whether a human is present before it prompts.

The third is that `cli.ts` maps every failure to exit code 1 with a
`radius: <message>` prefix. A schema validation failure, an unreachable
platform, and an internal crash are indistinguishable to a caller.

A survey of CLI frameworks ranked Commander 15 first, but did so explicitly on
migration cost: it can sit behind the existing `runCli` signature, confining
the change to `main.ts`. That survey also recorded Stricli as the better design
fit and flagged that its own tiebreaker — whether `CliIo` grows — was
"doing more work than a tiebreaker should."

The decision to rewrite rather than migrate removed Commander's stated
advantage, so the ranking was re-derived rather than inherited.

## Decision

### Framework and context

The CLI is built on **Stricli**. `CliIo` is replaced by a typed `Context`
carrying io, cwd, env, TTY state, colour support, verbosity, output mode, and a
logger. Stricli takes that context as a required argument to
`run(app, args, context)` and threads it into every handler, so the property
that was previously a hand-maintained convention becomes compiler-enforced.

Two further Stricli properties decided it over Commander. Its `loader:` field
makes per-command lazy loading a framework primitive rather than a discipline,
and it assigns `context.process.exitCode` on the injected process object
rather than the global one.

Commander types handler arguments as `any[]` and infers nothing from the
declared options. The costs accepted in exchange are more ceremony
(`buildCommand`, `buildRouteMap`, `buildApplication`, and a context module) and
a smaller ecosystem.

### Command layout

Each command is a directory. `command.ts` declares flags and the route entry;
`run.ts` holds the handler, reached through Stricli's `loader:`.

Help output and argument validation need only the flag and route tree. Keeping
handlers behind a loader means the heavy dependencies — the TypeScript config
loader, the schema packages, the terminal UI runtime — are never imported to
print help or reject a malformed invocation.

### Error taxonomy

Failures fall into three classes, with four exit codes:

| Class | Exit | Rendering |
| --- | --- | --- |
| Success | 0 | — |
| Operational failure | 1 | Cause and a next action |
| Usage or validation | 2 | The correct usage |
| Internal bug | 70 | Stack trace and an invitation to report |

The full sysexits range was rejected. A taxonomy that readers cannot recall
provides no more information than a single exit code.

### Machine-readable output

Every command supports `--json`, emitting a documented envelope. Commands
return structured values; the renderer selects a representation based on the
output mode carried by the context.

This envelope is a **public contract**, versioned and changed with the same
care as the configuration schema.

### Interaction

A command may prompt only when standard input is a TTY, `--json` is unset, and
no `--yes` or `--non-interactive` flag is present. Otherwise it fails
immediately and names the flag that would have supplied the answer.

The check lives in one helper rather than in each command, because the context
already carries the information it needs. A CLI that blocks on a prompt in a
non-interactive environment does not fail visibly; it hangs until something
else times out.

Terminal UI uses **Ink**, loaded through a dynamic import on the commands that
use it and never on the startup path. Colour uses the built-in
`util.styleText`.

### Credential storage

The OS keyring remains the credential store, with `RADIUS_ACCESS_TOKEN`
supplying credentials non-interactively and no fallback to a plaintext file.
The CLI is distributed through npm and Homebrew; a self-contained binary is not
pursued, because the native keyring dependency is the thing that would have to
be given up for it.

## Consequences

The typed context is what makes the output contract and the prompting rule
enforceable in one place instead of relied upon in twenty. Both follow from it,
and neither is practical without it.

Machine-readable output becomes an interface with an obligation. Once a
consumer parses the envelope, changing it is a breaking change. This is
accepted deliberately: the ad-hoc `--json` flags were already becoming a de
facto contract, and an undesigned contract is harder to honour than a designed
one.

Startup cost is now a structural property rather than a matter of vigilance.
Adding a static import of a heavy dependency to a `command.ts` file regresses
every invocation of the CLI, including `--help`. The directory layout makes the
correct placement obvious, but reviewers should still treat a new static import
at that layer as a question.

The terminal UI runtime is comparatively expensive to import. It is affordable
only because it stays behind a loader, and a future change that moves it onto
the startup path would be a significant regression for a command that
developers run continuously.

Retaining the native keyring dependency forecloses a single-file binary. If
that dependency is ever unmaintained, the environment-variable path is the
designed fallback rather than a plaintext credential file.

Stricli has a smaller ecosystem than Commander. The mitigation is that the
application entry point owns argument parsing behind a stable function
signature, so replacing the framework is a change to that entry point and the
per-command definitions, not to command logic.
