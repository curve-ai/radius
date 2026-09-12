export interface DesktopAuthenticationStatus {
  state:
    | "checking"
    | "signed-out"
    | "awaiting-browser"
    | "preparing"
    | "ready"
    | "error";
  displayName: string;
  signInName: string;
  organizationName: string | null;
  errorCode: string | null;
}
