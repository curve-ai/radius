import type { AgentConfig } from "@curve-ai/agent-contracts";

import { checkAgent, type CheckResult, type Verdict } from "../../check.js";
import { loadConfig } from "../../config.js";
import { emitJson, emitJsonError, type RadiusContext } from "../../context.js";
import { EXIT_OPERATIONAL, UsageError } from "../../errors.js";
import { handler } from "../../handler.js";
import { resolveHarness } from "../../harness.js";

interface CheckFlags {
  readonly verbose: boolean;
  readonly timeout: number;
  readonly json: boolean;
}

async function run(this: RadiusContext, flags: CheckFlags): Promise<void> {
  const context = this;
  const root = context.cwd;
  const config = await loadConfig(root);
  const command = await startCommand(config, root, context);

  context.out(`checking ${config.name}`);
  context.out(`  command   ${command.join(" ")}`);
  context.out("");

  const result = await checkAgent({
    command,
    root,
    env: context.env,
    timeoutMs: flags.timeout * 1000,
    abort: context.untilStopped(),
    onFrame: flags.verbose
      ? (direction, message) =>
          context.note(
            `[frame] ${direction === "client" ? "→" : "←"} ${JSON.stringify(message)}`,
          )
      : undefined,
  });

  if (flags.verbose && result.probe.stderrTail.trim()) {
    context.note("[stderr]");
    context.note(result.probe.stderrTail.trimEnd());
  }

  // Recorded before printing, so a failed check exits 1 whichever way it is
  // reported. A check that ran and found a problem is an operational
  // failure: the CLI worked, the agent did not.
  if (!result.passed) context.fail(EXIT_OPERATIONAL);

  if (context.output === "json") {
    const data = toJson(result);
    if (result.passed) emitJson(context, data);
    else
      emitJsonError(
        context,
        { code: "OPERATIONAL", message: headline(result) },
        data,
      );
    return;
  }

  for (const verdict of result.verdicts) render(context, verdict);
  context.out("");
  context.out(
    result.passed
      ? `passed in ${seconds(result.probe.elapsedMs)}`
      : headline(result),
  );
}

/**
 * Only a harness has a start command this CLI can resolve today. The other
 * kinds are refused by name rather than guessed at: a check that probed the
 * wrong command would report on an agent nobody runs.
 */
async function startCommand(
  config: AgentConfig,
  root: string,
  context: RadiusContext,
): Promise<readonly string[]> {
  if (config.runtime.kind !== "harness") {
    throw new UsageError(
      `radius check does not support runtime.kind "${config.runtime.kind}" yet — only "harness".`,
    );
  }
  const harness = await resolveHarness(
    config,
    root,
    { platform: context.process.platform, arch: context.process.arch },
    (message) => context.note(message),
  );
  return harness.command;
}

function render(context: RadiusContext, verdict: Verdict): void {
  const mark =
    verdict.status === "pass" ? "✓" : verdict.status === "fail" ? "✗" : "–";
  context.out(`${mark} ${verdict.summary}`);
  for (const line of verdict.detail) context.out(`    ${line}`);
}

function headline(result: CheckResult): string {
  const failed = result.verdicts.filter((verdict) => verdict.status === "fail");
  return failed.length === 1
    ? `check failed: ${failed[0]!.summary}`
    : `${failed.length} checks failed`;
}

function toJson(result: CheckResult): Record<string, unknown> {
  return {
    passed: result.passed,
    command: result.command,
    protocolVersion: result.protocolVersion,
    agentInfo: result.agentInfo,
    advertisedAgents: result.advertisedAgents,
    project: result.project,
    stage: result.probe.stage,
    failure: result.probe.failure,
    stdoutNoise: result.probe.stdoutNoise,
    stderrTail: result.probe.stderrTail,
    elapsedMs: result.probe.elapsedMs,
    verdicts: result.verdicts,
  };
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export default handler<CheckFlags, []>(run);
