import { RadiusPlatformError } from "@curve-ai/platform-client";

import { SyncDeviceList } from "@/components/sync/sync-device-list";
import {
  Section,
  SectionContent,
  SectionHeader,
} from "@/components/ui/section";
import { getPlatformContext } from "@/lib/platform-server";

export default async function SyncPage() {
  const { client, organization } = await getPlatformContext();
  if (!organization) {
    return (
      <EmptyState
        title="No organization"
        body="Your account is not assigned to an organization."
      />
    );
  }

  let overview;
  try {
    overview = await client.syncOverview();
  } catch (error) {
    if (error instanceof RadiusPlatformError && error.status === 404) {
      return (
        <EmptyState
          title="Conversation sync is off"
          body="This platform does not store conversations. Turn on RADIUS_SYNC_ENABLED on the platform API to use it."
        />
      );
    }
    throw error;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-8 sm:px-6 sm:pb-16 sm:pt-10">
      <div className="space-y-4">
        <Section className="rounded-sm bg-transparent">
          <SectionHeader className="items-start">
            <div className="min-w-0">
              <h2 className="text-base font-normal text-foreground">
                Your conversations
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                What your devices have synced into {organization.displayName}.
                Sync is private to you; other members see only their own.
              </p>
            </div>
          </SectionHeader>
          <SectionContent>
            <div className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Projects" value={String(overview.projects)} />
              <Fact label="Sessions" value={String(overview.sessions)} />
              <Fact label="Changes accepted" value={String(overview.changes)} />
              <Fact
                label="Last change"
                value={
                  overview.latestChangeAt
                    ? formatTimestamp(overview.latestChangeAt)
                    : "Nothing synced yet"
                }
              />
              <Fact
                label="File transfer"
                value={overview.artifactTransfer ? "Enabled" : "Not configured"}
              />
            </div>
          </SectionContent>
        </Section>

        <Section className="rounded-sm bg-transparent">
          <SectionHeader className="items-start">
            <div className="min-w-0">
              <h2 className="text-base font-normal text-foreground">Devices</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Every desktop that has enrolled for sync as you. Revoking a
                device is final; it must be re-enrolled as a new device.
              </p>
            </div>
          </SectionHeader>
          <SectionContent className="p-0">
            {overview.devices.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                No device has enrolled yet. Sign in to this organization from
                the desktop app to start syncing.
              </p>
            ) : (
              <SyncDeviceList
                organization={organization.slug}
                devices={overview.devices}
              />
            )}
          </SectionContent>
        </Section>
      </div>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm text-foreground" title={value}>
        {value}
      </p>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-[60dvh] w-full max-w-3xl items-center px-4 py-12 sm:px-6">
      <div>
        <h2 className="type-md font-normal text-foreground">{title}</h2>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">{body}</p>
      </div>
    </main>
  );
}

function formatTimestamp(value: string): string {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}
