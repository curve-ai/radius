"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AuthenticationSetup({
  organization,
  platformUrl,
}: {
  organization: string;
  platformUrl: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<{
    distribution: string;
    native: string;
  } | null>(null);
  const callback = "http://127.0.0.1:43821/callback";
  function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const data = new FormData(event.currentTarget);
      const issuer = String(data.get("issuer"));
      const resource = String(data.get("resource"));
      const id = String(data.get("id"));
      if (!/^[a-z][a-z0-9.-]{2,100}$/.test(id)) throw new Error();
      for (const input of [issuer, resource]) {
        const url = new URL(input);
        const local = ["127.0.0.1", "localhost"].includes(url.hostname);
        if (
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          (url.protocol !== "https:" && !(local && url.protocol === "http:"))
        )
          throw new Error();
      }
      const scopes = String(data.get("scopes")).trim().split(/\s+/);
      if (!scopes.includes("openid")) throw new Error();
      const common = {
        displayName: String(data.get("name")).trim(),
        organizationSlug: organization,
        agentId: String(data.get("agentId")).trim(),
      };
      setOutput({
        distribution: JSON.stringify(
          {
            id,
            ...common,
            signInName: String(data.get("signInName")).trim(),
            platformUrl,
          },
          null,
          2,
        ),
        native: JSON.stringify(
          [
            {
              ...common,
              issuer,
              clientId: String(data.get("clientId")).trim(),
              redirectUri: callback,
              scopes,
              resource,
            },
          ],
          null,
          2,
        ),
      });
    } catch {
      setError(
        "Check your application identifier, HTTPS provider URLs, and scopes. Include openid.",
      );
    }
  }
  function download(name: string, value: string) {
    const url = URL.createObjectURL(
      new Blob([`${value}\n`], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const field = (
    name: string,
    label: string,
    placeholder: string,
    defaultValue?: string,
  ) => (
    <div className="space-y-2">
      <label htmlFor={name} className="text-sm">
        {label}
      </label>
      <Input
        id={name}
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required
        maxLength={120}
      />
    </div>
  );
  return (
    <form
      onSubmit={generate}
      onChange={() => setOutput(null)}
      className="space-y-10"
    >
      <section className="space-y-5">
        <h2 className="type-md font-normal">
          1. Choose your identity provider
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Use your existing hosted OpenID Connect login, or a Better Auth OAuth
          provider. Users sign in on that provider’s page. Radius never collects
          their password.
        </p>
        <div className="space-y-2">
          <label htmlFor="issuer" className="text-sm">
            OIDC issuer URL
          </label>
          <Input
            id="issuer"
            name="issuer"
            type="url"
            placeholder="https://identity.yourcompany.com"
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="resource" className="text-sm">
            Agent API resource / audience
          </label>
          <Input
            id="resource"
            name="resource"
            type="url"
            placeholder="https://api.yourcompany.com/agent"
            required
          />
        </div>
      </section>
      <section className="space-y-5">
        <h2 className="type-md font-normal">
          2. Register a native application
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          In your provider dashboard, register a public native client with
          authorization-code flow, PKCE S256, and no client secret. Allow the
          agent resource above. Register this exact callback:
        </p>
        <code className="block break-all rounded-md bg-muted p-3 text-sm">
          {callback}
        </code>
        {field(
          "clientId",
          "Registered client ID",
          "Your provider’s public client ID",
        )}
        <div className="space-y-2">
          <label htmlFor="scopes" className="text-sm">
            Scopes
          </label>
          <Input
            id="scopes"
            name="scopes"
            defaultValue="openid profile email"
            required
          />
          <p className="text-xs leading-5 text-muted-foreground">
            Add your agent permission scopes. Add offline_access only if your
            provider supports refresh tokens and returns an ID token when
            refreshing.
          </p>
        </div>
      </section>
      <section className="space-y-5">
        <h2 className="type-md font-normal">3. Configure your application</h2>
        {field("name", "Application name", "Your agent application", "Radius")}
        {field(
          "signInName",
          "Sign-in account name",
          "Account provider or organization",
          "Curve",
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          Shown as “Use your [name] account to continue.” Use the name your
          customers recognize, even when you provide agents to other
          organizations.
        </p>
        {field("id", "Application identifier", "com.yourcompany.agent")}
        {field("agentId", "Bundled agent ID", "The agent ID in your release")}
        <p className="text-sm text-muted-foreground">
          These files contain public configuration only. They do not register
          your client, change server settings, or grant membership.
        </p>
        <Button type="submit">Generate configuration</Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {output && (
          <div className="space-y-5" role="status">
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  download("distribution.json", output.distribution)
                }
              >
                Download desktop configuration
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => download("native-auth.json", output.native)}
              >
                Download Platform configuration
              </Button>
            </div>
            <p className="text-sm leading-6">
              Set RADIUS_NATIVE_AUTH_CONFIG on the Platform API to the contents
              of native-auth.json. Build the Mac app with
              RADIUS_DISTRIBUTION_CONFIG pointing to distribution.json.
            </p>
            <p className="text-sm leading-6 text-muted-foreground">
              Finish membership provisioning and the agent’s token validation
              before distributing the app. The command-line setup also checks
              provider discovery.
            </p>
          </div>
        )}
      </section>
      <a
        className="text-sm underline underline-offset-4"
        href="https://github.com/curve-ai/radius/blob/main/docs/guides/vendor-authentication.md"
        target="_blank"
        rel="noreferrer"
      >
        Provider setup, SDK integration, and verification guide
      </a>
    </form>
  );
}
