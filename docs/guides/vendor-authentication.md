# Connect your authentication system

Radius uses the OpenID Connect login exposed by its bundled Platform origin. The user signs in once in the system browser. Platform validates that identity and membership, and the desktop passes a separate, short-lived access token to your agent. Your agent API remains responsible for its own permissions.

Every desktop bundle has one Platform origin and follows the same native auth flow whether Curve or the operator hosts it. An ordinary Radius build targets `http://localhost:3100/`; a branded distribution embeds its Platform origin, application identity, organization, and agent. Radius does not ask the user to choose a hosting mode or type an endpoint after launch.

The Platform URL and the authentication issuer are independent. An organization
with a registered native client can omit its issuer to use Curve's hosted Better
Auth at `https://app.curvehq.sh/api/auth`. A custom Better Auth installation must
enable its OAuth provider; other OIDC providers use the same public-client flow.
No local identity server or managed Cloud stack is required to use hosted auth.
The organization, client registration, resource, and membership must still exist;
an issuer default does not provision them or grant access.

## Configuration resolution

For each organization's native auth entry, issuer precedence is:

1. The entry's explicit `issuer`.
2. Deployment `RADIUS_AUTH_ISSUER`.
3. Existing deployment `RADIUS_OIDC_ISSUER`.
4. `https://app.curvehq.sh/api/auth`.

Explicit invalid configuration fails startup. Network/discovery errors do not
switch to the hosted issuer. Issuer identity, including path and trailing slash,
is preserved exactly. Host routing selects the organization's entry; membership
remains enforced by Platform after login.

Supply the array as `RADIUS_NATIVE_AUTH_CONFIG`, or set
`RADIUS_NATIVE_AUTH_CONFIG_FILE` to a readable JSON file, but not both. An empty
array deliberately leaves native auth unconfigured. An organization entry may
omit only `issuer`; its registered `clientId`, organization, agent, callback,
resource, and scopes remain required.

For a single organization, the equivalent environment form is:

```dotenv
RADIUS_NATIVE_CLIENT_ID=registered-public-client-id
RADIUS_NATIVE_ORGANIZATION=yourcompany
RADIUS_NATIVE_AGENT_ID=your-agent
RADIUS_NATIVE_RESOURCE=https://api.yourcompany.com/agent
# Optional; omitted issuer uses hosted Better Auth.
# RADIUS_AUTH_ISSUER=https://identity.yourcompany.com/api/auth
RADIUS_NATIVE_SCOPES=openid profile email
```

The callback defaults to `http://127.0.0.1:43821/callback`; set
`RADIUS_NATIVE_REDIRECT_URI` only to the callback registered for that client.
File/JSON configuration takes precedence over the environment field form.
Membership auto-join stays off unless explicitly enabled by the operator.

## Local startup

Put the organization's public native-client configuration array in
`.radius/native-auth.json` and configure `DATABASE_URL` for the existing local
Radius Platform database. Enable sync with `RADIUS_SYNC_ENABLED=true` and a
server-only `RADIUS_SYNC_CURSOR_SECRET`. Secrets do not belong in the native
client file.

`bun run dev` checks native-auth readiness before starting Electron. For the
default `http://localhost:3100/`, if no server is reachable it starts
`bun run platform:dev`, which discovers `.radius/native-auth.json`, and waits
for native discovery. It stops that child when the desktop exits. Explicit
remote endpoints must already be running. A different service occupying port
3100 is reported and is never terminated automatically.

To start Platform separately or diagnose a packaged application's server:

```sh
bun run platform:dev
bun run auth:check http://localhost:3100/
```

The local launcher does not create or migrate an identity provider, bootstrap
an arbitrary organization, or borrow Cloud database credentials. The packaged
desktop connects to its configured Platform; it does not start server services.
A successful readiness check proves discovery, not a completed login or agent
authorization.

## What your provider needs

Use an OAuth 2.0 provider with OpenID Connect discovery and signed ID tokens, authorization-code flow, PKCE S256, public native clients (`token_endpoint_auth_method: none`), and an access token for your agent API's resource/audience. A generic OAuth service without an OIDC identity is not supported by this adapter. A Google login alone is not an access token for your custom API; a broker such as Better Auth can authenticate with Google and issue your API token.

Your provider owns the hosted sign-in page. Radius discovers its authorization endpoint and opens that page directly; it does not render vendor passwords or replace their login with a Curve form. Internal Better Auth installations can use the supplied email-code/Google sign-in and consent screens.

For session renewal, additionally support refresh tokens and return a signed ID token on refresh. If your provider does not return a refreshed ID token, omit `offline_access`; users sign in again when the credential expires. This version fails closed on unsupported refresh behavior.

Identity is `(issuer, subject)`. Email is not used to merge accounts. If your provider uses pairwise subjects, make sure its web and native clients resolve to the same intended identity or explicitly provision the native subject. Never assume the same email proves the accounts are equivalent.

## Guided setup

Organization owners and admins can open **Settings → Company sign-in → Set up authentication** in Platform. The guide explains client registration and generates two public configuration files. It does not change your provider or running servers.

For command-line setup, run from the Radius repository:

```sh
bun run auth:setup
```

The command asks for the application name and identifier, Platform URL, organization, agent ID, issuer, agent API audience, public client ID and scopes. It checks issuer discovery before writing files and refuses to overwrite existing files. It never asks for a client secret. The default Platform address for local development is `http://localhost:3100/`.

Register a separate native OAuth client for each organization. In your provider dashboard register:

| Setting                       | Value                                                                  |
| ----------------------------- | ---------------------------------------------------------------------- |
| Application type              | Native/public                                                          |
| Grant                         | Authorization code; optionally refresh token                           |
| Token endpoint authentication | None                                                                   |
| PKCE                          | Required, S256                                                         |
| Callback                      | `http://127.0.0.1:43821/callback`                                      |
| Resource/audience             | Your agent API identifier                                              |
| Scopes                        | `openid`, identity claims as needed, and the agent's permission scopes |

Register the callback exactly. The listener binds only to IPv4 loopback. If that port is already in use, sign-in reports a recoverable error. The CLI setup permits another explicit port if you register the same URI at the provider. The web setup uses the default port.

## Configure Platform

Example `native-auth.json`:

```json
[
  {
    "issuer": "https://identity.yourcompany.com",
    "clientId": "your-public-native-client",
    "redirectUri": "http://127.0.0.1:43821/callback",
    "scopes": ["openid", "profile", "email", "agent:run"],
    "resource": "https://api.yourcompany.com/agent",
    "organizationSlug": "yourcompany",
    "displayName": "Your company agent",
    "agentId": "your-agent"
  }
]
```

Set `RADIUS_NATIVE_AUTH_CONFIG` on the Platform API to the JSON contents of this file. HTTPS is required for issuer and resource. `RADIUS_OIDC_ALLOW_INSECURE_LOOPBACK=true` allows explicit HTTP loopback development only.

The referenced organization must already exist. Native auto-join is **off by default**. Provision the external issuer/subject using the existing Platform organization-provisioning workflow. For a self-hosted deployment deliberately allowing users from a verified email domain, set:

```dotenv
RADIUS_NATIVE_AUTO_JOIN=true
RADIUS_OIDC_ALLOWED_EMAIL_DOMAINS=yourcompany.com
RADIUS_OIDC_AUTO_JOIN_ROLE=viewer
```

Your ID token must contain a verified email for auto-join. Suspended and removed memberships cannot regain access through auto-join. Managed mode always requires provisioning; the request hostname selects an exact organization from the configuration array and membership is checked again. A managed API must remain reachable only through its trusted proxy, as with existing Platform browser auth.

Enable the existing sync service on the Platform API with `RADIUS_SYNC_ENABLED=true` and a server-only `RADIUS_SYNC_CURSOR_SECRET` of at least 32 random bytes (for example, generate it with `openssl rand -hex 32`). Keep that secret in the server environment, never in either public configuration file. The self-host Compose file forwards these settings. Device enrollment requires the sync routes; startup reports failure if they are not enabled.

Existing browser dashboard login may continue using `RADIUS_OIDC_*`. Configure the same issuer and appropriate identity mapping for web and native clients. Native auth is independently enabled by `RADIUS_NATIVE_AUTH_CONFIG` and does not require a new database schema.

Inspect `GET /api/platform/v1/auth/native/config` on the company Platform origin. It returns public provider configuration and the discovered authorization endpoint. A successful discovery check is not proof of correct client registration or agent authorization.

## Configure and build the desktop

Example `distribution.json`:

```json
{
  "id": "com.yourcompany.agent",
  "displayName": "Your company agent",
  "signInName": "Your company",
  "platformUrl": "https://agents.yourcompany.com/",
  "organizationSlug": "yourcompany",
  "agentId": "your-agent"
}
```

`signInName` is the provider or organization name users recognize for their account. It can differ from the application’s `displayName`, including when you distribute agents to third-party customers. The sign-in subtitle reads “Use your [signInName] account to continue.” It defaults to `Curve` when omitted. The setup command defaults the application name to `Radius`; vendors can override both labels in their bundle configuration. Both setup guides collect this name.

From the Radius repository:

```sh
bun run dev
bun run dev --url http://localhost:3100/
RADIUS_DISTRIBUTION_CONFIG=/absolute/path/distribution.json bun run dev
RADIUS_DISTRIBUTION_CONFIG=/absolute/path/distribution.json bun run make
```

Development also finds `.radius/distribution.json` automatically. The `--url` override belongs to the development launcher and works with either the standard or a branded bundle. Packaged applications use the validated Platform URL embedded at build time. Without a distribution file, that URL is `http://localhost:3100/`. Packaging a branded distribution uses its ID and display name as the application identity. Use a stable ID across updates.

The selected `agentId` must exist in the bundled releases or the development registry. Authentication setup does not build or download the agent: use the existing agent build/bundling workflow. The configured agent must advertise the `radius-oauth` ACP authentication method. For the standard bundle, the desktop accepts the organization and agent returned by the native auth configuration at its local Platform origin. A branded distribution additionally pins both values and rejects a mismatched server response.

Company data lives in a separate `Radius-<distribution-id>` Application Support folder. This first version binds that profile to one account after connection. Signing in as another account is rejected; signing out does not delete encrypted history or silently upload it to the next account. Multi-account profile switching is not implemented.

## Integrate your TypeScript agent

The SDK advertises `radius-oauth` when you provide `authenticate`. Verify the received access token at your API, then use it for requests. Do not accept the presence of a token or its unverified claims as authorization.

```ts
import { defineAgent } from "@curve-ai/sdk";

const api = "https://api.yourcompany.com";

const agent = defineAgent({
  name: "your-agent",
  async authenticate({ accessToken }, signal) {
    // This API validates issuer/signature, audience, expiry, user, tenant,
    // membership and agent:run permission. It returns no credential values.
    const response = await fetch(`${api}/agent/session`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    if (!response.ok) throw new Error("Access denied");
  },
  async run({ authentication, text, signal }) {
    if (!authentication) throw new Error("Sign-in required");
    const response = await fetch(`${api}/agent/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authentication.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: text }),
      signal,
    });
    if (!response.ok) throw new Error("Query failed");
    return response.text();
  },
});

agent.serveStdio();
```

The SDK isolates credentials and sessions per connection, rejects session creation before authentication, and checks credential expiration before prompts. Its development server creates a fresh agent instance for each connection. For custom transport servers, use `createConnectionApp()` per accepted connection; do not share an authenticated app instance across users.

For other languages or custom ACP agents, advertise `authMethods: [{ id: "radius-oauth", name: "Organization sign-in" }]` during initialization and handle:

```json
{
  "methodId": "radius-oauth",
  "_meta": {
    "ai.radius/auth": {
      "accessToken": "<short-lived agent access token>",
      "expiresAt": "<ISO timestamp>"
    }
  }
}
```

This metadata is a Radius extension carried by ACP's `authenticate` request. The host sends it before creating/resuming the session and does not journal the authentication request. Keep it in memory, validate it, and never print it. Platform session and refresh credentials are never sent to the agent.

## Token and session lifecycle

The desktop generates state, nonce and a PKCE verifier, opens your provider and captures its callback. Platform redeems the code using the configured public client, exact callback, verifier and resource, validates the ID token through `openid-client`, and applies existing issuer/subject membership policy. The provider enforces single use of authorization codes. Platform returns its revocable, organization-bound session plus the agent's access token; only the access token enters the runtime.

Credentials are encrypted through the existing Electron safeStorage-backed local vault. They never enter the renderer, distribution file, sync payload or release manifest. Sync enrolls the device before background transfer; full history transfer does not block opening the workspace. Authentication and sync health remain separate.

The host renews supported credentials in the background. Existing agent runs are bounded by the expiry of the token they received; the next run receives the current credential. Sign-out stops active runtime work and sync, clears local credentials, and requests Platform-session revocation. The provider's browser SSO session remains independent. A provider-issued JWT may remain valid until expiry; use short lifetimes and API-side membership checks/introspection when immediate revocation is required. Treat unsupported refresh, identity changes and lost membership as reauthentication/access errors, not successful readiness.

## Verify before distributing

1. Fresh Mac installation shows sign-in before any workspace content. Direct IPC and new agent runs are denied while locked.
2. Sign in through the real configured provider. Confirm there is one interactive login, the exact organization, device enrollment and automatic sync.
3. Run a query that requires your agent API permission. A successful Platform login alone is not this proof.
4. Restart and confirm session restoration. Test token expiry, renewal, cancelled sign-in and a closed browser.
5. Remove/suspend membership and confirm access is denied. Test another account on the same installation: it must not read or sync the previous user's data.
6. Test the signed packaged artifact with its embedded config, not only the development server.
7. Confirm logs and support exports contain no authorization codes, tokens, cookies or PKCE verifiers.

## Troubleshooting

| Symptom                          | Check                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Sign-in not configured           | Platform config array, exact organization slug and request host; native routes are opt-in                        |
| Discovery fails                  | Exact issuer including any path; HTTPS, JWKS, authorization and token endpoints                                  |
| Provider rejects client          | Public native registration, `none` authentication, exact callback, PKCE S256                                     |
| `invalid_target` or scope denied | Register and allow the agent resource and requested scopes for this native client                                |
| Membership denied                | Stable issuer/subject mapping, active organization, explicit provisioning or verified self-host allowlist        |
| Refresh fails                    | Refresh grant enabled and allowed; provider returns an ID token on refresh; otherwise omit offline_access        |
| Agent does not start             | Matching bundled agent ID, `radius-oauth` method, valid audience/scopes and successful SDK authenticate callback |
| Another account error            | The company profile belongs to the first account; sign in with that account                                      |
| Sync temporarily unavailable     | Check Platform sync configuration and network; do not repeat signup to recover sync                              |

The test suite includes a local signed OIDC provider, code replay/PKCE/nonce failures, loopback callback cancellation, and authenticated/unauthenticated ACP connection isolation. A live vendor integration still needs the acceptance checks above.
