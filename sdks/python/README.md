# Radius Python SDK

This is the first-party Python authoring layer for Radius. It stays deliberately
thin: the official `agent-client-protocol` package owns ACP schemas, framing,
and transport, while Radius adds the same run-context shape offered by the
TypeScript SDK.

```python
from radius_agent_sdk import RunContext, define_agent, serve_stdio


async def run(context: RunContext) -> str:
    return f"Python received: {context.text}"


agent = define_agent(name="my-agent", run=run)

if __name__ == "__main__":
    serve_stdio(agent)
```

The SDK streams text through ACP, tracks per-session cancellation, and never
contains deployment credentials, registry logic, or a model-provider loop.

Development checks:

```bash
uv sync --locked --project sdks/python
uv run --locked --project sdks/python pytest
uv run --locked --project sdks/python ruff check .
```
