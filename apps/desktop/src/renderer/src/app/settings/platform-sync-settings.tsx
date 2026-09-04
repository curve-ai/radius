import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Switch } from "@renderer/components/ui/switch";
import type { DesktopSyncStatus } from "../../../../radius-api";
import {
  platformEndpointMessage,
  validatePlatformEndpoint,
  type PlatformEndpointError,
} from "./platform-endpoint";
import { platformConnectMessage } from "./platform-errors";
import { SettingsCard, SettingsRow } from "./settings-primitives";

/** Sync runs on its own every 30s, so the panel refreshes at a similar pace. */
const STATUS_POLL_MS = 5_000;

function formatLastSuccess(value: string | null): string {
  if (!value) return "Nothing has synced yet.";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return `Last synced ${value}.`;
  return `Last synced ${parsed.toLocaleTimeString()}.`;
}

function connectionDescription(status: DesktopSyncStatus): string {
  const where = status.connection?.organizationName ?? status.endpointUrl;
  switch (status.state) {
    case "syncing":
      return `Syncing with ${where} now.`;
    case "idle":
      return `Connected to ${where}. ${formatLastSuccess(status.lastSuccessAt)}`;
    case "error":
      return `Connected to ${where}, but the last sync did not finish.`;
    case "disabled":
      return "Conversations stay on this Mac until you connect a platform.";
  }
}

export function PlatformSyncSettings(): ReactNode {
  const [status, setStatus] = useState<DesktopSyncStatus | null>(null);
  const [showSelfHosted, setShowSelfHosted] = useState(false);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<PlatformEndpointError | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const interactingRef = useRef(false);

  // Sync happens in the background, so poll rather than showing a value that
  // silently ages. Connect progress arrives the same way, which is what lets
  // "setting up your workspace" appear while the Cloud window is open.
  useEffect(() => {
    let active = true;
    const read = (): void => {
      void window.radius
        .syncStatus()
        .then((next) => {
          if (!active) return;
          // A poll must not overwrite the result of an action in flight, but
          // its progress line is the only thing reporting on that action.
          setStatus((current) =>
            interactingRef.current
              ? current && { ...current, progress: next.progress }
              : next,
          );
        })
        .catch(() => {
          // A failed poll is not worth reporting; the next one may succeed.
        });
    };
    read();
    const handle = setInterval(read, STATUS_POLL_MS);
    return () => {
      active = false;
      clearInterval(handle);
    };
  }, []);

  const runAction = useCallback(
    async (
      action: () => Promise<DesktopSyncStatus>,
      fallback: string,
    ): Promise<void> => {
      interactingRef.current = true;
      setFailure(null);
      setBusy(true);
      try {
        setStatus(await action());
      } catch (cause) {
        setFailure(cause instanceof Error ? cause.message : fallback);
      } finally {
        setBusy(false);
        interactingRef.current = false;
      }
    },
    [],
  );

  const connect = useCallback(
    async (input: { kind: "cloud" } | { kind: "self-hosted"; url: string }) => {
      interactingRef.current = true;
      setFailure(null);
      setConnecting(true);
      try {
        setStatus(await window.radius.connectPlatform(input));
      } catch (cause) {
        setFailure(platformConnectMessage(cause));
      } finally {
        setConnecting(false);
        interactingRef.current = false;
      }
    },
    [],
  );

  const connectSelfHosted = useCallback((): void => {
    const nextError = validatePlatformEndpoint(url);
    setUrlError(nextError);
    if (nextError) return;
    void connect({ kind: "self-hosted", url: url.trim() });
  }, [connect, url]);

  if (!status) {
    return (
      <SettingsCard>
        <SettingsRow
          label="Radius platform"
          description="Checking the sync state…"
          descriptionLive
        />
      </SettingsCard>
    );
  }

  if (status.state === "disabled") {
    return (
      <SettingsCard>
        <SettingsRow
          label="Radius platform"
          description={connectionDescription(status)}
        />
        <div className="space-y-4 px-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={connecting}
              onClick={() => void connect({ kind: "cloud" })}
            >
              Sign in with Curve Cloud
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={connecting}
              onClick={() => {
                setShowSelfHosted((open) => !open);
                setFailure(null);
                setUrlError(null);
              }}
              aria-expanded={showSelfHosted}
            >
              Connect to a self-hosted platform
            </Button>
          </div>

          {showSelfHosted ? (
            <div>
              <label htmlFor="platform-url" className="text-sm text-foreground">
                Platform address
              </label>
              <Input
                id="platform-url"
                value={url}
                placeholder="https://radius.example.com"
                spellCheck={false}
                autoComplete="off"
                disabled={connecting}
                aria-invalid={urlError !== null}
                aria-describedby={
                  urlError ? "platform-url-error" : "platform-url-hint"
                }
                onChange={(event) => {
                  setUrl(event.target.value);
                  setUrlError(null);
                }}
                className="mt-2"
              />
              <p
                id="platform-url-hint"
                className="mt-2 text-sm leading-5 text-muted-foreground"
              >
                The address that serves both sign-in and the API for your Radius
                installation. Sign-in uses whichever identity provider your
                operator configured.
              </p>
              {urlError ? (
                <p
                  id="platform-url-error"
                  role="alert"
                  className="mt-2 text-sm text-destructive"
                >
                  {platformEndpointMessage(urlError)}
                </p>
              ) : null}
              <Button
                type="button"
                size="sm"
                className="mt-3"
                disabled={connecting}
                onClick={connectSelfHosted}
              >
                Connect
              </Button>
            </div>
          ) : null}

          {failure ? (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          ) : null}

          {connecting ? (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {status.progress ??
                "Finish signing in through the window Radius opened."}
            </p>
          ) : null}
        </div>
      </SettingsCard>
    );
  }

  const connection = status.connection;

  return (
    <SettingsCard>
      {connection ? (
        <SettingsRow
          label={connection.organizationName ?? "Radius platform"}
          description={`Signed in as ${connection.role ?? "member"} · ${connection.baseUrl}`}
        >
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="shrink-0"
            disabled={busy}
            onClick={() =>
              void runAction(
                () => window.radius.disconnectPlatform(),
                "Radius could not sign out",
              )
            }
          >
            Sign out
          </Button>
        </SettingsRow>
      ) : null}

      <SettingsRow
        label="Automatic sync"
        description={connectionDescription(status)}
        descriptionLive
      >
        <Switch
          checked
          disabled={busy}
          aria-label="Sync conversations automatically"
          onCheckedChange={() =>
            void runAction(
              () => window.radius.setSyncEnabled(false),
              "Radius could not turn off syncing",
            )
          }
        />
      </SettingsRow>

      <SettingsRow
        label="Sync now"
        description="Syncing runs on its own in the background. Use this to catch up immediately."
      >
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="shrink-0"
          disabled={busy || status.state === "syncing"}
          onClick={() =>
            void runAction(
              () => window.radius.syncNow(),
              "Radius could not finish the sync",
            )
          }
        >
          {status.state === "syncing" || busy ? "Syncing" : "Sync now"}
        </Button>
      </SettingsRow>

      {status.errorCode || failure ? (
        <div className="px-4 py-4">
          <p role="alert" className="text-sm text-destructive">
            {failure ?? platformConnectMessage(new Error(status.errorCode!))}
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-3"
            disabled={busy}
            onClick={() =>
              void runAction(
                () => window.radius.syncNow(),
                "Radius could not finish the sync",
              )
            }
          >
            Try again
          </Button>
        </div>
      ) : null}
    </SettingsCard>
  );
}
