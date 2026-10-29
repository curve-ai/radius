/**
 * A minimal ACP agent for tests, run with `node -e`.
 *
 * Answers `initialize` and `session/new` the way a two-agent harness does,
 * echoes anything else back, reports its pid on `test/pid` so a test can tell
 * processes apart, and exits 1 on `test/crash` so a test can kill exactly one.
 * Written as a script rather than built on the SDK so the bridge is tested
 * against bytes on stdio and nothing else.
 */
export const FAKE_ACP_AGENT = `
let buffer = "";
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\\n")) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      send({ jsonrpc: "2.0", id: message.id, result: {
        protocolVersion: 1, agentCapabilities: {}, authMethods: [],
      } });
    } else if (message.method === "session/new") {
      send({ jsonrpc: "2.0", id: message.id, result: {
        sessionId: "session-" + process.pid,
        modes: { currentModeId: "ops", availableModes: [
          { id: "ops", name: "Ops" }, { id: "reporter", name: "Reporter" },
        ] },
      } });
    } else if (message.method === "test/pid") {
      send({ jsonrpc: "2.0", id: message.id, result: { pid: process.pid } });
    } else if (message.method === "test/crash") {
      process.stderr.write("crashing on request\\n");
      process.exit(1);
    } else {
      process.stdout.write(line + "\\n");
    }
  }
});
`;

export const FAKE_ACP_COMMAND = ["node", "-e", FAKE_ACP_AGENT] as const;
