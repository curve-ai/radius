# Bundle FX into Radius

This runbook is for Radius maintainers preparing the FX agent inside a macOS
desktop build. It documents the current Apple Silicon packaging path. It does
not publish an FX release, sign the Radius application, notarize it, or grant a
user's Codex account access.

## What Radius bundles

FX is delivered as one bundled agent with two executables:

- the upstream macOS arm64 executable, used by the Electron host for local FX
  authentication and model discovery; and
- the upstream Linux arm64 executable, wrapped in a deterministic OCI image
  and executed inside the Radius-owned microVM.

The prepared resources have this shape:

```text
apps/runtime-host-macos/.build/provider-assets/
├── index.json
└── fx/
    ├── macos-arm64/fx
    ├── notices/
    │   ├── LICENSE
    │   ├── THIRD_PARTY_NOTICES.md
    │   └── CA_BUNDLE_SOURCE.txt
    └── oci-layout/
        ├── blobs/sha256/...
        ├── index.json
        └── oci-layout
```

Electron Builder copies that directory to
`Radius.app/Contents/Resources/agents`. The native executable is not the agent
sandbox: the Linux executable in the OCI layout is the code Radius runs for an
agent session.

## Source files

- `scripts/prepare-fx-agent-macos.sh` pins the upstream FX version, macOS and
  Linux archives, their SHA-256 checksums, and the CA bundle checksum.
- `apps/runtime-host-macos/Config/fx-release-template.json` defines the Radius
  release identity, ACP process, resources, network allowlist, requested
  capabilities, and authentication requirement.
- `apps/runtime-host-macos/Config/bundled-agents.json` maps the stable Platform
  project `proj_radius_fx` to `fx/oci-layout`.
- `scripts/build-binary-agent-oci-layout.sh` creates the deterministic OCI
  layout and embeds the canonical release template in the image configuration.
- `scripts/prepare-bundled-agents-macos.sh` prepares every bundled agent and
  writes the packaged `index.json`.
- `apps/desktop/src/main/bundled-agents.ts` validates and imports packaged
  agents at startup.
- `apps/desktop/package.json` copies the prepared resources into the macOS
  application bundle.

Do not edit files beneath `.build/provider-assets` directly. They are generated
and replaced by the preparation scripts.

## Prepare or update FX

Run all commands from the `radius/` repository root.

1. Inspect the intended upstream FX release and its license/notices. Record the
   exact macOS arm64 and Linux arm64 archive checksums; do not accept a moving
   tag or unverified download.
2. Update `fx_version`, the archive names if necessary, and both archive
   checksums in `scripts/prepare-fx-agent-macos.sh`. Update the pinned CA bundle
   checksum only after independently verifying the new bundle.
3. Update `apps/runtime-host-macos/Config/fx-release-template.json`:
   - Use a new `releaseVersion` for every changed binary, manifest, capability,
     authentication rule, resource limit, CA bundle, or process contract.
   - Keep `image.reference` tagged with exactly the same release version.
   - Leave `image.digest` as the all-zero placeholder. Radius replaces it with
     the verified OCI manifest digest during import.
   - Keep `agentId`, `providerId`, and the stable project mapping unchanged for
     the same logical agent.
4. If the upstream binary changes, start a new integration line such as
   `0.0.6-radius.1`. If only the Radius integration changes, increment the
   Radius suffix, for example `0.0.5-radius.3` to `0.0.5-radius.4`.
5. Prepare FX with the repository's pinned Bun version:

   ```bash
   npx --yes bun@1.3.14 run agent:prepare-fx
   ```

   The script downloads both archives and the CA bundle, verifies all three
   checksums, copies the native macOS executable and notices, and builds the
   Linux OCI layout. It fails before replacing the existing prepared output if
   a checksum or expected executable is invalid.

6. Prepare the complete bundled-agent resource root and index:

   ```bash
   npx --yes bun@1.3.14 run agents:prepare
   ```

7. Inspect the generated result:

   ```bash
   resources=apps/runtime-host-macos/.build/provider-assets
   test -x "$resources/fx/macos-arm64/fx"
   "$resources/fx/macos-arm64/fx" --version
   jq -e '.schemaVersion == 1 and .agents[0].project == "proj_radius_fx" and .agents[0].imageLayout == "fx/oci-layout"' "$resources/index.json"
   jq -e '.imageLayoutVersion == "1.0.0"' "$resources/fx/oci-layout/oci-layout"
   jq -e '.schemaVersion == 2 and (.manifests | length == 1)' "$resources/fx/oci-layout/index.json"
   test -f "$resources/fx/notices/LICENSE"
   test -f "$resources/fx/notices/THIRD_PARTY_NOTICES.md"
   test -f "$resources/fx/notices/CA_BUNDLE_SOURCE.txt"
   ```

## Build and verify the desktop bundle

The normal packaging command rebuilds the runtime helper and bundled-agent
resources before Electron Builder runs:

```bash
npx --yes bun@1.3.14 run package
```

Then verify the actual application resources, not only the staging directory:

```bash
packaged_agents=apps/desktop/dist/mac-arm64/Radius.app/Contents/Resources/agents
test -x "$packaged_agents/fx/macos-arm64/fx"
jq -e '.agents[0].project == "proj_radius_fx"' "$packaged_agents/index.json"
jq -e '.manifests | length == 1' "$packaged_agents/fx/oci-layout/index.json"
test -f "$packaged_agents/fx/notices/LICENSE"
test -f "$packaged_agents/fx/notices/THIRD_PARTY_NOTICES.md"
```

Run the focused contract and import-integrity tests:

```bash
npx --yes bun@1.3.14 run --cwd packages/runtime test
npx --yes bun@1.3.14 run --cwd apps/desktop test
npx --yes bun@1.3.14 run runtime:doctor
```

For a release candidate, launch the packaged application and confirm that:

1. FX appears in Agents without `RADIUS_AGENT_RELEASE_PATH` or another
   development override.
2. A user who has not connected Codex sees FX as delivered but requiring
   authentication.
3. After separately authorized authentication, FX model discovery and a benign
   end-to-end prompt succeed through the microVM runtime.
4. Quitting and relaunching Radius retains the installed release and encrypted
   authentication state in the same Radius profile.

Use the normal Radius profile for an ordinary packaged smoke. Follow the
[desktop testing profile guide](desktop-testing.md) when the test can mutate or
damage persisted state.

## What happens at startup

Before creating the desktop window, Radius reads
`Resources/agents/index.json`, validates the project mappings and relative
paths, verifies the OCI manifest and configuration blobs by size and SHA-256,
and reads the release template embedded in the OCI configuration. The template
version and image reference must match the OCI labels.

Radius then imports the OCI layout into Radius-owned image storage, resolves
the exact manifest digest, writes an immutable descriptor under its content
hash, and atomically selects that descriptor for `proj_radius_fx`. If a bundled
update is invalid, Radius retains the last valid installed descriptor. The
renderer receives only the resulting typed agent inventory.

## Release rules

- Never put credentials, tokens, local profile data, or customer information in
  the OCI layer, release template, bundled index, or notices.
- A capability in the release template is a request, not a grant. Add or expand
  capabilities only when the Radius host transport, policy, and approval path
  are implemented and verified.
- Keep the network allowlist to the domains FX actually requires.
- Preserve the upstream license, third-party notices, source provenance, and
  Radius's modified-integration notices. FX remains a separate Apache-2.0
  component inside the MIT-licensed Radius distribution.
- Packaging success is not signing or notarization proof. A distributable
  Radius build still requires the native helper and application bundle to pass
  the release signing and notarization process.
- Authentication is separate from delivery. Bundling makes FX available;
  connecting a Codex account satisfies the already-delivered agent's declared
  authentication requirement.

The trust and runtime design behind this process is documented in
[ADR-002](../architecture/adr/002-oci-agent-packages.md#bundled-internal-agent-bootstrap).
