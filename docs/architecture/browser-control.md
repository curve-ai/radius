# Authenticated browser control

## Purpose

Radius lets a provided agent use the user's existing Chrome or Edge profile
without giving the agent a browser-profile directory, cookie export, extension
credential, or raw DevTools connection. The provided agent retains its own
reasoning loop. Radius supplies and governs browser tools.

## Implemented path

```text
Provided agent in a Radius microVM
    │ run-scoped MCP tools supplied in ACP session/new
    ▼
Radius browser MCP provider
    │ bearer token plus guest-source validation
    ▼
Electron browser bridge
    │ authenticated Unix socket
    ▼
Chrome native-messaging host
    │ extension-ID allowlist
    ▼
Radius Manifest V3 extension
    │ tab-scoped chrome.debugger attachment
    ▼
Existing authenticated Chrome or Edge tabs
```

The MCP endpoint exists only for the agent run that receives it. The token is
generated for that run, passed through the ACP session request, and discarded
when the run ends. The endpoint accepts the Radius microVM guest address and
loopback for local tests. It rejects browser Origins and requests without the
exact bearer token.

The native-messaging host is a small relay. Chrome starts it with the extension
origin, and Radius registers a manifest that accepts only the Radius extension
ID. The relay reads the current socket path and token from a private
device-local configuration file. No connector or model credential crosses this
boundary.

## Agent contract

An agent release requests browser capabilities in its immutable release
descriptor. Radius currently recognizes browser-prefixed requests and supplies
one HTTP MCP server to that ACP session. The implemented tools cover:

- list, create, activate, and close tabs;
- HTTP and HTTPS navigation;
- bounded accessibility snapshots with page-revision element references;
- reference or coordinate clicks;
- editable-element input, supported keys, and viewport scrolling;
- bounded JPEG viewport screenshots; and
- short waits for asynchronous page changes.

Element references are scoped to one controlled tab and one accessibility
snapshot revision. Navigation invalidates them. A stale reference fails
explicitly so the agent reads the page again instead of guessing.

The extension creates normal tabs in the connected browser profile. Those tabs
use the profile's existing site sessions and installed extensions. Radius does
not read or serialize cookie values. Existing tabs remain useful when an
application stores workflow state in the tab rather than the shared profile.

## Permission behavior

The browser provider does not become a second agent loop. The installed agent
chooses browser steps, while Radius and the agent's ACP permission path govern
whether each MCP call may proceed.

The current local-alpha enforcement remains intentionally narrow:

- MCP approval is independent of Ask, Project, or Full access.
- A request can allow one invocation, remember one exact tool through ACP, or
  create a local provider-wide grant for the Radius browser MCP server.
- A provider-wide grant bypasses later tool-call prompts for that server. It
  does not authorize a browser capability absent from the immutable release.
- Every MCP tool invocation is reauthorized inside the host against the exact
  browser capabilities requested by the immutable release. The run token
  authenticates the caller but never grants an operation.
- The browser MCP endpoint is never supplied to a release that did not request
  a browser-prefixed capability.
- The extension can pause its entire profile connection and detaches every
  controlled tab when paused.

The approved capability-authorization model still governs the production
direction. Browser provider-wide grants and their append-only revocations are
durable local state and do not enter sync v1.

## Browser presentation

Before a click, input, or scroll action, the extension resolves the real target
coordinate and moves a pointer-inert Radius cursor overlay to that coordinate.
The click pulse uses opacity only. The movement becomes immediate when the page
reports reduced-motion preference. The cursor reflects the executed target and
is not an independent decorative animation.

Chrome also displays an `ON` extension badge for controlled tabs. Detaching the
debugger removes the badge. The Radius settings surface reports the connected
browser profile and controlled-tab count through the sandboxed preload API.

## Setup and packaging

`bun run browser:build` produces:

- `apps/browser-extension/dist`, loadable as an unpacked extension for local
  development;
- `apps/browser-native-host/dist/index.cjs`, executed through Electron's bundled
  Node runtime; and
- the browser protocol and MCP provider packages.

At desktop startup on macOS, Radius registers per-user native-messaging
manifests for Chrome and Edge. Packaged builds carry the extension and native
host as resources. The settings action reveals the exact extension directory
for development setup.

A production release still needs Chrome Web Store publication, a reviewed
extension privacy disclosure, and managed-browser deployment documentation.
Managed macOS environments may allow or force-install the extension through
Chrome policy. Radius must validate that `debugger` and native-messaging
permissions are acceptable with the device owner before an external pilot.

## Current limitations

- macOS is the implemented native-host registration platform.
- One Chrome or Edge profile connection is active in one Radius desktop
  process.
- Incognito, browser-internal pages, cookie export, downloads, uploads,
  clipboard, geolocation, camera, microphone, arbitrary JavaScript, raw DOM,
  network bodies, and unrestricted CDP are not exposed.
- An existing debugger attached by DevTools or another extension can make a tab
  unavailable.
- Interactive approval UI is not complete. Ask mode therefore fails closed.
- Profile-wide tab discovery is powerful. Installation copy and enterprise
  policy must disclose that the extension can inspect and control ordinary
  tabs while browser access is enabled.

## Verification gates

Before an authenticated-browser pilot:

1. Verify extension load, native-host connection, tab listing, authenticated
   new-tab state, accessibility references, cursor position, input, navigation,
   screenshot, pause, detach, and browser restart recovery.
2. Verify no cookie value, browser-profile path, extension token, or raw CDP
   endpoint reaches the agent runtime or session history.
3. Verify two concurrent agent runs cannot control the same tab without an
   explicit lease policy.
4. Verify supported SSO, MFA, passkey, and user-takeover behavior on each pilot
   work application.
5. Complete the production capability resolver and interactive approval
   presentation before replacing fail-closed Ask behavior.
