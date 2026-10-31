import { randomBytes } from "node:crypto";

import { startBridge } from "../../bridge.js";
import { loadConfig } from "../../config.js";
import { emitJson, type RadiusContext } from "../../context.js";
import { launchDesktopApp } from "../../desktop.js";
import { handler } from "../../handler.js";
import { handshakeOverStdio } from "../../handshake.js";
import {
  radiusUserDataPath,
  registerDevelopmentAgent,
} from "../../registration.js";
import { resolveStartCommand } from "../../start-command.js";
import { OperationalError } from "../../errors.js";

interface DevFlags {
  readonly verbose: boolean;
  readonly "no-open": boolean;
}

async function run(this: RadiusContext, flags: DevFlags): Promise<void> {
  const context = this;
  const verbose = (message: string): void => {
    if (flags.verbose) context.note(message);
  };
  const config = await loadConfig(context.cwd);
  if (!config.agent) {
    throw new OperationalError(
      "This config has no agent id.",
      "Run `radius init --harness <id>` to assign one.",
    );
  }

  const start = await resolveStartCommand(
    config,
    context.cwd,
    {
      platform: context.process.platform,
      arch: context.process.arch,
      env: context.env,
    },
    (message) => context.note(message),
  );

  // Once the bridge is up, a harness that will not start is just a thread
  // that fails, and `dev` keeps serving. So the one check that should stop
  // `dev` happens here, before anything is registered: a registration whose
  // every thread dies is worse than an error.
  verbose(`[radius] preflight ${start.command.join(" ")}`);
  const preflight = await handshakeOverStdio({
    command: start.command,
    cwd: context.cwd,
    env: context.env,
    onStderr: (line) => verbose(`[preflight] ${line}`),
    onStdout: (line) => verbose(`[preflight] ${line}`),
  });
  verbose(`[acp] protocolVersion ${String(preflight.protocolVersion)}`);
  verbose(`[acp] authMethods ${JSON.stringify(preflight.authMethods)}`);

  const bridge = await startBridge(start.command, context.cwd, context.env, {
    // Harness stderr stays visible by default: it is where a harness says
    // why a thread failed. Prefixed so two threads' output can be told apart.
    onStdout: (id, line) => context.note(`  [${id}] ${line}`),
    onStderr: (id, line) => context.note(`  [${id}] ${line}`),
    onExit: (id, code, signal) => {
      // No restart and no stop: the thread is gone, and the next one the
      // desktop opens gets a fresh process anyway.
      context.note(
        `  [${id}] harness exited (${signal ? `signal ${signal}` : `code ${String(code)}`})`,
      );
    },
    onSpawnError: (id, error) => {
      context.note(`  [${id}] ${error.message}`);
    },
    onConnect: (id) => context.note(`  [${id}] thread opened`),
    onDisconnect: (id) => context.note(`  [${id}] thread closed`),
    onFrame: (id, direction, message) => {
      // Logged live rather than accumulated: a silent log once made a working
      // session look like a dead one, and a long-lived `dev` must not grow a
      // transcript in memory.
      const error = message.error as
        { code?: number; message?: string } | undefined;
      if (error) {
        context.note(
          `  [${id}] acp error ${String(error.code)}: ${String(error.message)}`,
        );
      }
      if (!flags.verbose) return;
      const method = typeof message.method === "string" ? message.method : null;
      const result = message.result as Record<string, unknown> | undefined;
      if (result?.protocolVersion !== undefined) {
        const caps = result.agentCapabilities as
          Record<string, unknown> | undefined;
        context.note(
          `  [${id}] [acp] protocolVersion ${String(result.protocolVersion)}`,
        );
        context.note(
          `  [${id}] [acp] authMethods ${JSON.stringify(result.authMethods ?? [])}`,
        );
        context.note(
          `  [${id}] [acp] promptCapabilities ${JSON.stringify(caps?.promptCapabilities ?? null)}`,
        );
      } else if (method && /^(session\/|authenticate)/.test(method)) {
        context.note(`  [${id}] [acp] ${direction} → ${method}`);
      }
      context.note(`  [${id}] [frame] ${JSON.stringify(message)}`);
    },
  });

  const instanceId = randomBytes(4).toString("hex");
  // From here on the bridge owns a listening socket and, once a thread opens,
  // child processes, so every later step runs where a throw can still close
  // them. Without this a failed registration left the CLI hanging.
  try {
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
        capability.operations.map(
          (operation) => `${capability.key}.${operation}`,
        ),
      ),
    });

    // Launched after registration, never before: the descriptor is what the
    // app reads, so an app that opens first would briefly show nothing.
    const desktop = flags["no-open"]
      ? { launched: false, detail: "--no-open" }
      : await launchDesktopApp({
          platform: context.process.platform,
          env: context.env,
          projectRoot: context.cwd,
        });

    if (context.output === "json") {
      emitJson(context, {
        agentId: config.agent,
        displayName: config.name,
        kind: start.kind,
        command: start.command,
        agents: preflight.advertisedAgents,
        authRequired: preflight.authRequired,
        authMethods: preflight.authMethods,
        endpoint: bridge.endpoint,
        descriptor: registration.path,
        ...(start.harness
          ? {
              harness: {
                command: start.command,
                source: start.harness.source,
                cached: start.harness.cached,
              },
            }
          : {}),
        desktop: { launched: desktop.launched, detail: desktop.detail },
      });
    } else {
      const details = [start.summary];
      if (preflight.advertisedAgents.length > 0) {
        details.push(`agents: ${preflight.advertisedAgents.join(", ")}`);
      }
      if (preflight.authRequired) details.push("sign-in required");
      context.out(
        `✓ ${config.name} ready in Radius   (${details.join(" · ")})`,
      );
      if (flags.verbose) {
        context.out(`  command     ${start.command.join(" ")}`);
        if (start.harness) {
          context.out(
            `  source      ${start.harness.source}${start.harness.cached ? " (cached)" : ""}`,
          );
        }
        context.out(`  endpoint    ${bridge.endpoint}`);
        context.out(`  descriptor  ${registration.path}`);
        context.out(`  desktop     ${desktop.detail}`);
      }
      // Only said when it changes what the developer does next.
      if (!desktop.launched && !flags["no-open"]) {
        context.out(`  Open Radius and pick this agent (${desktop.detail}).`);
      }
      context.out("Ctrl-C to stop.");
    }

    try {
      await context.untilStopped();
    } finally {
      await registration.remove();
    }
  } finally {
    // Closes whether registration succeeded, the session ended normally, or
    // anything in between threw — and takes every thread's harness with it.
    await bridge.close();
  }
}

export default handler<DevFlags, []>(run);
