import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, Loader2, LogIn } from "lucide-react";

import { Alert, AlertDescription } from "@renderer/components/ui/alert";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "@renderer/components/ui/motion";
import { Separator } from "@renderer/components/ui/separator";
import { Switch } from "@renderer/components/ui/switch";
import { ThemeSwitch } from "@renderer/components/ui/theme-switch";
import { cn } from "@renderer/lib/utils";
import { SETTINGS_SECTIONS } from "@renderer/components/shell/settings-sections";

type SyncStatus = Awaited<ReturnType<Window["radius"]["syncStatus"]>>;
const SETTINGS_MOTION_EASE = [0.23, 1, 0.32, 1] as const;

export function SettingsPage(): ReactNode {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [frontendUrl, setFrontendUrl] = useState("http://localhost:3300");
  const [apiUrl, setApiUrl] = useState("http://localhost:3100");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let active = true;
    void window.radius
      .syncStatus()
      .then((nextStatus) => {
        if (active) setStatus(nextStatus);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof Error ? cause.message : "Could not load sync status",
        );
      });

    return () => {
      active = false;
    };
  }, []);

  const enabled = status !== null && status.state !== "disabled";
  const providerConfigured = status?.providerKey != null;
  const providerLabel =
    status?.providerKey === "curve-cloud"
      ? "Radius Cloud"
      : status?.providerKey === "http"
        ? "Custom HTTP"
        : "Not configured";
  const platformLabel =
    window.radius.platform === "darwin"
      ? "macOS"
      : window.radius.platform === "win32"
        ? "Windows"
        : "Linux";
  const errorMessage = error ?? status?.errorCode ?? null;

  const toggleSync = async (nextEnabled: boolean): Promise<void> => {
    setError(null);
    if (nextEnabled && !providerConfigured) {
      setProviderOpen(true);
      return;
    }

    setBusy(true);
    try {
      setStatus(await window.radius.setSyncEnabled(nextEnabled));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update sync",
      );
    } finally {
      setBusy(false);
    }
  };

  const connectProvider = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setStatus(await window.radius.connectCloud({ frontendUrl, apiUrl }));
      setProviderOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not connect provider",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[800px] px-10 pb-20 pt-[4.25rem]">
      <div id={SETTINGS_SECTIONS.general.id} className="scroll-mt-8">
        <h1 className="type-md-lg">{SETTINGS_SECTIONS.general.label}</h1>

        <section className="mt-11" aria-labelledby="local-workspace-title">
          <h2 id="local-workspace-title" className="type-base">
            Local workspace
          </h2>
          <div className="mt-4 overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex min-h-[4.75rem] items-center justify-between gap-6 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Local by default
                </p>
                <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
                  Radius keeps sessions and artifacts on this computer unless
                  you enable a provider.
                </p>
              </div>
              <span className="shrink-0 text-sm text-muted-foreground">
                This Mac
              </span>
            </div>
            <Separator />
            <div className="flex min-h-[4.75rem] items-center justify-between gap-6 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Platform</p>
                <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
                  The desktop environment Radius is currently running in.
                </p>
              </div>
              <span className="shrink-0 text-sm text-muted-foreground">
                {platformLabel}
              </span>
            </div>
          </div>
        </section>
      </div>

      <section
        id={SETTINGS_SECTIONS.appearance.id}
        className="mt-14 scroll-mt-8"
        aria-labelledby="settings-appearance-title"
      >
        <h2 id="settings-appearance-title" className="type-base">
          {SETTINGS_SECTIONS.appearance.label}
        </h2>
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-background">
          <div className="flex min-h-[4.75rem] items-center justify-between gap-6 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Theme</p>
              <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
                Follow this computer or choose a light or dark appearance.
              </p>
            </div>
            <ThemeSwitch className="shrink-0" />
          </div>
        </div>
      </section>

      <section
        id={SETTINGS_SECTIONS.dataSync.id}
        className="mt-14 scroll-mt-8"
        aria-labelledby="data-sync-title"
      >
        <h2 id="data-sync-title" className="type-base">
          {SETTINGS_SECTIONS.dataSync.label}
        </h2>
        <motion.div
          layout={reduceMotion ? false : "size"}
          transition={{
            layout: {
              duration: 0.18,
              ease: SETTINGS_MOTION_EASE,
            },
          }}
          className="mt-4 overflow-hidden rounded-lg border border-border bg-background"
        >
          <div className="flex min-h-[4.75rem] items-center justify-between gap-6 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Data sync</p>
              <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
                Copy sessions and artifacts to the configured provider.
              </p>
            </div>
            <Switch
              checked={enabled}
              disabled={busy || status === null}
              aria-label={enabled ? "Disable sync" : "Enable sync"}
              onCheckedChange={(checked) => void toggleSync(checked)}
            />
          </div>

          <Separator />

          <button
            type="button"
            className="flex min-h-[4.75rem] w-full items-center justify-between gap-6 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
            aria-expanded={providerOpen}
            aria-controls="provider-setup"
            onClick={() => setProviderOpen((open) => !open)}
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                Provider
              </span>
              <span className="mt-0.5 block text-sm leading-5 text-muted-foreground">
                Choose where optional encrypted copies are sent.
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
              {providerLabel}
              <ChevronDown
                className={cn(
                  "size-4 transition-transform duration-150",
                  providerOpen && "rotate-180",
                )}
                aria-hidden
              />
            </span>
          </button>

          <AnimatePresence initial={false}>
            {providerOpen && (
              <motion.form
                key="provider-setup"
                id="provider-setup"
                initial={{
                  opacity: 0,
                  transform: reduceMotion
                    ? "translateY(0px)"
                    : "translateY(-2px)",
                }}
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                exit={{
                  opacity: 0,
                  transform: reduceMotion
                    ? "translateY(0px)"
                    : "translateY(-2px)",
                  transition: {
                    duration: 0.1,
                    ease: SETTINGS_MOTION_EASE,
                  },
                }}
                transition={{
                  duration: reduceMotion ? 0.1 : 0.16,
                  ease: SETTINGS_MOTION_EASE,
                }}
                className="flex flex-col gap-4 border-t border-border bg-muted/35 px-4 py-4"
                onSubmit={(event) => void connectProvider(event)}
              >
                <label className="flex flex-col gap-2 text-sm font-medium">
                  Cloud web URL
                  <Input
                    type="url"
                    value={frontendUrl}
                    onChange={(event) => setFrontendUrl(event.target.value)}
                    required
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium">
                  Cloud API URL
                  <Input
                    type="url"
                    value={apiUrl}
                    onChange={(event) => setApiUrl(event.target.value)}
                    required
                  />
                </label>
                <div>
                  <Button type="submit" variant="brand" disabled={busy}>
                    {busy ? (
                      <Loader2
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : (
                      <LogIn data-icon="inline-start" />
                    )}
                    {busy ? "Connecting…" : "Connect provider"}
                  </Button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </motion.div>
      </section>

      <AnimatePresence initial={false}>
        {errorMessage && (
          <motion.div
            key={errorMessage}
            initial={{
              opacity: 0,
              transform: reduceMotion ? "translateY(0px)" : "translateY(-2px)",
            }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            exit={{
              opacity: 0,
              transform: reduceMotion ? "translateY(0px)" : "translateY(-2px)",
              transition: {
                duration: 0.1,
                ease: SETTINGS_MOTION_EASE,
              },
            }}
            transition={{
              duration: reduceMotion ? 0.1 : 0.16,
              ease: SETTINGS_MOTION_EASE,
            }}
          >
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
