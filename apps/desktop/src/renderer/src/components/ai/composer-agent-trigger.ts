export interface ComposerAgentTriggerPresentation {
  accessibleLabel: string;
  configurationLabel: string | null;
  showAgentLabel: boolean;
}

export function composerAgentTriggerPresentation({
  agentCount,
  agentLabel,
  modelLabel,
  thinkingEffortLabel,
}: {
  agentCount: number;
  agentLabel: string | null;
  modelLabel: string | null;
  thinkingEffortLabel: string | null;
}): ComposerAgentTriggerPresentation {
  if (!agentLabel) {
    return {
      accessibleLabel: "Select agent",
      configurationLabel: null,
      showAgentLabel: false,
    };
  }

  const configurationLabel =
    modelLabel && thinkingEffortLabel
      ? `${modelLabel} · ${thinkingEffortLabel}`
      : null;
  const accessibleLabel = [
    `Agent: ${agentLabel}`,
    modelLabel ? `Model: ${modelLabel}` : null,
    thinkingEffortLabel ? `Thinking effort: ${thinkingEffortLabel}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(". ");

  return {
    accessibleLabel,
    configurationLabel,
    showAgentLabel: agentCount > 1 || !configurationLabel,
  };
}
