import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthenticationSetup } from "@/components/settings/authentication-setup";
import {
  getPlatformContext,
  platformPublicApiUrl,
} from "@/lib/platform-server";
export default async function AuthenticationSetupPage() {
  const { organization } = await getPlatformContext();
  if (!organization || !["owner", "admin"].includes(organization.role))
    notFound();
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link
        href="/workspace/settings"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Back to settings
      </Link>
      <h1 className="type-md-lg mb-3 mt-8 font-normal">Connect your sign-in</h1>
      <p className="mb-10 text-sm leading-6 text-muted-foreground">
        One company login for your desktop application and agent.
      </p>
      <AuthenticationSetup
        organization={organization.slug}
        platformUrl={await platformPublicApiUrl()}
      />
    </main>
  );
}
