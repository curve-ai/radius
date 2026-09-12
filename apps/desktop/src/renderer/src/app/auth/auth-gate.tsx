import { useEffect, useState, type ReactNode } from "react";
import type { DesktopAuthenticationStatus } from "../../../../auth-types";
import { Button } from "@renderer/components/ui/button";
import cityscape from "@renderer/assets/auth-cityscape.webp";

const messages: Record<string, string> = {
  AUTH_CANCELLED: "Sign-in was cancelled. You can try again when you’re ready.",
  AUTH_TIMEOUT: "Sign-in timed out. Start again to get a new link.",
  AUTH_CALLBACK_UNAVAILABLE:
    "Another sign-in is using the return address. Close it and try again.",
  AUTH_BROWSER_UNAVAILABLE: "Your browser could not be opened. Try again.",
  AUTH_PROFILE_MISMATCH:
    "This installation belongs to another account. Sign in with the account you used on this Mac.",
  AUTH_SESSION_EXPIRED: "Your session has expired. Sign in again to continue.",
};

/** Layout adapted from OpenCapital's auth-shell.tsx; see UI provenance. */
export function AuthGate({ children }: { children: ReactNode }): ReactNode {
  const [status, setStatus] = useState<DesktopAuthenticationStatus | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const read = (): void =>
      void window.radius.authenticationStatus().then(
        (value) => {
          if (active) {
            setStatus((current) =>
              current?.state === value.state &&
              current.displayName === value.displayName &&
              current.signInName === value.signInName &&
              current.organizationName === value.organizationName &&
              current.errorCode === value.errorCode
                ? current
                : value,
            );
            setFailed(false);
            // Local-only mode is fixed by the bundle and cannot sign out.
            if (value.state === "local") window.clearInterval(interval);
          }
        },
        () => {
          if (active) setFailed(true);
        },
      );
    const interval = window.setInterval(read, 500);
    read();
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);
  if (status?.state === "local" || status?.state === "ready") return children;
  const waiting = status?.state === "awaiting-browser";
  const preparing =
    !status || status.state === "checking" || status.state === "preparing";
  const title = waiting
    ? "Continue in your browser"
    : preparing
      ? "Getting ready"
      : `Sign in to ${status.displayName}`;
  const signInName = status?.signInName ?? "Curve";
  const detail = waiting
    ? `Finish signing in with ${signInName}. We’ll bring you back here when you’re ready.`
    : preparing
      ? "Checking your account and preparing your workspace."
      : `Use your ${signInName} account to continue.`;
  const act = (action: () => Promise<unknown>): void =>
    void action().catch(() => setFailed(true));
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header
        className="h-12 shrink-0 [app-region:drag]"
        onDoubleClick={() => void window.radius.handleTitlebarDoubleClick()}
      />
      <main
        id="main-content"
        className="flex min-h-0 flex-1 items-center overflow-auto px-6 pb-6"
        aria-busy={preparing}
      >
        <div className="mx-auto grid min-h-[min(36rem,80dvh)] w-full max-w-6xl overflow-hidden rounded-lg bg-card lg:grid-cols-2">
          <section className="flex flex-col justify-center px-8 py-12 sm:px-14 lg:px-16">
            <div className="mx-auto w-full max-w-sm">
              <div className="mb-8" aria-live="polite">
                <h1 className="type-md-lg text-balance font-normal">{title}</h1>
                <p className="type-base mt-3 text-pretty text-muted-foreground">
                  {detail}
                </p>
              </div>
              {status?.errorCode && (
                <p role="alert" className="mb-5 text-sm text-destructive">
                  {status.errorCode === "AUTH_NOT_CONFIGURED" ||
                  status.errorCode === "AUTH_CONFIGURATION_INVALID"
                    ? `Sign-in is not available for this app. Contact ${signInName} for help.`
                    : (messages[status.errorCode] ??
                      "Sign-in could not be completed. Check your connection and try again.")}
                </p>
              )}
              {failed && (
                <p role="alert" className="mb-5 text-sm text-destructive">
                  The application could not finish this request. Please try
                  again.
                </p>
              )}
              {!preparing && !waiting && (
                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => act(() => window.radius.signIn())}
                >
                  Continue in browser
                </Button>
              )}
              {(waiting || (preparing && status)) && (
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full"
                  onClick={() => act(() => window.radius.cancelSignIn())}
                >
                  Cancel
                </Button>
              )}
            </div>
          </section>
          <aside
            className="relative hidden overflow-hidden lg:block"
            aria-hidden="true"
          >
            <img
              src={cityscape}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          </aside>
        </div>
      </main>
    </div>
  );
}
