import {
  Section,
  SectionContent,
  SectionHeader,
} from "@/components/ui/section";
import { getPlatformContext } from "@/lib/platform-server";

export default async function WorkspacePage() {
  const { info, organization } = await getPlatformContext();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-8 sm:px-6 sm:pb-16 sm:pt-10">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Section className="rounded-sm bg-transparent">
          <SectionHeader className="items-start">
            <div>
              <h2 className="text-base font-medium text-foreground">
                {organization?.displayName ?? "Radius Platform"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Build and distribute agents from one organization workspace.
              </p>
            </div>
          </SectionHeader>
          <SectionContent className="grid gap-0 p-0 sm:grid-cols-2">
            <Metric
              label="Organization"
              value={organization?.slug ?? "Unavailable"}
            />
            <Metric
              label="Access role"
              value={organization?.role ?? "Unavailable"}
            />
            <Metric label="Platform" value={info.platformVersion} />
            <Metric
              label="Registry upload"
              value={info.registryUpload ? "Available" : "Unavailable"}
            />
          </SectionContent>
        </Section>

        <Section className="rounded-sm bg-transparent">
          <SectionHeader>
            <h2 className="text-base font-medium text-foreground">
              Deployment modes
            </h2>
          </SectionHeader>
          <SectionContent>
            <ul className="space-y-2 text-sm">
              {info.deploymentModes.map((mode) => (
                <li key={mode} className="capitalize text-foreground">
                  {mode.replace("_", " ")}
                </li>
              ))}
            </ul>
          </SectionContent>
        </Section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border px-4 py-4 odd:sm:border-r last:sm:border-b-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm text-foreground">{value}</p>
    </div>
  );
}
