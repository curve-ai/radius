import type { ListInstallationsResponse } from "@curve-ai/platform-client";

import {
  Section,
  SectionContent,
  SectionHeader,
} from "@/components/ui/section";
import { canViewInstallations } from "@/lib/platform-permissions";
import { getPlatformContext } from "@/lib/platform-server";

type PhysicalDevice = ListInstallationsResponse["physicalDevices"][number];
type ClientInstallation = PhysicalDevice["clientInstallations"][number];

export default async function DevicesPage() {
  const { client, organization } = await getPlatformContext();
  if (!organization) {
    return (
      <EmptyState
        title="No organization"
        body="Your account is not assigned to an organization."
      />
    );
  }
  if (!canViewInstallations(organization.role)) {
    return (
      <EmptyState
        title="Device inventory unavailable"
        body="Developer, admin, or owner access is required to view organization devices."
      />
    );
  }

  const response = await client.listInstallations(organization.slug);
  if (response.physicalDevices.length === 0) {
    return (
      <EmptyState
        title="No managed devices"
        body="A device appears here after a Radius client registers with this organization."
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-8 sm:px-6 sm:pb-16 sm:pt-10">
      <div className="space-y-4">
        {response.physicalDevices.map((device) => (
          <DeviceSection key={device.id} device={device} />
        ))}
      </div>
    </main>
  );
}

function DeviceSection({ device }: { device: PhysicalDevice }) {
  return (
    <Section className="rounded-sm bg-transparent">
      <SectionHeader className="items-start">
        <div className="min-w-0">
          <h2 className="truncate text-base font-normal text-foreground">
            {device.displayName}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {device.platform} on {device.architecture}
            {device.assetTag ? `, asset ${device.assetTag}` : ""}
          </p>
        </div>
        <p className="text-xs capitalize text-muted-foreground">
          {humanize(device.lifecycleState)}
        </p>
      </SectionHeader>
      <SectionContent className="p-0">
        {device.clientInstallations.map((installation) => (
          <ClientInstallationRow
            key={installation.id}
            installation={installation}
          />
        ))}
      </SectionContent>
    </Section>
  );
}

function ClientInstallationRow({
  installation,
}: {
  installation: ClientInstallation;
}) {
  const observation = installation.latestObservation;
  return (
    <section className="border-b border-border px-4 py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-normal text-foreground">Radius client</h3>
          <p
            className="mt-1 truncate font-mono text-xs text-muted-foreground"
            title={installation.clientInstanceId}
          >
            {installation.clientInstanceId}
          </p>
        </div>
        <p className="text-xs capitalize text-muted-foreground">
          {humanize(observation?.state ?? installation.lifecycleState)}
        </p>
      </div>

      {observation ? (
        <div className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Desktop" value={observation.desktopVersion} />
          <Fact label="Runtime" value={observation.runtimeVersion} />
          <Fact
            label="Runtime protocol"
            value={String(observation.runtimeProtocolVersion)}
          />
          <Fact
            label="Last observed"
            value={formatTimestamp(observation.observedAt)}
          />
          {observation.errorCode ? (
            <Fact label="Error" value={observation.errorCode} />
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          This client has not reported its version yet.
        </p>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">Installed agents</p>
        {installation.agentInstallations.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No agents are installed on this client.
          </p>
        ) : (
          <div className="mt-1">
            {installation.agentInstallations.map((agent) => (
              <div
                key={agent.id}
                className="grid gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    {agent.agent}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {agent.latestObservation
                      ? `Deployment ${agent.latestObservation.agentDeploymentVersion}`
                      : "Waiting for an installation observation"}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground sm:text-right">
                  <p className="capitalize">
                    {humanize(
                      agent.latestObservation?.state ?? agent.lifecycleState,
                    )}
                  </p>
                  {agent.latestObservation?.observedAt ? (
                    <p className="mt-0.5">
                      {formatTimestamp(agent.latestObservation.observedAt)}
                    </p>
                  ) : null}
                  {agent.latestObservation?.errorCode ? (
                    <p className="mt-0.5 text-destructive">
                      {agent.latestObservation.errorCode}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-foreground" title={value}>
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

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function formatTimestamp(value: string): string {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}
