import { useEffect, useState, type ReactNode } from "react";

import type {
  BrowserConnectionStatus,
  McpApprovalGrantSummary,
} from "../../../../radius-api";

import { useWorkspaceNavigation } from "@renderer/components/shell/navigation-context";
import { Button } from "@renderer/components/ui/button";
import { Switch } from "@renderer/components/ui/switch";
import {
  SettingsCard,
  SettingsRow,
  UnavailableSetting,
} from "./settings-primitives";

function UnavailableSwitch({ label }: { label: string }): ReactNode {
  return (
    <Switch
      checked={false}
      disabled
      aria-label={`${label} is coming soon`}
      title="This preference is not wired yet"
    />
  );
}

export function WorkDefaults(): ReactNode {
  return (
    <SettingsCard>
      <SettingsRow
        label="Default agent"
        description="Choose which connected agent starts new work."
      >
        <UnavailableSetting
          label="Choose per task"
          reason="Default agent persistence is not wired yet"
        />
      </SettingsRow>
      <SettingsRow
        label="New task project"
        description="Choose how Radius selects project context for new tasks."
      >
        <UnavailableSetting
          label="Ask each time"
          reason="Default project behavior is not wired yet"
        />
      </SettingsRow>
      <SettingsRow
        label="Keep awake while working"
        description="Prevent this computer from sleeping while a task is running."
      >
        <UnavailableSwitch label="Keep awake while working" />
      </SettingsRow>
    </SettingsCard>
  );
}

export function PermissionSettings(): ReactNode {
  return (
    <SettingsCard>
      <SettingsRow
        label="Default access"
        description="Choose how new tasks may use files and the internet."
      >
        <UnavailableSetting
          label="Project access"
          reason="Default access persistence is not wired yet"
        />
      </SettingsRow>
      <SettingsRow
        label="Project files"
        description="Keep file access scoped to the selected project folder."
      >
        <UnavailableSetting
          label="Project folders"
          reason="Folder access is managed from each project"
        />
      </SettingsRow>
      <SettingsRow
        label="Agent restrictions"
        description="Agent providers may further limit tools, files, and network access."
      >
        <UnavailableSetting
          label="Managed by agent"
          reason="Agent policy reporting is not wired yet"
        />
      </SettingsRow>
    </SettingsCard>
  );
}

export function NotificationSettings(): ReactNode {
  return (
    <SettingsCard>
      <SettingsRow
        label="Task completed"
        description="Notify me when foreground or background work finishes."
      >
        <UnavailableSwitch label="Task completed notifications" />
      </SettingsRow>
      <SettingsRow
        label="Approval required"
        description="Notify me when a task is waiting for permission."
      >
        <UnavailableSwitch label="Approval required notifications" />
      </SettingsRow>
      <SettingsRow
        label="Scheduled task failed"
        description="Notify me when scheduled work cannot complete."
      >
        <UnavailableSwitch label="Scheduled task failure notifications" />
      </SettingsRow>
      <SettingsRow
        label="Background updates"
        description="Show progress updates for long-running tasks."
      >
        <UnavailableSwitch label="Background task updates" />
      </SettingsRow>
    </SettingsCard>
  );
}

export function AppConnectionSettings(): ReactNode {
  const { navigate } = useWorkspaceNavigation();

  return (
    <SettingsCard>
      <BrowserConnectionSetting />
      <SettingsRow
        label="Work apps"
        description="Manage work applications and services Radius can use."
      >
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="shrink-0"
          onClick={() => navigate("connectors")}
        >
          Manage
        </Button>
      </SettingsRow>
      <SettingsRow
        label="Agents"
        description="Manage the agents available for new tasks."
      >
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="shrink-0"
          onClick={() => navigate("agents")}
        >
          Manage
        </Button>
      </SettingsRow>
      <ConnectionPermissionSettings />
    </SettingsCard>
  );
}

function ConnectionPermissionSettings(): ReactNode {
  const [grants, setGrants] = useState<McpApprovalGrantSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingGrantId, setRevokingGrantId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.radius
      .listMcpApprovalGrants()
      .then((next) => {
        if (active) setGrants(next);
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Radius could not load connection permissions",
        );
        setGrants([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const revoke = async (grant: McpApprovalGrantSummary): Promise<void> => {
    setRevokingGrantId(grant.grantId);
    setError(null);
    try {
      await window.radius.revokeMcpApproval({
        grantId: grant.grantId,
        scope: grant.scope,
      });
      setGrants(
        (current) =>
          current?.filter((item) => item.grantId !== grant.grantId) ?? [],
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Radius could not revoke this permission",
      );
    } finally {
      setRevokingGrantId(null);
    }
  };

  const description = error
    ? error
    : grants === null
      ? "Loading remembered MCP permissions."
      : grants.length === 0
        ? "No MCP tools or servers are always allowed."
        : `${grants.length} remembered MCP ${grants.length === 1 ? "permission" : "permissions"}.`;

  return (
    <>
      <SettingsRow
        label="Connection permissions"
        description={description}
        descriptionLive
      />
      {grants?.map((grant) => (
        <SettingsRow
          key={grant.grantId}
          label={
            grant.scope === "server"
              ? grant.providerLabel
              : grant.toolName || grant.providerLabel
          }
          description={
            grant.scope === "server"
              ? "All tools on this MCP server are always allowed."
              : `Always allowed on ${grant.providerLabel}.`
          }
          className="min-h-[4.25rem]"
        >
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="shrink-0"
            disabled={revokingGrantId !== null}
            onClick={() => void revoke(grant)}
          >
            {revokingGrantId === grant.grantId ? "Revoking" : "Revoke"}
          </Button>
        </SettingsRow>
      ))}
    </>
  );
}

function BrowserConnectionSetting(): ReactNode {
  const [status, setStatus] = useState<BrowserConnectionStatus | null>(null);
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    let active = true;
    if (
      typeof window.radius.browserStatus !== "function" ||
      typeof window.radius.onBrowserStatus !== "function"
    ) {
      queueMicrotask(() => {
        if (!active) return;
        setStatus({
          state: "error",
          extensionId: "",
          profile: null,
          controlledTabs: 0,
          errorCode: "BROWSER_RESTART_REQUIRED",
        });
      });
      return () => {
        active = false;
      };
    }
    void window.radius.browserStatus().then((next) => {
      if (active) setStatus(next);
    });
    const unsubscribe = window.radius.onBrowserStatus((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const description = browserDescription(status);
  const reveal = async (): Promise<void> => {
    if (typeof window.radius.revealBrowserExtension !== "function") return;
    setRevealing(true);
    try {
      await window.radius.revealBrowserExtension();
    } finally {
      setRevealing(false);
    }
  };

  return (
    <SettingsRow
      label="Chrome browser"
      description={description}
      descriptionLive
    >
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="shrink-0"
        disabled={
          revealing ||
          status?.state === "unsupported" ||
          status?.errorCode === "BROWSER_RESTART_REQUIRED"
        }
        onClick={() => void reveal()}
      >
        {revealing ? "Opening" : "Show extension"}
      </Button>
    </SettingsRow>
  );
}

function browserDescription(status: BrowserConnectionStatus | null): string {
  if (!status) return "Checking the local Chrome connection.";
  if (status.state === "connected") {
    const tabs = status.controlledTabs;
    return `${status.profile?.label ?? "Chrome"} is connected. ${tabs} controlled ${
      tabs === 1 ? "tab" : "tabs"
    }.`;
  }
  if (status.state === "paused") {
    return "Browser access is paused from the Radius Chrome extension.";
  }
  if (status.state === "unsupported") {
    return "Authenticated Chrome control is not available on this platform yet.";
  }
  if (status.state === "error") {
    if (status.errorCode === "BROWSER_RESTART_REQUIRED") {
      return "Restart Radius to finish browser setup.";
    }
    return "Radius could not reach the Chrome extension. Open the extension folder and reconnect.";
  }
  return "Install the Radius Chrome extension to let agents use signed-in tabs.";
}
