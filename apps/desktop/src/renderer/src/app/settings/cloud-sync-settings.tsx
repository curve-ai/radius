import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Switch } from "@renderer/components/ui/switch";
import type { DesktopSyncStatus } from "../../../../radius-api";
import {
  cloudEndpointMessage,
  validateCloudEndpoint,
  type CloudEndpointError,
} from "./cloud-endpoint";
import { SettingsCard, SettingsRow } from "./settings-primitives";

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.length > 0
    ? cause.message
    : fallback;
}

function formatLastSuccess(value: string | null): string {
  if (!value) return "No conversations have synced yet.";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return `Last synced ${value}.`;
  return `Last synced ${parsed.toLocaleString()}.`;
}

function connectionDescription(status: DesktopSyncStatus): string {
  const endpoint = status.endpointUrl ?? "an unknown server";
  switch (status.state) {
    case "syncing":
      return `Syncing with ${endpoint}.`;
    case "idle":
      return `Connected to ${endpoint}. ${formatLastSuccess(status.lastSuccessAt)}`;
    case "error":
      return `Connected to ${endpoint}, but the last sync did not finish.`;
    case "disabled":
      return "Conversations stay on this Mac until you connect a server.";
  }
}

export function CloudSyncSettings(): ReactNode {
  const [status, setStatus] = useState<DesktopSyncStatus | null>(null);
  const [apiUrl, setApiUrl] = useState(__CLOUD_API_URL__);
  const [webUrl, setWebUrl] = useState(__CLOUD_WEB_URL__);
  const [apiError, setApiError] = useState<CloudEndpointError | null>(null);
  const [webError, setWebError] = useState<CloudEndpointError | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.radius
      .syncStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch((cause) => {
        if (!active) return;
        setFailure(errorMessage(cause, "Radius could not read the sync state"));
      });
    return () => {
      active = false;
    };
  }, []);

  const connect = useCallback(async (): Promise<void> => {
    const nextApiError = validateCloudEndpoint(apiUrl);
    const nextWebError = validateCloudEndpoint(webUrl);
    setApiError(nextApiError);
    setWebError(nextWebError);
    if (nextApiError || nextWebError) return;

    setFailure(null);
    setConnecting(true);
    try {
      setStatus(
        await window.radius.connectCloud({
          apiUrl: apiUrl.trim(),
          frontendUrl: webUrl.trim(),
        }),
      );
    } catch (cause) {
      setFailure(errorMessage(cause, "Radius could not connect to the server"));
    } finally {
      setConnecting(false);
    }
  }, [apiUrl, webUrl]);

  const runAction = useCallback(
    async (
      action: () => Promise<DesktopSyncStatus>,
      fallback: string,
    ): Promise<void> => {
      setFailure(null);
      setBusy(true);
      try {
        setStatus(await action());
      } catch (cause) {
        setFailure(errorMessage(cause, fallback));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  if (!status) {
    return (
      <SettingsCard>
        <SettingsRow
          label="Radius Cloud"
          description={failure ?? "Checking the sync state…"}
          descriptionLive
        />
      </SettingsCard>
    );
  }

  if (status.state === "disabled") {
    return (
      <SettingsCard>
        <SettingsRow
          label="Radius Cloud"
          description={connectionDescription(status)}
        />
        <div className="space-y-4 px-4 py-4">
          <div>
            <label htmlFor="cloud-api-url" className="text-sm text-foreground">
              Server address
            </label>
            <Input
              id="cloud-api-url"
              value={apiUrl}
              spellCheck={false}
              autoComplete="off"
              disabled={connecting}
              aria-invalid={apiError !== null}
              aria-describedby={apiError ? "cloud-api-url-error" : undefined}
              onChange={(event) => {
                setApiUrl(event.target.value);
                setApiError(null);
              }}
              className="mt-2"
            />
            {apiError ? (
              <p
                id="cloud-api-url-error"
                role="alert"
                className="mt-2 text-sm text-destructive"
              >
                {cloudEndpointMessage(apiError)}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="cloud-web-url" className="text-sm text-foreground">
              Sign-in address
            </label>
            <Input
              id="cloud-web-url"
              value={webUrl}
              spellCheck={false}
              autoComplete="off"
              disabled={connecting}
              aria-invalid={webError !== null}
              aria-describedby={webError ? "cloud-web-url-error" : undefined}
              onChange={(event) => {
                setWebUrl(event.target.value);
                setWebError(null);
              }}
              className="mt-2"
            />
            <p className="mt-2 text-sm leading-5 text-muted-foreground">
              Where Radius opens the browser to sign you in. Self-hosted
              installations often serve this on a different port to the server
              address.
            </p>
            {webError ? (
              <p
                id="cloud-web-url-error"
                role="alert"
                className="mt-2 text-sm text-destructive"
              >
                {cloudEndpointMessage(webError)}
              </p>
            ) : null}
          </div>

          {failure ? (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={connecting}
              onClick={() => void connect()}
            >
              {connecting ? "Waiting for sign-in" : "Connect"}
            </Button>
            {connecting ? (
              <p aria-live="polite" className="text-sm text-muted-foreground">
                Finish signing in through the browser window Radius opened.
              </p>
            ) : null}
          </div>
        </div>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard>
      <SettingsRow
        label="Radius Cloud"
        description={connectionDescription(status)}
        descriptionLive
      >
        <Switch
          checked
          disabled={busy}
          aria-label="Sync conversations with Radius Cloud"
          onCheckedChange={() =>
            void runAction(
              () => window.radius.setSyncEnabled(false),
              "Radius could not disconnect from the server",
            )
          }
        />
      </SettingsRow>

      <SettingsRow
        label="Sync now"
        description="Push anything waiting on this Mac and pull what is new."
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
            {failure ?? status.errorCode}
          </p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            Include this code if you report the problem.
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
