import Link from "next/link";
import { notFound } from "next/navigation";

import type {
  AgentSummary,
  AgentEnvironmentRevisionSummary,
  AgentDeploymentSummary,
} from "@curve-ai/platform-client";
import {
  Section,
  SectionContent,
  SectionHeader,
} from "@/components/ui/section";
import { DeploymentAction } from "@/components/agents/deployment-action";
import { canChangeDeployments } from "@/lib/platform-permissions";
import { getPlatformContext } from "@/lib/platform-server";

interface AgentDetailPageProps {
  params: Promise<{ agent: string }>;
  searchParams: Promise<{
    environment?: string;
    versionCursor?: string;
    revisionCursor?: string;
  }>;
}

export default async function AgentDetailPage({
  params,
  searchParams,
}: AgentDetailPageProps) {
  const [{ agent: agentRef }, query, context] = await Promise.all([
    params,
    searchParams,
    getPlatformContext(),
  ]);
  const organization = context.organization;
  if (!organization) notFound();

  const [agents, agentDeployments] = await Promise.all([
    context.client.listAgents(organization.slug),
    context.client.listAgentDeployments(agentRef, {
      limit: 25,
      ...(query.versionCursor ? { cursor: query.versionCursor } : {}),
    }),
  ]);
  const agent = agents.agents.find((candidate) => candidate.agent === agentRef);
  if (!agent) notFound();

  const environment = selectEnvironment(agent, query.environment);
  const history = await context.client.listAgentEnvironmentHistory(
    agent.agent,
    environment.name,
    {
      limit: 25,
      ...(query.revisionCursor ? { cursor: query.revisionCursor } : {}),
    },
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-6 sm:px-6 sm:pb-16 sm:pt-8">
      <Link
        href="/workspace/agents"
        className="inline-flex min-h-9 items-center text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to agents
      </Link>

      <div className="mt-4">
        <h2 className="type-md font-normal text-foreground">{agent.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{agent.agent}</p>
      </div>

      <EnvironmentNavigation
        agent={agent}
        selectedEnvironment={environment.name}
      />

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
        <DeploymentInventory
          organization={organization.slug}
          agent={agent.agent}
          agentDeployments={agentDeployments.agentDeployments}
          nextCursor={agentDeployments.nextCursor}
          environment={environment.name}
          currentRevision={history.currentRevision}
          currentDeploymentId={history.revisions[0]?.agentDeploymentId ?? null}
          priorDeploymentIds={history.revisions
            .slice(1)
            .flatMap((revision) =>
              revision.agentDeploymentId ? [revision.agentDeploymentId] : [],
            )}
          canChangeDeployment={canChangeDeployments(organization.role)}
        />
        <DeploymentHistory
          environment={environment.name}
          currentRevision={history.currentRevision}
          revisions={history.revisions}
          nextCursor={history.nextCursor}
          versionCursor={query.versionCursor}
        />
      </div>
    </main>
  );
}

function EnvironmentNavigation({
  agent,
  selectedEnvironment,
}: {
  agent: AgentSummary;
  selectedEnvironment: string;
}) {
  return (
    <nav
      aria-label="Agent environments"
      className="mt-6 grid overflow-hidden rounded-sm border border-border sm:grid-cols-3"
    >
      {agent.environments.map((environment) => {
        const active = environment.name === selectedEnvironment;
        return (
          <Link
            key={environment.name}
            href={`?environment=${encodeURIComponent(environment.name)}`}
            aria-current={active ? "page" : undefined}
            className="min-w-0 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:border-b-0 sm:border-r sm:last:border-r-0 data-[active=true]:bg-accent"
            data-active={active ? "true" : "false"}
          >
            <span className="block text-xs capitalize text-muted-foreground">
              {environment.name}
            </span>
            <span className="mt-1 block truncate text-sm text-foreground">
              {environment.deployment?.agentDeploymentVersion ?? "Not deployed"}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {environment.deployment
                ? `Revision ${environment.deployment.revision}`
                : "No deployment history"}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function DeploymentInventory({
  organization,
  agent,
  agentDeployments,
  nextCursor,
  environment,
  currentRevision,
  currentDeploymentId,
  priorDeploymentIds,
  canChangeDeployment,
}: {
  organization: string;
  agent: string;
  agentDeployments: AgentDeploymentSummary[];
  nextCursor: string | null;
  environment: string;
  currentRevision: number;
  currentDeploymentId: string | null;
  priorDeploymentIds: string[];
  canChangeDeployment: boolean;
}) {
  const currentDeployment = agentDeployments.find(
    (agentDeployment) => agentDeployment.id === currentDeploymentId,
  );
  return (
    <Section className="rounded-sm bg-transparent">
      <SectionHeader>
        <div>
          <h3 className="text-base font-normal text-foreground">Deployments</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Immutable agent versions, newest first.
          </p>
        </div>
      </SectionHeader>
      <SectionContent className="p-0">
        {agentDeployments.length === 0 ? (
          <EmptyRows text="No deployments have been finalized." />
        ) : (
          agentDeployments.map((agentDeployment) => (
            <AgentDeploymentRow
              key={agentDeployment.id}
              organization={organization}
              agent={agent}
              agentDeployment={agentDeployment}
              environment={environment}
              currentRevision={currentRevision}
              currentDeploymentId={currentDeploymentId}
              currentDeploymentCreatedAt={currentDeployment?.createdAt ?? null}
              wasPreviouslyDeployed={priorDeploymentIds.includes(
                agentDeployment.id,
              )}
              canChangeDeployment={canChangeDeployment}
            />
          ))
        )}
        {nextCursor ? (
          <PaginationLink
            href={`?environment=${encodeURIComponent(environment)}&versionCursor=${encodeURIComponent(nextCursor)}`}
            label="Older deployments"
          />
        ) : null}
      </SectionContent>
    </Section>
  );
}

function AgentDeploymentRow({
  organization,
  agent,
  agentDeployment,
  environment,
  currentRevision,
  currentDeploymentId,
  currentDeploymentCreatedAt,
  wasPreviouslyDeployed,
  canChangeDeployment,
}: {
  organization: string;
  agent: string;
  agentDeployment: AgentDeploymentSummary;
  environment: string;
  currentRevision: number;
  currentDeploymentId: string | null;
  currentDeploymentCreatedAt: string | null;
  wasPreviouslyDeployed: boolean;
  canChangeDeployment: boolean;
}) {
  const current = agentDeployment.id === currentDeploymentId;
  const olderThanCurrent =
    currentDeploymentCreatedAt !== null &&
    new Date(agentDeployment.createdAt).getTime() <
      new Date(currentDeploymentCreatedAt).getTime();
  const mode =
    currentDeploymentCreatedAt !== null
      ? olderThanCurrent
        ? "rollback"
        : "promote"
      : wasPreviouslyDeployed
        ? "rollback"
        : "promote";
  return (
    <div className="border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <p className="truncate text-sm text-foreground">
          {agentDeployment.version}
        </p>
        <p className="shrink-0 text-xs capitalize text-muted-foreground">
          {agentDeployment.state}
        </p>
      </div>
      <p
        className="mt-1 truncate font-mono text-xs text-muted-foreground"
        title={agentDeployment.imageDigest}
      >
        {agentDeployment.imageDigest}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{formatTimestamp(agentDeployment.createdAt)}</span>
        <span title={agentDeployment.id}>{shortId(agentDeployment.id)}</span>
        <span>Desktop {agentDeployment.minimumDesktopVersion}+</span>
        <span>Runtime protocol {agentDeployment.runtimeProtocolVersion}</span>
        {current ? <span>Current in {environment}</span> : null}
      </div>
      {canChangeDeployment &&
      agentDeployment.state === "verified" &&
      !current ? (
        <DeploymentAction
          organization={organization}
          agent={agent}
          environment={environment}
          agentDeploymentId={agentDeployment.id}
          currentRevision={currentRevision}
          mode={mode}
        />
      ) : null}
    </div>
  );
}

function DeploymentHistory({
  environment,
  currentRevision,
  revisions,
  nextCursor,
  versionCursor,
}: {
  environment: string;
  currentRevision: number;
  revisions: AgentEnvironmentRevisionSummary[];
  nextCursor: string | null;
  versionCursor?: string;
}) {
  return (
    <Section className="rounded-sm bg-transparent">
      <SectionHeader>
        <div>
          <h3 className="text-base font-normal capitalize text-foreground">
            {environment} history
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Current revision {currentRevision}.
          </p>
        </div>
      </SectionHeader>
      <SectionContent className="p-0">
        {revisions.length === 0 ? (
          <EmptyRows text="No deployment revisions for this environment." />
        ) : (
          revisions.map((revision) => (
            <DeploymentRow key={revision.revision} revision={revision} />
          ))
        )}
        {nextCursor ? (
          <PaginationLink
            href={deploymentPageHref({
              environment,
              revisionCursor: nextCursor,
              versionCursor,
            })}
            label="Older revisions"
          />
        ) : null}
      </SectionContent>
    </Section>
  );
}

function DeploymentRow({
  revision,
}: {
  revision: AgentEnvironmentRevisionSummary;
}) {
  return (
    <div className="border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm capitalize text-foreground">{revision.action}</p>
        <p className="shrink-0 text-xs text-muted-foreground">
          Revision {revision.revision}
        </p>
      </div>
      <p className="mt-1 truncate text-sm text-foreground">
        {revision.agentDeploymentVersion ?? "Deployment revoked"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {formatTimestamp(revision.createdAt)}
      </p>
    </div>
  );
}

function PaginationLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center px-4 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {label}
    </Link>
  );
}

function EmptyRows({ text }: { text: string }) {
  return <p className="px-4 py-6 text-sm text-muted-foreground">{text}</p>;
}

function selectEnvironment(agent: AgentSummary, requested: string | undefined) {
  return (
    agent.environments.find((environment) => environment.name === requested) ??
    agent.environments.find(
      (environment) => environment.name === "production",
    ) ??
    agent.environments[0] ??
    notFound()
  );
}

function deploymentPageHref(options: {
  environment: string;
  revisionCursor: string;
  versionCursor?: string;
}): string {
  const search = new URLSearchParams({
    environment: options.environment,
    revisionCursor: options.revisionCursor,
  });
  if (options.versionCursor) search.set("versionCursor", options.versionCursor);
  return `?${search.toString()}`;
}

function formatTimestamp(value: string): string {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

function shortId(value: string): string {
  return value.slice(0, 8);
}
