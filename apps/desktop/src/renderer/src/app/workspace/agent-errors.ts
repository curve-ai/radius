const MISSING_AGENT_HANDLER =
  /No handler registered for ['"]radius:(?:list-agents|connect-agent-authentication|disconnect-agent-authentication)['"]/;

export function agentErrorMessage(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  if (MISSING_AGENT_HANDLER.test(message)) {
    return "Radius was updated while it was running. Restart Radius to finish loading agent support.";
  }
  if (message.includes("AGENT_RELEASE_IMMUTABLE_CONFLICT")) {
    return "This agent package changed without a new version. Publish it under a new version, then restart Radius.";
  }
  if (message.includes("AGENT_RELEASE_IMAGE_CONFLICT")) {
    return "This agent update does not match its image. Radius kept the installed version; rebuild the agent package and try again.";
  }
  if (message.includes("AGENT_AUTH_CONFIGURATION_CONFLICT")) {
    return "This agent's sign-in configuration conflicts with an installed agent. Update the package configuration, then restart Radius.";
  }
  if (message.includes("FX_LOGIN_TIMEOUT")) {
    return "Codex sign-in timed out. Try connecting again.";
  }
  if (message.includes("FX_BINARY_NOT_INSTALLED")) {
    return "The fx runtime is not included in this Radius build.";
  }
  if (message.includes("AGENT_AUTHENTICATION_UNSUPPORTED")) {
    return "This agent does not support sign-in from Radius.";
  }
  if (message.includes("The selected local agent is not installed")) {
    return "This agent is no longer installed. Refresh Agents and choose another.";
  }
  return fallback;
}
