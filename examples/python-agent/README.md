# Radius Python agent example

This example uses standard `pyproject.toml` metadata, a committed universal
`uv.lock`, the first-party Radius Python SDK, and the same language-neutral ACP
runtime contract as TypeScript.

```bash
uv sync --locked
node ../../packages/cli/dist/bin.js check
node ../../packages/cli/dist/bin.js dev
```

The Python SDK is currently a workspace package and is not published to PyPI.
The example's local uv source exists only for repository verification.
