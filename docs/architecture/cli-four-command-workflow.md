# Radius CLI workflow

The primary Radius CLI workflow is:

```text
radius init -> radius check -> radius dev -> radius build
```

The lifecycle separates repository setup, verification, live development, and
packaging. `radius app` installs, updates, locates, and opens the desktop app.
`radius deploy` is planned and not implemented yet.

## Command responsibilities

| Command        | Developer job                   | Behavior                                                                                                            |
| -------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `radius init`  | Bootstrap the repository        | Write `radius.json` and `radius.lock` for a harness, or fill in what is missing.                                    |
| `radius check` | Confirm the agent works         | Start the configured command and complete the ACP handshake over stdio, stopping before any prompt.                 |
| `radius dev`   | Iterate against the real app    | Register the agent with the Radius app and start one process per thread over stdio.                                 |
| `radius build` | Create a distributable artifact | Package the agent as an immutable OCI artifact, verify it in the Radius microVM runtime, and write a build receipt. |

## Repository configuration

`radius.json` is the repository configuration, beside the `radius.lock` that pins
a harness. Formats that predate it, such as `radius.config.ts` and
`[tool.radius]` in `pyproject.toml`, are still read behind a deprecation warning.

## `radius dev`

Radius owns the agent processes. It checks that the agent starts and speaks ACP,
then registers a local bridge endpoint with the Radius app. Each thread the
desktop opens gets its own process, so one crash ends only that thread.

The CLI removes the registration when it exits. There is no option yet to attach
to an agent the developer already runs, and `development.endpoint` is not read.

## `radius build`

`radius build` is the packaging and runtime-parity boundary. It should:

1. Load and validate the repository config.
2. Produce a deterministic OCI layout for the agent.
3. Import that exact layout into Radius-owned image storage.
4. Start the package in the real microVM runtime and complete an ACP smoke.
5. Write an immutable receipt only after verification succeeds.

Failed builds and failed runtime smokes must never become the latest verified
build.

## `radius deploy` (not implemented)

The planned distribution boundary. It should:

1. Load the latest verified build receipt.
2. Confirm that the receipt still matches the repository configuration.
3. Prepare the deployment against the selected Cloud or self-hosted profile.
4. Upload the exact OCI artifact identified by the receipt.
5. Finalize the deployment using the same digest.

Deploy must not rebuild the agent. The artifact tested by `radius build` is the
artifact published by `radius deploy`.
