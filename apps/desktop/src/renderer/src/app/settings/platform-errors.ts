/**
 * Connect-time failures from the main process. The raw code is kept in the
 * message because it is the only diagnostic a user can quote in a report.
 */
export function platformConnectMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause ?? "");

  if (raw.includes("PLATFORM_SIGN_IN_UNAVAILABLE")) {
    return "That address never showed a sign-in page. Check the address and try again (PLATFORM_SIGN_IN_UNAVAILABLE).";
  }
  if (raw.includes("PLATFORM_AUTH_CANCELLED")) {
    return "Sign-in did not finish. Connect again and complete sign-in in the window Radius opens (PLATFORM_AUTH_CANCELLED).";
  }
  if (raw.includes("PLATFORM_AUTH_TIMEOUT")) {
    return "Sign-in timed out before it finished. Connect again (PLATFORM_AUTH_TIMEOUT).";
  }
  if (raw.includes("PLATFORM_AUTH_LOAD_FAILED")) {
    return "Radius could not open that address. Check the address and that the server is running (PLATFORM_AUTH_LOAD_FAILED).";
  }
  if (raw.includes("PLATFORM_UNREACHABLE")) {
    return "Radius could not reach that address. Check the address and that the server is running (PLATFORM_UNREACHABLE).";
  }
  if (raw.includes("PLATFORM_NOT_FOUND")) {
    return "That address answered, but it is not a Radius platform (PLATFORM_NOT_FOUND).";
  }
  if (raw.includes("ORGANIZATION_HOST_MISMATCH")) {
    return "Your account does not belong to the organization at that address (ORGANIZATION_HOST_MISMATCH).";
  }
  if (raw.includes("PLATFORM_NO_ORGANIZATION")) {
    return "Your account is not a member of any organization on that platform (PLATFORM_NO_ORGANIZATION).";
  }
  if (raw.includes("CLOUD_SETUP_TIMEOUT")) {
    return "Your workspace is still being set up. Try connecting again in a few minutes (CLOUD_SETUP_TIMEOUT).";
  }
  if (raw.includes("CLOUD_SETUP_FAILED")) {
    return "Curve Cloud could not finish setting up your workspace. Retry setup from the Cloud dashboard (CLOUD_SETUP_FAILED).";
  }
  if (raw.includes("SYNC_MEMBERSHIP_NOT_FOUND")) {
    return "You were removed from this organization, so syncing has stopped (SYNC_MEMBERSHIP_NOT_FOUND).";
  }
  return raw.length > 0 ? raw : "Radius could not connect to the platform";
}
