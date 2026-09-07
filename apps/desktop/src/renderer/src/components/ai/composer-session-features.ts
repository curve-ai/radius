import type {
  DesktopAgentSessionConfigOption,
  DesktopAgentSessionFeatures,
} from "../../../../radius-api";

export type ComposerSessionConfigOption = DesktopAgentSessionConfigOption;
export type ComposerSlashCommand =
  DesktopAgentSessionFeatures["availableCommands"][number];
export type ComposerContextUsage = NonNullable<
  DesktopAgentSessionFeatures["usage"]
>;
export type ComposerSessionModes = NonNullable<
  DesktopAgentSessionFeatures["modes"]
>;

export interface ComposerSessionConfigChoice {
  id: string;
  label: string;
}

export function composerSessionConfigChoices(
  option: ComposerSessionConfigOption,
): ComposerSessionConfigChoice[] {
  if (option.type === "boolean") {
    return [
      { id: "true", label: "On" },
      { id: "false", label: "Off" },
    ];
  }
  return option.options.map((entry) => ({ id: entry.id, label: entry.label }));
}

export function composerSessionConfigSelectedId(
  option: ComposerSessionConfigOption,
): string {
  return option.type === "boolean"
    ? String(option.currentValue)
    : option.currentValue;
}

export function composerSessionConfigValueLabel(
  option: ComposerSessionConfigOption,
): string {
  const selectedId = composerSessionConfigSelectedId(option);
  return (
    composerSessionConfigChoices(option).find(
      (choice) => choice.id === selectedId,
    )?.label ?? selectedId
  );
}

export function composerSessionConfigValue(
  option: ComposerSessionConfigOption,
  selectedId: string,
): string | boolean {
  return option.type === "boolean" ? selectedId === "true" : selectedId;
}

export function composerSessionConfigByCategory(
  options: readonly ComposerSessionConfigOption[],
  category: string,
): ComposerSessionConfigOption | null {
  return options.find((option) => option.category === category) ?? null;
}

export function composerLegacyModeFallback(
  configOptions: readonly ComposerSessionConfigOption[] | undefined,
  modes: ComposerSessionModes | null | undefined,
): ComposerSessionModes | null {
  if (
    !configOptions ||
    composerSessionConfigByCategory(configOptions, "mode")
  ) {
    return null;
  }
  return modes && modes.availableModes.length > 0 ? modes : null;
}

export function matchingComposerSlashCommands(
  prompt: string,
  commands: readonly ComposerSlashCommand[],
): ComposerSlashCommand[] {
  const match = /^\/([^\s]*)$/.exec(prompt);
  if (!match) return [];
  const query = match[1]!.toLocaleLowerCase();
  return commands.filter((command) =>
    command.name.toLocaleLowerCase().startsWith(query),
  );
}

export function composerSlashCommandPrompt(
  command: ComposerSlashCommand,
): string {
  return `/${command.name}${command.inputHint ? " " : ""}`;
}

export function composerSlashCommandShouldSubmit(
  prompt: string,
  command: ComposerSlashCommand,
): boolean {
  return command.inputHint === null && prompt === `/${command.name}`;
}

export function composerContextUsageLabel(
  usage: ComposerContextUsage | null,
): string | null {
  if (!usage) return null;
  const parts: string[] = [];
  if (
    Number.isFinite(usage.used) &&
    Number.isFinite(usage.size) &&
    usage.size > 0
  ) {
    const percentage = Math.round(
      Math.min(1, Math.max(0, usage.used / usage.size)) * 100,
    );
    parts.push(`${percentage}% context`);
  }
  if (usage.cost && Number.isFinite(usage.cost.amount)) {
    parts.push(formatCost(usage.cost.amount, usage.cost.currency));
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

function formatCost(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: amount < 1 ? 3 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(amount < 1 ? 3 : 2)} ${currency}`.trim();
  }
}
