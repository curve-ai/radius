# TypeScript agent example

This is the first executable Radius SDK and CLI example. From the Radius
repository root:

```bash
npx bun@1.4.4 install
npx bun@1.4.4 run --cwd examples/typescript-agent check
npx bun@1.4.4 run --cwd examples/typescript-agent dev
npx bun@1.4.4 run --cwd examples/typescript-agent build:image
```

`radius check` starts the agent and confirms it speaks ACP over stdio.
`radius dev` registers the agent with the Radius app and starts one agent
process per thread.

To run the agent yourself instead, with your own watcher and debugger, attach to
it:

```bash
npx bun@1.4.4 run --cwd examples/typescript-agent agent:dev
# In a second terminal, from examples/typescript-agent:
radius dev --endpoint ws://127.0.0.1:7331/acp
```

Ctrl-C in the second terminal disconnects Radius and leaves the agent running.

`radius build` bundles the source into a
digest-pinned Node 22 `linux/arm64` OCI image, imports it through the Radius
Swift helper, verifies the ACP handshake in the real microVM, and writes an
immutable receipt beneath `.radius/builds/`. The initial builder uses Docker
Buildx; the resulting agent execution does not use Docker.
