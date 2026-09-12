import { useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { Button } from "../../platform-web/components/ui/button";
import cityscape from "../../desktop/src/renderer/src/assets/auth-cityscape.webp";
import "./style.css";
import { authorizationLinkExpired } from "./authorization-state";

const client = createAuthClient({
  plugins: [emailOTPClient(), oauthProviderClient()],
});
const theme = window.matchMedia("(prefers-color-scheme: dark)");
const syncTheme = () =>
  document.documentElement.classList.toggle("dark", theme.matches);
syncTheme();
theme.addEventListener("change", syncTheme);

function redirect(data: unknown): boolean {
  const value = data as { redirect?: boolean; url?: string } | null;
  if (!value?.url || value.redirect === false) return false;
  const target = new URL(value.url, location.origin);
  if (target.username || target.password)
    throw new Error("Invalid return address");
  // Destinations come from Better Auth after it validates the client and callback.
  if (
    target.protocol !== "https:" &&
    !(
      target.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(target.hostname)
    )
  )
    throw new Error("Invalid return address");
  location.assign(target.href);
  return true;
}

function SignIn() {
  const consent = location.pathname === "/consent";
  const oauth = new URLSearchParams(location.search).has("client_id");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [google, setGoogle] = useState(false);
  const [clientName, setClientName] = useState("");
  const busy = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);
  useEffect(() => {
    let active = true;
    void fetch("/auth-ui/config", { cache: "no-store" })
      .then((r) => r.json())
      .then(
        (data) => {
          if (active) setGoogle(data.googleEnabled === true);
        },
        () => {
          if (active)
            setError("Sign-in is unavailable. Return to Radius and try again.");
        },
      );
    if (consent) {
      void client.oauth2
        .publicClient({
          query: {
            client_id: new URLSearchParams(location.search).get("client_id")!,
          },
        })
        .then((result) => {
          if (active)
            result.data
              ? setClientName(result.data.client_name || "Radius")
              : setError(
                  "This sign-in link has expired. Start again from Radius.",
                );
        });
    }
    return () => {
      active = false;
    };
  }, [consent]);
  async function perform(action: () => Promise<void>) {
    if (busy.current) return;
    if (authorizationLinkExpired(location.search)) {
      setError(
        "This sign-in link has expired. Return to Radius and start sign-in again.",
      );
      return;
    }
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await action();
    } catch {
      setError(
        "Sign-in could not be completed. Check your code, or start again from Radius if the link has expired.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    await perform(async () => {
      const result = await client.emailOtp.sendVerificationOtp({
        email: email.trim(),
        type: "sign-in",
      });
      if (result.error) throw new Error("Delivery failed");
      setStep("code");
      setCode("");
    });
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      const result = await client.signIn.emailOtp({
        email: email.trim(),
        otp: code,
      });
      if (result.error) throw new Error("Invalid code");
      if (redirect(result.data)) return;
      if (oauth) throw new Error("Missing authorization continuation");
      setStep("done");
    });
  }
  async function decide(accept: boolean) {
    await perform(async () => {
      const result = await client.oauth2.consent({ accept });
      if (result.error || !redirect(result.data))
        throw new Error("Consent failed");
    });
  }
  const field =
    "mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
  return (
    <main className="flex min-h-dvh items-center bg-background px-6 py-8 text-foreground">
      <div className="mx-auto grid min-h-[min(36rem,80dvh)] w-full max-w-6xl overflow-hidden rounded-lg bg-card lg:grid-cols-2">
        <section
          className="flex flex-col justify-center px-8 py-12 sm:px-14 lg:px-16"
          aria-busy={pending}
        >
          <div className="mx-auto w-full max-w-sm">
            <h1 className="type-md-lg font-normal">
              {consent
                ? "Connect to Radius"
                : step === "code"
                  ? "Check your email"
                  : step === "done"
                    ? "You’re signed in"
                    : "Sign in to Radius"}
            </h1>
            <p className="type-base mt-3 mb-8 text-muted-foreground">
              {consent
                ? `${clientName || "The application"} is requesting access to your identity.`
                : step === "code"
                  ? `Enter the six-digit code sent to ${email.trim()}.`
                  : step === "done"
                    ? "Return to Radius and continue sign-in to connect your workspace."
                    : "Use your account to continue to your workspace."}
            </p>
            {consent ? (
              <>
                <ul className="mb-6 space-y-2 text-sm">
                  {(new URLSearchParams(location.search).get("scope") ?? "")
                    .split(" ")
                    .filter(Boolean)
                    .map((scope) => (
                      <li key={scope}>
                        {(
                          {
                            openid: "Identify your account",
                            email: "Read your email address",
                            profile: "Read your name and profile",
                            offline_access: "Keep Radius signed in",
                          } as Record<string, string>
                        )[scope] ?? scope}
                      </li>
                    ))}
                </ul>
                <div className="flex gap-3">
                  <Button
                    size="lg"
                    variant="secondary"
                    disabled={pending || !clientName}
                    onClick={() => void decide(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="lg"
                    disabled={pending || !clientName}
                    onClick={() => void decide(true)}
                  >
                    Allow access
                  </Button>
                </div>
              </>
            ) : step === "email" ? (
              <>
                {google && (
                  <>
                    <Button
                      className="w-full mb-6"
                      size="lg"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        void perform(async () => {
                          const result = await client.signIn.social({
                            provider: "google",
                            callbackURL: location.href,
                          });
                          if (result.error)
                            throw new Error("Google sign-in failed");
                        })
                      }
                    >
                      Continue with Google
                    </Button>
                    <p className="mb-6 text-center text-sm text-muted-foreground">
                      or continue with email
                    </p>
                  </>
                )}
                <form onSubmit={send} className="space-y-4">
                  <div>
                    <label htmlFor="email" className="text-sm">
                      Email
                    </label>
                    <input
                      className={field}
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={pending}
                    />
                  </div>
                  <Button className="w-full" size="lg" disabled={pending}>
                    {pending ? "Sending code…" : "Continue with email"}
                  </Button>
                </form>
              </>
            ) : step === "code" ? (
              <form onSubmit={verify} className="space-y-4">
                <div>
                  <label htmlFor="code" className="text-sm">
                    Sign-in code
                  </label>
                  <input
                    ref={codeInput}
                    className={`${field} text-center tracking-[0.4em]`}
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    minLength={6}
                    maxLength={6}
                    required
                    value={code}
                    disabled={pending}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <Button
                  className="w-full"
                  size="lg"
                  disabled={pending || code.length !== 6}
                >
                  {pending ? "Signing in…" : "Continue"}
                </Button>
                <div className="flex justify-between">
                  <Button
                    type="button"
                    variant="link"
                    disabled={pending}
                    onClick={() => setStep("email")}
                  >
                    Change email
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    disabled={pending}
                    onClick={() => void send()}
                  >
                    Resend code
                  </Button>
                </div>
              </form>
            ) : null}
            {error && (
              <p role="alert" className="mt-5 text-sm text-destructive">
                {error}
              </p>
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
  );
}
createRoot(document.getElementById("root")!).render(<SignIn />);
