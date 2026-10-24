import { randomBytes } from "node:crypto";

import { startBridge } from "../../bridge.js";
import { loadConfig } from "../../config.js";
import { emitJson, type RadiusContext } from "../../context.js";
import { launchDesktopApp } from "../../desktop.js";
import { handler } from "../../handler.js";
import { resolveHarness } from "../../harness.js";
import {
  radiusUserDataPath,
  registerDevelopmentAgent,
} from "../../registration.js";
import { OperationalError } from "../../errors.js";

interface DevFlags {
  readonly verbose: boolean;
  readonly "no-open": boolean;
}

async function run(
  this: RadiusContext,
  flags: DevFlags,
): Promise<void> {
  const context = this;
  const config = await loadConfig(context.cwd);
  if (!config.agent) {
    throw new OperationalError(
      "This config has no agent id.",
      "Run `radius init --harness <id>` to assign one.",
    );
  }

  const harness = await resolveHarness(
    config,
    context.cwd,
    { platform: context.process.platform, arch: context.process.arch },
    (message) => context.note(message),
  );

  let failure: OperationalError | null = null;
  const bridge = await startBridge(harness.command, context.cwd, context.env, {
    onStdout: (line) => context.note(`[harness] ${line}`),
    onStderr: (line) => context.note(`[harness] ${line}`),
    onExit: (code, signal) => {
      context.note(
        `[radius] harness exited (code ${String(code)}, signal ${String(signal)})`,
      );
      // No restart: supervision is a contract decision the experiments inform.
      context.process.exitCode = code === 0 ? 0 : 1;
      context.stop();
    },
    onSpawnError: (error) => {
      failure = error;
      context.process.exitCode = 1;
      context.stop();
    },
    onConnect: () => context.note("[radius] Radius connected"),
    onDisconnect: () => context.note("[radius] Radius disconnected"),
    onFrame: (direction, message) => {
      // Logged live rather than accumulated: a silent log once made a working
      // session look like a dead one, and a long-lived `dev` must not grow a
      // transcript in memory.
      const method = typeof message.method === "string" ? message.method : null;
      const result = message.result as Record<string, unknown> | undefined;
      if (result?.protocolVersion !== undefined) {
        const caps = result.agentCapabilities as
          | Record<string, unknown>
          | undefined;
        context.note(`[acp] protocolVersion ${String(result.protocolVersion)}`);
        context.note(
          `[acp] authMethods ${JSON.stringify(result.authMethods ?? [])}`,
        );
        context.note(
          `[acp] promptCapabilities ${JSON.stringify(caps?.promptCapabilities ?? null)}`,
        );
      } else if (method && /^(session\/|authenticate)/.test(method)) {
        context.note(`[acp] ${direction} → ${method}`);
      }
      const error = message.error as
        | { code?: number; message?: string }
        | undefined;
      if (error) {
        context.note(
          `[acp] error ${String(error.code)}: ${String(error.message)}`,
        );
      }
      if (flags.verbose) context.note(`[frame] ${JSON.stringify(message)}`);
    },
  });

  const instanceId = randomBytes(4).toString("hex");
  const registration = await registerDevelopmentAgent({
    userDataPath: radiusUserDataPath(context.process.platform, context.env),
    agentId: config.agent,
    instanceId,
    displayName: config.name,
    endpoint: bridge.endpoint,
    token: bridge.token,
    cwd: context.cwd,
    ownerPid: context.process.pid,
    capabilities: config.capabilities.flatMap((capability) =>
      capability.operations.map((operation) => `${capability.key}.${operation}`),
    ),
  });

  // Launched after registration, never before: the descriptor is what the app
  // reads, so an app that opens first would briefly show nothing.
  const desktop = flags["no-open"]
    ? { launched: false, detail: "--no-open" }
    : await launchDesktopApp({
        platform: context.process.platform,
        env: context.env,
      });

  if (context.output === "json") {
    emitJson(context, {
      agentId: config.agent,
      displayName: config.name,
      endpoint: bridge.endpoint,
      descriptor: registration.path,
      harness: {
        command: harness.command,
        source: harness.source,
        cached: harness.cached,
      },
      desktop: { launched: desktop.launched, detail: desktop.detail },
    });
  } else {
    context.out(`${config.name} is running for Radius.`);
    context.out(`  harness     ${harness.command.join(" ")}`);
    context.out(`  endpoint    ${bridge.endpoint}`);
    context.out(`  descriptor  ${registration.path}`);
    if (desktop.launched) {
      context.out(`  desktop     opened ${desktop.detail}`);
      context.out("\nPick this agent in Radius. Ctrl-C to deregister.");
    } else {
      if (!flags["no-open"]) context.out(`  desktop     ${desktop.detail}`);
      context.out("\nOpen Radius and pick this agent. Ctrl-C to deregister.");
    }
  }

  try {
    await context.untilStopped();
  } finally {
    await registration.remove();
    await bridge.close();
  }
  // Surfaced through the caller so a failed spawn lands in the error taxonomy
  // rather than escaping as an uncaught exception.
  if (failure) throw failure;
}

export default handler<DevFlags, []>(run);
