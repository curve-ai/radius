export interface FxThinkingEffort {
  id: string;
  label: string;
}

const DEFAULT_EFFORT: FxThinkingEffort = { id: "auto", label: "Default" };
const GPT_5_4_EFFORTS: readonly FxThinkingEffort[] = [
  { id: "none", label: "None" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
];
const GPT_5_6_EFFORTS: readonly FxThinkingEffort[] = [
  ...GPT_5_4_EFFORTS,
  { id: "max", label: "Max" },
];

function unqualifiedModelId(modelId: string): string {
  return modelId.split("/").at(-1) ?? modelId;
}

export function fxThinkingEffortsForModel(modelId: string): FxThinkingEffort[] {
  const id = unqualifiedModelId(modelId);
  if (id.startsWith("gpt-5.6-")) return [DEFAULT_EFFORT, ...GPT_5_6_EFFORTS];
  if (id === "gpt-5.5" || id === "gpt-5.4" || id === "gpt-5.4-mini") {
    return [DEFAULT_EFFORT, ...GPT_5_4_EFFORTS];
  }
  return [];
}

export function applyFxThinkingEffort(
  settingsJson: string | null,
  thinkingEffortId: string,
): string {
  const parsed: unknown = settingsJson ? JSON.parse(settingsJson) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("FX_SETTINGS_INVALID");
  }
  const settings = parsed as Record<string, unknown>;
  settings.effort = thinkingEffortId;
  return `${JSON.stringify(settings)}\n`;
}
