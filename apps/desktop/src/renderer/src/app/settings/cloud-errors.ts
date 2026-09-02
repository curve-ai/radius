/**
 * Connect-time failures from `authenticateCloud`. The raw code is kept in the
 * message because it is the only diagnostic a user can quote in a report.
 */
export function cloudConnectMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause ?? "");

  if (raw.includes("CLOUD_AUTH_SIGN_IN_UNAVAILABLE")) {
    return "That sign-in address never showed a sign-in page. Check the address and try again (CLOUD_AUTH_SIGN_IN_UNAVAILABLE).";
  }
  if (raw.includes("CLOUD_AUTH_CANCELLED")) {
    return "Sign-in did not finish. Connect again and complete sign-in in the window Radius opens (CLOUD_AUTH_CANCELLED).";
  }
  if (raw.includes("CLOUD_AUTH_TIMEOUT")) {
    return "Sign-in timed out before it finished. Connect again (CLOUD_AUTH_TIMEOUT).";
  }
  if (raw.includes("CLOUD_AUTH_LOAD_FAILED")) {
    return "Radius could not open that sign-in address. Check the address and that the server is running (CLOUD_AUTH_LOAD_FAILED).";
  }
  if (raw.includes("SYNC_DISABLED")) {
    return "This server has sync turned off (SYNC_DISABLED).";
  }
  return raw.length > 0 ? raw : "Radius could not connect to the server";
}
