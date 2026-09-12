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

export function composerSessionModelConfig(
  options: readonly ComposerSessionConfigOption[],
): ComposerSessionConfigOption | null {
  return (
    options.find((option) => option.id === "model") ??
    options.find(
      (option) =>
        option.category === "model" && option.label.toLowerCase() === "model",
    ) ??
    null
  );
}

export function composerSessionThinkingConfig(
  options: readonly ComposerSessionConfigOption[],
): ComposerSessionConfigOption | null {
  return (
    options.find((option) => option.id === "effort") ??
    composerSessionConfigByCategory(options, "thought_level")
  );
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

export interface ComposerContextUsagePresentation {
  accessibleLabel: string;
  percentageUsed: number;
  percentageLeft: number;
  sizeLabel: string;
  usedLabel: string;
}

export function composerContextUsagePresentation(
  usage: ComposerContextUsage | null,
): ComposerContextUsagePresentation | null {
  if (
    !usage ||
    !Number.isFinite(usage.used) ||
    !Number.isFinite(usage.size) ||
    usage.used < 0 ||
    usage.size <= 0
  ) {
    return null;
  }
  const percentageUsed = Math.round(
    Math.min(1, Math.max(0, usage.used / usage.size)) * 100,
  );
  const percentageLeft = 100 - percentageUsed;
  const usedLabel = formatTokenCount(usage.used);
  const sizeLabel = formatTokenCount(usage.size);
  return {
    accessibleLabel: `Context window: ${percentageUsed}% used, ${percentageLeft}% left. ${usedLabel} of ${sizeLabel} tokens used.`,
    percentageUsed,
    percentageLeft,
    sizeLabel,
    usedLabel,
  };
}

function formatTokenCount(value: number): string {
  if (value < 1_000) return Math.round(value).toLocaleString();
  const unit = value >= 1_000_000 ? "m" : "k";
  const divisor = value >= 1_000_000 ? 1_000_000 : 1_000;
  const scaled = value / divisor;
  const fractionDigits = scaled < 10 && !Number.isInteger(scaled) ? 1 : 0;
  return `${scaled.toFixed(fractionDigits).replace(/\.0$/, "")}${unit}`;
}
