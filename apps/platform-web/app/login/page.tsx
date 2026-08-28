import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";
import {
  platformPublicApiUrl,
  platformWebAuthMode,
} from "@/lib/platform-server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string; error?: string }>;
}) {
  if (platformWebAuthMode() === "development-token") redirect("/workspace");
  const query = await searchParams;
  const returnTo = normalizeReturnTo(query.return_to);
  const providerUnavailable = query.error === "not_configured";
  const loginUrl = new URL(
    "/api/platform/v1/auth/oidc/login",
    platformPublicApiUrl(),
  );
  loginUrl.searchParams.set("return_to", returnTo);

  return (
    <main className="flex min-h-dvh items-center bg-background px-4 py-12 text-foreground sm:px-6">
      <div className="mx-auto w-full max-w-sm">
        <Wordmark size="md" />
        <h1 className="type-md mt-10 font-normal">Sign in to Radius</h1>
        <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">
          Use your organization identity to open this workspace.
        </p>
        {query.error && (
          <p
            role="alert"
            className="mt-5 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm leading-5 text-destructive"
          >
            {providerUnavailable
              ? "Identity provider is not configured for this workspace."
              : "Sign in could not be completed. Try again."}
          </p>
        )}
        {providerUnavailable ? (
          <Button className="mt-8 w-full" size="lg" disabled>
            Sign in unavailable
          </Button>
        ) : (
          <Button asChild className="mt-8 w-full" size="lg">
            <a href={loginUrl.href}>Continue with identity provider</a>
          </Button>
        )}
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Access is limited by your organization membership and role.
        </p>
      </div>
    </main>
  );
}

function normalizeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.length > 2048) {
    return "/workspace";
  }
  return value;
}
