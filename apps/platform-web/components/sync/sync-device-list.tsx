"use client";

import { useActionState } from "react";

import type { SyncDeviceSummary } from "@curve-ai/platform-client";
import { revokeSyncDeviceAction } from "@/app/workspace/sync/actions";
import type { RevokeSyncDeviceActionState } from "@/app/workspace/sync/action-state";
import { Button } from "@/components/ui/button";

const INITIAL_STATE: RevokeSyncDeviceActionState = { status: "idle" };

export function SyncDeviceList({
  organization,
  devices,
}: {
  organization: string;
  devices: SyncDeviceSummary[];
}) {
  return (
    <div>
      {devices.map((device) => (
        <SyncDeviceRow
          key={device.id}
          organization={organization}
          device={device}
        />
      ))}
    </div>
  );
}

function SyncDeviceRow({
  organization,
  device,
}: {
  organization: string;
  device: SyncDeviceSummary;
}) {
  const [state, formAction, pending] = useActionState(
    revokeSyncDeviceAction,
    INITIAL_STATE,
  );
  const revoked = device.revokedAt !== null;
  return (
    <div className="border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-sm text-foreground">{device.displayName}</p>
            <p className="text-xs text-muted-foreground">
              {device.platform}, app {device.appVersion}
            </p>
            <p className="text-xs text-muted-foreground">
              {revoked ? "Revoked" : "Active"}
            </p>
          </div>
          <p
            className="mt-1 truncate font-mono text-xs text-muted-foreground"
            title={device.id}
          >
            {device.id}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Enrolled {formatTimestamp(device.createdAt)}, last seen{" "}
            {formatTimestamp(device.lastSeenAt)}
            {device.revokedAt
              ? `, revoked ${formatTimestamp(device.revokedAt)}`
              : ""}
          </p>
          {state.status !== "idle" ? (
            <p
              className={
                state.status === "error"
                  ? "mt-2 text-sm text-destructive"
                  : "mt-2 text-sm text-muted-foreground"
              }
              role={state.status === "error" ? "alert" : "status"}
            >
              {state.message}
            </p>
          ) : null}
        </div>
        {!revoked ? (
          <form action={formAction}>
            <input type="hidden" name="organization" value={organization} />
            <input type="hidden" name="deviceId" value={device.id} />
            <Button
              type="submit"
              variant="destructive"
              size="xs"
              disabled={pending}
            >
              {pending ? "Revoking..." : "Revoke"}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function formatTimestamp(value: string): string {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}
