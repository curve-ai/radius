import { ThemeSwitch } from "@/components/ui/theme-switch";
import { DeveloperTokenManager } from "@/components/settings/developer-token-manager";
import { OrganizationMemberManager } from "@/components/settings/organization-member-manager";
import type {
  DeveloperTokenSummary,
  OrganizationMembershipSummary,
} from "@curve-ai/platform-client";
import {
  Section,
  SectionContent,
  SectionHeader,
} from "@/components/ui/section";
import {
  canManageDeveloperTokens,
  canManageOrganizationMembers,
} from "@/lib/platform-permissions";
import { getPlatformContext } from "@/lib/platform-server";
import { notFound } from "next/navigation";

export default async function SettingsPage() {
  const { client, info, organization } = await getPlatformContext();
  if (!organization) notFound();

  let tokens: DeveloperTokenSummary[] = [];
  let tokenLoadError: string | undefined;
  let memberships: OrganizationMembershipSummary[] = [];
  let membershipLoadError: string | undefined;
  await Promise.all([
    canManageDeveloperTokens(organization.role)
      ? client
          .listDeveloperTokens(organization.slug)
          .then((response) => {
            tokens = response.tokens;
          })
          .catch(() => {
            tokenLoadError =
              "Developer tokens could not be loaded. Refresh to try again.";
          })
      : Promise.resolve(),
    canManageOrganizationMembers(organization.role)
      ? client
          .listOrganizationMemberships(organization.slug)
          .then((response) => {
            memberships = response.memberships;
          })
          .catch(() => {
            membershipLoadError =
              "Organization members could not be loaded. Refresh to try again.";
          })
      : Promise.resolve(),
  ]);
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-12 pt-8 sm:px-6 sm:pb-16 sm:pt-10">
      <div className="space-y-4">
        <Section className="rounded-sm bg-transparent">
          <SectionHeader>
            <h2 className="text-base font-normal text-foreground">
              Appearance
            </h2>
          </SectionHeader>
          <SectionContent className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Use system, light, or dark appearance.
            </p>
            <ThemeSwitch />
          </SectionContent>
        </Section>
        <Section className="rounded-sm bg-transparent">
          <SectionHeader>
            <div>
              <h2 className="text-base font-normal text-foreground">
                Organization members
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Members appear after their first allowlisted identity-provider
                sign-in.
              </p>
            </div>
          </SectionHeader>
          <SectionContent className="p-0">
            {canManageOrganizationMembers(organization.role) ? (
              <OrganizationMemberManager
                organization={organization.slug}
                memberships={memberships}
                loadError={membershipLoadError}
              />
            ) : (
              <p className="px-4 py-5 text-sm text-muted-foreground">
                Owner access is required to manage organization members.
              </p>
            )}
          </SectionContent>
        </Section>
        <Section className="rounded-sm bg-transparent">
          <SectionHeader>
            <div>
              <h2 className="text-base font-normal text-foreground">
                Developer tokens
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Scoped credentials for the CLI, CI, and repository automation.
              </p>
            </div>
          </SectionHeader>
          <SectionContent className="p-0">
            {canManageDeveloperTokens(organization.role) ? (
              <DeveloperTokenManager
                organization={organization.slug}
                role={organization.role}
                tokens={tokens}
                loadError={tokenLoadError}
              />
            ) : (
              <p className="px-4 py-5 text-sm text-muted-foreground">
                Owner or admin access is required to manage developer tokens.
              </p>
            )}
          </SectionContent>
        </Section>
        <Section className="rounded-sm bg-transparent">
          <SectionHeader>
            <h2 className="text-base font-normal text-foreground">
              Platform connection
            </h2>
          </SectionHeader>
          <SectionContent className="space-y-3 text-sm">
            <Setting
              label="API origin"
              value={client.baseUrl.href.replace(/\/$/, "")}
            />
            <Setting label="Platform version" value={info.platformVersion} />
            <Setting
              label="Manifest versions"
              value={info.supportedAgentManifestVersions.join(", ")}
            />
          </SectionContent>
        </Section>
      </div>
    </main>
  );
}

function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all text-foreground">{value}</span>
    </div>
  );
}
