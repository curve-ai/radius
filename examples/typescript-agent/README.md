# TypeScript agent example

This is the first executable Radius SDK and CLI example. From the Radius
repository root:

```bash
npx bun@1.3.14 install
npx bun@1.3.14 run --cwd examples/typescript-agent validate
npx bun@1.3.14 run --cwd examples/typescript-agent dev -- --prompt "Hello"
npx bun@1.3.14 run --cwd examples/typescript-agent dev -- --sandbox --prompt "Hello from the sandbox"
npx bun@1.3.14 run --cwd examples/typescript-agent deploy:dry-run
```

`dev` starts the agent as a supervised local ACP subprocess. The dry-run deploy
writes the normalized deterministic manifest beneath `.radius/builds/` and does
not contact Curve Cloud or mutate a remote platform.

On Apple Silicon macOS 26, `dev --sandbox` bundles the same source into a
digest-pinned Node 22 `linux/arm64` OCI image, imports it through the Radius
Swift helper, and runs the prompt in the real microVM. The initial builder uses
Docker Buildx; the resulting agent execution does not use Docker.

For a full development deployment through the open Platform API and local OCI
registry, follow
[`../../apps/platform-api/README.md`](../../apps/platform-api/README.md).
