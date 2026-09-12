import { useEffect, useState, type ReactNode } from "react";
import type { DesktopAuthenticationStatus } from "../../../../auth-types";
import { Button } from "@renderer/components/ui/button";
import cityscape from "@renderer/assets/auth-cityscape.webp";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "@renderer/components/ui/motion";
import { AuthenticationContext } from "./authentication-context";
import { StartupScreen, STARTUP_EASE } from "./startup-screen";
import { authenticationSurface } from "./startup-state";

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
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    const timer = window.setTimeout(() => setMinimumElapsed(true), 180);
    return () => window.clearTimeout(timer);
  }, []);
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
              current.errorCode === value.errorCode &&
              current.profile?.displayName === value.profile?.displayName &&
              current.profile?.email === value.profile?.email
                ? current
                : value,
            );
            setFailed(false);
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
  }, [retryKey]);
  const waiting = status?.state === "awaiting-browser";
  const preparing =
    !status || status.state === "checking" || status.state === "preparing";
  const title = waiting
    ? "Continue in your browser"
    : preparing
      ? "Getting ready"
      : `Sign in to ${status?.displayName ?? "Radius"}`;
  const signInName = status?.signInName ?? "Radius";
  const surface = authenticationSurface(status?.state, minimumElapsed);
  const detail = waiting
    ? `Finish signing in with ${signInName}. We’ll bring you back here when you’re ready.`
    : preparing
      ? "Checking your account and preparing your workspace."
      : `Use your ${signInName} account to continue.`;
  const act = (action: () => Promise<unknown>): void =>
    void action().catch(() => setFailed(true));
  const signInPanel = (
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
  return (
    <AuthenticationContext.Provider value={status}>
      <AnimatePresence initial={false} mode="wait">
        {surface === "startup" ? (
          <StartupScreen
            key="startup"
            label={status?.displayName ?? "Radius"}
            failed={failed}
            retry={() => {
              setFailed(false);
              setRetryKey((key) => key + 1);
            }}
          />
        ) : surface === "workspace" ? (
          <motion.div
            key="workspace"
            className="radius-authenticated-workspace"
            initial={{
              opacity: 0,
              transform: reduced ? "none" : "translateY(8px)",
            }}
            animate={{ opacity: 1, transform: "none" }}
            exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{ duration: reduced ? 0.1 : 0.24, ease: STARTUP_EASE }}
          >
            {children}
          </motion.div>
        ) : (
          <motion.div
            key="sign-in"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.1 : 0.16, ease: STARTUP_EASE }}
          >
            {signInPanel}
          </motion.div>
        )}
      </AnimatePresence>
    </AuthenticationContext.Provider>
  );
}
