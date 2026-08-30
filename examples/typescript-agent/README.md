# TypeScript agent example

This is the first executable Radius SDK and CLI example. From the Radius
repository root:

```bash
npx bun@1.3.14 install
npx bun@1.3.14 run --cwd examples/typescript-agent validate
npx bun@1.3.14 run --cwd examples/typescript-agent agent:dev
# In a second terminal:
npx bun@1.3.14 run --cwd examples/typescript-agent dev
npx bun@1.3.14 run --cwd examples/typescript-agent build
npx bun@1.3.14 run --cwd examples/typescript-agent deploy
```

`agent:dev` runs the agent's own watch process and exposes authenticated-ready
ACP WebSocket semantics on loopback. `radius dev` opens the ready Radius app,
registers that endpoint, reloads only declarative Radius configuration, and
never starts, watches, builds, or restarts the agent.

`radius build` bundles the source into a
digest-pinned Node 22 `linux/arm64` OCI image, imports it through the Radius
Swift helper, verifies the ACP handshake in the real microVM, and writes an
immutable receipt beneath `.radius/builds/`. The initial builder uses Docker
Buildx; the resulting agent execution does not use Docker. `radius deploy`
uploads the exact successful build receipt without rebuilding it.

For a full development deployment through the open Platform API and local OCI
registry, follow
[`../../apps/platform-api/README.md`](../../apps/platform-api/README.md).
