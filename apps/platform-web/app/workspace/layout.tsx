import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { getPlatformContext } from "@/lib/platform-server";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { authMode, info, identity, organization } = await getPlatformContext();
  return (
    <WorkspaceShell
      info={info}
      identity={identity}
      organization={organization}
      authMode={authMode}
    >
      {children}
    </WorkspaceShell>
  );
}
