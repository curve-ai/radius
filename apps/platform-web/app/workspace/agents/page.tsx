import { getPlatformContext } from "@/lib/platform-server";
import Link from "next/link";
import {
  Section,
  SectionContent,
  SectionHeader,
} from "@/components/ui/section";

export default async function AgentsPage() {
  const { client, organization } = await getPlatformContext();
  if (!organization) {
    return (
      <EmptyState
        title="No organization"
        body="Your account is not assigned to an organization."
      />
    );
  }
  const response = await client.listAgents(organization.slug);

  if (response.agents.length === 0) {
    return (
      <EmptyState
        title="No agents"
        body="Link an agent with the Radius CLI, then deploy its first version."
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-8 sm:px-6 sm:pb-16 sm:pt-10">
      <Section className="rounded-sm bg-transparent">
        <SectionHeader>
          <div>
            <h2 className="text-base font-medium text-foreground">Agents</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Each agent has immutable deployments and independent environments.
            </p>
          </div>
        </SectionHeader>
        <SectionContent className="p-0">
          {response.agents.map((agent) => (
            <Link
              key={agent.agent}
              href={`/workspace/agents/${encodeURIComponent(agent.agent)}`}
              className="grid gap-3 border-b border-border px-4 py-4 transition-colors last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:grid-cols-[minmax(0,1fr)_minmax(20rem,1.4fr)] lg:items-center"
            >
              <div className="min-w-0">
                <h3 className="truncate text-base font-normal text-foreground">
                  {agent.name}
                </h3>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {agent.agent}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {agent.environments.map((environment) => (
                  <div key={environment.name} className="min-w-0">
                    <p className="text-xs capitalize text-muted-foreground">
                      {environment.name}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-foreground">
                      {environment.deployment?.agentDeploymentVersion ??
                        "Not deployed"}
                    </p>
                  </div>
                ))}
              </div>
            </Link>
          ))}
        </SectionContent>
      </Section>
    </main>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-[60dvh] w-full max-w-3xl items-center px-4 py-12 sm:px-6">
      <div>
        <h2 className="type-md font-normal text-foreground">{title}</h2>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">{body}</p>
        <code className="mt-4 inline-block rounded-sm border border-border bg-card px-2 py-1 font-mono text-xs text-foreground">
          radius deploy --environment staging
        </code>
      </div>
    </main>
  );
}
