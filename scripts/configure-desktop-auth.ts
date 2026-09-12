import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DesktopDistributionSchema } from "../packages/platform-contracts/src/index.js";
import { validateNativeConfiguration } from "../apps/platform-api/src/native-auth.js";
import { HOSTED_AUTH_ISSUER } from "../apps/platform-api/src/auth-configuration.js";

const prompt = createInterface({ input: stdin, output: stdout });
const ask = async (label: string, fallback?: string) =>
  (
    await prompt.question(`${label}${fallback ? ` [${fallback}]` : ""}: `)
  ).trim() ||
  fallback ||
  "";
try {
  console.log(
    "Connect your company sign-in to Radius. No secrets are needed here.\nYour provider must support OpenID Connect, public clients, PKCE S256 and an agent API resource.",
  );
  const displayName = await ask("Application name", "Radius");
  const signInName = await ask(
    "Sign-in account name (provider or organization)",
    "Curve",
  );
  const id = await ask(
    "Application identifier (for example com.yourcompany.agent)",
  );
  const platformUrl = await ask("Platform URL", "http://localhost:3100/");
  const organizationSlug = await ask("Organization slug");
  const agentId = await ask("Bundled agent ID");
  const issuer = await ask(
    "OIDC issuer (Better Auth or your vendor's hosted provider)",
    HOSTED_AUTH_ISSUER,
  );
  const resource = await ask("Agent API resource / audience");
  const redirectUri = await ask(
    "Native callback",
    "http://127.0.0.1:43821/callback",
  );
  console.log(
    `\nRegister a PUBLIC native OAuth client at your provider.\nRedirect: ${redirectUri}\nGrant: authorization_code (and refresh_token if supported)\nToken endpoint authentication: none\nPKCE: S256 required\nResource: ${resource}\nNever put a client secret in this configuration.\n`,
  );
  const clientId = await ask("Registered native client ID");
  const scopes = (
    await ask("Required scopes, space separated", "openid profile email")
  ).split(/\s+/);
  const config = validateNativeConfiguration(
    {
      displayName,
      organizationSlug,
      agentId,
      issuer,
      resource,
      redirectUri,
      clientId,
      scopes,
    },
    new URL(issuer).protocol === "http:",
  );
  const distribution = DesktopDistributionSchema.parse({
    signInName,
    id,
    displayName,
    platformUrl,
    organizationSlug,
    agentId,
  });
  const metadataUrl = new URL(
    `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
  );
  const metadataResponse = await fetch(metadataUrl, {
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!metadataResponse.ok)
    throw new Error("Issuer discovery failed; check the issuer URL.");
  const metadata = (await metadataResponse.json()) as Record<string, unknown>;
  if (
    metadata.issuer !== issuer ||
    !metadata.authorization_endpoint ||
    !metadata.token_endpoint ||
    !metadata.jwks_uri
  )
    throw new Error("Discovery does not match the configured OIDC issuer.");
  if (
    Array.isArray(metadata.code_challenge_methods_supported) &&
    !metadata.code_challenge_methods_supported.includes("S256")
  )
    throw new Error("The provider does not advertise PKCE S256.");
  const folder = path.resolve(
    await ask(
      "Output folder (must not already contain these files)",
      ".radius",
    ),
  );
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, "distribution.json"),
    JSON.stringify(distribution, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(
    path.join(folder, "native-auth.json"),
    JSON.stringify([config], null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    `\nCreated ${folder}/distribution.json and native-auth.json.\nNext:\n1. Set RADIUS_NATIVE_AUTH_CONFIG on the Platform API to the contents of native-auth.json.\n2. Provision issuer/subject membership, or enable the documented self-host allowlist policy.\n3. Implement the SDK authenticate callback in your agent.\n4. Build with RADIUS_DISTRIBUTION_CONFIG pointing to distribution.json.\n5. Run the acceptance checklist in docs/guides/vendor-authentication.md.\n\nDiscovery passed. Client registration, membership and agent API access still need a real sign-in test.`,
  );
} finally {
  prompt.close();
}
