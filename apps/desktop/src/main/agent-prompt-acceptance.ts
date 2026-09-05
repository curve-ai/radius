export async function acceptAgentPrompt(input: {
  activate(): Promise<void>;
  appendPrompt(): Promise<void>;
  assertCapabilities(): void;
  recordAgentRun(): Promise<void>;
}): Promise<void> {
  input.assertCapabilities();
  await input.appendPrompt();
  await input.recordAgentRun();
  await input.activate();
}
