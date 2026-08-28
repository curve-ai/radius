import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@renderer/components/ui/button";
import { useDesktopUpdate } from "@renderer/components/shell/use-desktop-update";
import { SettingsCard, SettingsRow } from "./settings-primitives";

const RADIUS_RELEASES_URL = "https://github.com/curve-ai/radius/releases";
const RADIUS_REPOSITORY_URL = "https://github.com/curve-ai/radius";
const RADIUS_SUPPORT_URL = "https://github.com/curve-ai/radius/issues";

function ExternalSettingsRow({
  href,
  label,
  description,
}: {
  href: string;
  label: string;
  description: string;
}): ReactNode {
  return (
    <SettingsRow label={label} description={description}>
      <Button
        asChild
        size="icon"
        variant="secondary"
        className="size-8 shrink-0 rounded-md text-muted-foreground"
      >
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${label}`}
        >
          <ArrowUpRight className="size-4" aria-hidden />
        </a>
      </Button>
    </SettingsRow>
  );
}

export function AboutUpdates(): ReactNode {
  const { status, checkForUpdates, performUpdate } = useDesktopUpdate();
  let updateDescription = "Loading update status…";
  let updateAction: {
    label: string;
    action: () => Promise<void>;
    brand: boolean;
  } | null = null;

  if (status) {
    switch (status.state) {
      case "unsupported":
        updateDescription =
          "Automatic updates are available in installed release builds.";
        break;
      case "checking":
        updateDescription = "Checking for a newer version…";
        break;
      case "available":
        updateDescription = `Radius ${status.availableVersion ?? "update"} is available.`;
        updateAction = {
          label: "Download",
          action: performUpdate,
          brand: true,
        };
        break;
      case "downloading":
        updateDescription = `Downloading Radius ${status.availableVersion ?? "update"} — ${status.percent ?? 0}%`;
        break;
      case "downloaded":
        updateDescription = `Radius ${status.availableVersion ?? "update"} is ready to install.`;
        updateAction = { label: "Restart", action: performUpdate, brand: true };
        break;
      case "error":
        updateDescription = "Radius couldn’t check for updates.";
        updateAction = {
          label: "Retry",
          action: checkForUpdates,
          brand: false,
        };
        break;
      case "idle":
        updateDescription = "Radius is up to date.";
        updateAction = {
          label: "Check",
          action: checkForUpdates,
          brand: false,
        };
        break;
    }
  }

  return (
    <SettingsCard>
      <SettingsRow
        label="Version"
        description="The installed Radius desktop client."
      >
        <span className="shrink-0 text-sm text-muted-foreground">
          {status?.currentVersion ?? "—"}
        </span>
      </SettingsRow>

      <SettingsRow
        label="Updates"
        description={updateDescription}
        descriptionLive
      >
        {updateAction && (
          <Button
            type="button"
            size="sm"
            variant={updateAction.brand ? "brand" : "secondary"}
            className="shrink-0"
            onClick={() => void updateAction.action()}
          >
            {updateAction.label}
          </Button>
        )}
      </SettingsRow>

      <ExternalSettingsRow
        href={RADIUS_RELEASES_URL}
        label="Release notes"
        description="See what changed in recent Radius releases."
      />
      <ExternalSettingsRow
        href={RADIUS_REPOSITORY_URL}
        label="Source & license"
        description="View the open-source project and MIT license."
      />
      <ExternalSettingsRow
        href={RADIUS_SUPPORT_URL}
        label="Help & feedback"
        description="Report a problem or request an improvement."
      />
    </SettingsCard>
  );
}
