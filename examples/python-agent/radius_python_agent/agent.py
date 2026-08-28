from radius_agent_sdk import RunContext, define_agent, serve_stdio


async def run(context: RunContext) -> str:
    return f"Radius Python received: {context.text}"


agent = define_agent(name="radius-python-example", run=run)

if __name__ == "__main__":
    serve_stdio(agent)
