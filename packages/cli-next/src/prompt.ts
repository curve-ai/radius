import { createInterface } from "node:readline/promises";

import type { RadiusContext } from "./context.js";
import { UsageError } from "./errors.js";

/**
 * Asking the user for something, under ADR-008's one rule:
 *
 *   "A command may prompt only when standard input is a TTY, `--json` is unset,
 *    and no `--yes` or `--non-interactive` flag is present. Otherwise it fails
 *    immediately and names the flag that would have supplied the answer."
 *
 * The check lives here rather than in each command, because a CLI that blocks
 * on a prompt in CI does not fail visibly — it hangs until something else
 * times out.
 *
 * Built on `node:readline`, not Ink. ADR-008 reserves Ink for `dev`'s
 * supervision TUI and keeps it off the startup path; a question and an answer
 * do not need a renderer.
 */

export interface PromptGate {
  readonly yes: boolean;
}

export function canPrompt(
  context: RadiusContext,
  flags: PromptGate,
): boolean {
  return context.isTTY && context.output !== "json" && !flags.yes;
}

/**
 * Refuses in the same shape every time, so a script author learns one rule:
 * whatever you were asked for, there is a flag that supplies it.
 */
export function requireFlag(name: string, detail?: string): never {
  throw new UsageError(
    [
      `This needs ${name}, and there is nobody to ask.`,
      detail,
      "",
      `Pass ${name}, or run it in a terminal without --json or --yes.`,
    ]
      .filter((line) => line !== undefined)
      .join("\n"),
  );
}

async function ask(
  context: RadiusContext,
  question: string,
): Promise<string> {
  // Created per question and closed immediately: a lingering readline
  // interface keeps stdin open and the process never exits.
  const rl = createInterface({ input: process.stdin, output: context.process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function promptText(
  context: RadiusContext,
  input: { readonly label: string; readonly fallback?: string },
): Promise<string> {
  const suffix = input.fallback ? ` [${input.fallback}]` : "";
  for (;;) {
    const answer = await ask(context, `${input.label}${suffix}: `);
    if (answer) return answer;
    if (input.fallback) return input.fallback;
    context.note("That cannot be empty.");
  }
}

export interface Choice {
  readonly value: string;
  readonly hint?: string;
}

/**
 * A named choice from a long list.
 *
 * Forty-odd options is too many to print as a numbered menu, so this takes a
 * typed answer and helps when it misses: an exact match wins, a unique prefix
 * or substring is accepted, and anything else lists what nearly matched
 * rather than only saying no.
 */
export async function promptChoice(
  context: RadiusContext,
  input: {
    readonly label: string;
    readonly choices: readonly Choice[];
    readonly fallback?: string;
  },
): Promise<string> {
  const values = input.choices.map((choice) => choice.value);
  context.note(`${input.choices.length} available — type "?" to list them.`);

  for (;;) {
    const answer = await promptText(context, {
      label: input.label,
      fallback: input.fallback,
    });

    if (answer === "?") {
      for (const choice of input.choices) {
        context.note(`  ${choice.value}${choice.hint ? `  ${choice.hint}` : ""}`);
      }
      continue;
    }
    if (values.includes(answer)) return answer;

    const near = values.filter((value) =>
      value.toLowerCase().includes(answer.toLowerCase()),
    );
    if (near.length === 1) return near[0]!;
    if (near.length > 1) {
      context.note(`"${answer}" matches ${near.length}: ${near.join(", ")}`);
    } else {
      context.note(`No match for "${answer}". Type "?" to list them.`);
    }
  }
}
