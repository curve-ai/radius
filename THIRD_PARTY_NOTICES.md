# Third-party notices

Third-party components distributed with Radius retain their original licenses,
copyrights, and notice requirements. The MIT License in the repository
root applies to first-party Radius source and does not replace those terms.

## macOS runtime host

The direct and transitive dependency notice for the native runtime host is
maintained in
[`apps/runtime-host-macos/THIRD_PARTY_NOTICES.md`](apps/runtime-host-macos/THIRD_PARTY_NOTICES.md).
Release packaging must continue to generate and ship its complete resolved
dependency inventory.

## Agent release artifacts

Bundled or downloaded agent release artifacts carry their own license and
third-party notice files beside the agent payload. Radius packaging must retain
those files and must not imply that the root MIT License relicenses an
agent implementation.

## Browser MCP provider

The browser provider uses the MIT-licensed Model Context Protocol TypeScript
SDK packages `@modelcontextprotocol/server` and `@modelcontextprotocol/node`.
Their licenses remain available in the installed dependency tree and must be
retained in any generated dependency inventory distributed with Radius.

## Desktop file-type icons

The Radius desktop uses the MIT-licensed `material-icon-theme` package for
file-type artwork shown beside transcript file links. Its license remains in the
installed dependency tree and must remain in generated release inventories.

## Python agent SDK

The Radius Python SDK depends on the Apache-2.0-licensed official Agent Client
Protocol Python package, `agent-client-protocol`. Its license and notices must
remain present in Python distributions and generated dependency inventories.
Radius's root MIT License does not relicense that dependency.

## TypeScript agent SDK and CLI

The TypeScript SDK/runtime use the Apache-2.0-licensed official Agent Client
Protocol package, `@agentclientprotocol/sdk`. The CLI uses the MIT-licensed
`@napi-rs/keyring` package and its platform-specific native packages to access
macOS Keychain, Windows Credential Manager, and Linux keyring services. Their
licenses remain available in the installed dependency graph and must remain in
generated release inventories. Radius's root MIT License does not relicense
those dependencies.

## macOS Seatbelt policy foundation

The Radius desktop's macOS command sandbox includes adapted policy fragments
from OpenAI Codex `rust-v0.133.0`, licensed under Apache-2.0. The adapted files
retain source attribution beside the policy text. OpenAI's copyright and
Apache-2.0 terms apply to those fragments; Radius's root MIT License does not
relicense them.

## Platform OIDC client

The Platform API uses the MIT-licensed `openid-client` package and its resolved
MIT-licensed JOSE/OAuth dependencies for OpenID Connect discovery,
Authorization Code + PKCE, and ID-token validation. Their licenses remain in
the installed dependency tree and generated dependency inventories.

## Self-host container services

The self-host Compose distribution runs separate third-party container images:
Caddy under Apache-2.0, CNCF Distribution under Apache-2.0, Valkey under
BSD-3-Clause, and PostgreSQL under the PostgreSQL License. These images are not
relicensed by Radius. Operators must retain their image metadata, licenses, and
notices when mirroring or redistributing the stack.
