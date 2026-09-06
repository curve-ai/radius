# Radius CLI four-command workflow

The primary Radius CLI workflow has four commands:

```text
radius init -> radius dev -> radius build -> radius deploy
```

The lifecycle separates repository setup, live development, packaging, and
distribution. Development connects to a running agent over a configured URL
without bundling it. Bundling begins only during `radius build`.

## Command responsibilities

| Command | Developer job | Behavior |
| --- | --- | --- |
| `radius init` | Bootstrap the repository | Add Radius integration files and create the repository configuration. |
| `radius dev` | Iterate against a running agent | Read the configured ACP WebSocket URL and connect the installed Radius application to the independently running agent without building or bundling it. |
| `radius build` | Create a distributable artifact | Package the agent as an immutable OCI artifact, verify it in the Radius microVM runtime, and write a build receipt. |
| `radius deploy` | Publish the verified artifact | Upload the exact artifact recorded by the build receipt to Curve Cloud or a compatible self-hosted Radius Platform without rebuilding. |

## Repository configuration

The CLI accepts `radius.config.json` as a repository configuration source. The
`development.endpoint` field supplies the ACP WebSocket URL used by
`radius dev`.

```json
{
  "schemaVersion": 1,
  "agent": null,
  "name": "My Agent",
  "runtime": {
    "kind": "command",
    "command": ["my-agent", "serve"]
  },
  "development": {
    "endpoint": "ws://127.0.0.1:7331/acp",
    "authorizationEnv": null
  },
  "capabilities": [],
  "networkAllowlist": [],
  "resources": {
    "cpu": 2,
    "memoryMb": 4096,
    "diskMb": 5120
  },
  "minimumDesktopVersion": "0.0.1"
}
```

The endpoint must use `ws://` or `wss://` and resolve to a loopback host. The
`--endpoint <ws-url>` option may override the configured value for one run.
The JSON config contains no credentials. If the endpoint requires a bearer
value, `development.authorizationEnv` names the environment variable that
provides it.

## `radius init`

`radius init` adds Radius to an existing agent repository. It should:

1. Detect the repository root and package manager.
2. Refuse to overwrite existing Radius configuration unless replacement is
   explicit.
3. Add the selected Radius integration and entrypoint files.
4. Create a repository config, including the development endpoint when known.
5. Validate the normalized configuration.
6. Print `radius dev` as the next command.

Initialization does not require a build, deployment, organization, or access
token.

## `radius dev`

The developer owns the agent process, watcher, and reload policy. `radius dev`
reads `development.endpoint` from the selected repository config and registers
that independently running agent with the installed Radius application.

```text
developer-owned agent process
    | ACP over a configured loopback WebSocket URL
    v
installed Radius application
    | desktop UI, host capabilities, history, and approvals
    v
agent response
```

Development mode does not:

- build an OCI image;
- bundle the agent into Radius;
- start a microVM;
- launch, watch, or restart the agent process; or
- create production deployment state.

The CLI removes the temporary development registration when it exits. Agent
restarts affect the next run without requiring Radius to restart.

## `radius build`

`radius build` is the packaging and runtime-parity boundary. It should:

1. Load and validate the repository config.
2. Produce a deterministic OCI layout for the agent.
3. Import that exact layout into Radius-owned image storage.
4. Start the package in the real microVM runtime and complete an ACP smoke.
5. Write an immutable receipt only after verification succeeds.

Failed builds and failed runtime smokes must never become the latest verified
build.

## `radius deploy`

`radius deploy` is the distribution boundary. It should:

1. Load the latest verified build receipt.
2. Confirm that the receipt still matches the repository configuration.
3. Prepare the deployment against the selected Cloud or self-hosted profile.
4. Upload the exact OCI artifact identified by the receipt.
5. Finalize the deployment using the same digest.

Deploy must not rebuild the agent. The artifact tested by `radius build` is the
artifact published by `radius deploy`.

## CLI boundary

The four commands cover the primary developer lifecycle: setup, iteration,
packaging, and distribution. Informational, authentication, inventory,
promotion, and rollback commands may exist, but they do not change this core
workflow.
