# Hosting operations

Run these commands from the Radius repository root:

```sh
bun run --cwd hosting infra:up          # Local dependency containers
bun run --cwd hosting infra:down        # Stop without deleting volumes
bun run --cwd hosting stack:config      # Complete development stack
bun run --cwd hosting stack:up
bun run --cwd hosting stack:logs
bun run --cwd hosting stack:down
bun run --cwd hosting self-host:config  # Released self-host distribution
bun run --cwd hosting self-host:up
```

PostgreSQL uses the official digest-pinned image directly. Compose owns its
ports, credentials, and persistent volume; there is no custom database image.
Shared local dependency configuration is loaded from `../.env.local` for
`infra:*`. Self-host commands read `docker/.env.self-host`.

`test:integration` exercises a disposable source-built stack, including
bootstrap, deployment, authentication, and backup/recovery. `verify:images`
checks the three Radius application images for both supported architectures.
They require a working Docker daemon and are separate from unit tests.

See [Docker distributions](docker/README.md) and
[installation/operations](../docs/self-hosting/README.md) for the full procedures.
