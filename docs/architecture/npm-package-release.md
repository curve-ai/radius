# npm package release boundary

**Status:** Local release artifacts implemented and externally install-verified;
registry publication is not authorized or performed

**Date:** 2026-08-26

## Purpose

The Radius TypeScript authoring and deployment experience must work outside the
source workspace. Workspace source manifests remain `private: true` so an
ordinary root command cannot publish by accident. The release pipeline stages
separate public manifests from reviewed built output.

## First release graph

The first coherent npm release unit contains seven packages at one version:

```text
@curve-ai/agent-contracts
├── @curve-ai/build
└── @curve-ai/platform-contracts
    └── @curve-ai/platform-client

@curve-ai/radius-runtime
@curve-ai/sdk

@curve-ai/cli
├── agent-contracts
├── build
├── platform-client
└── radius-runtime
```

Publishing only the CLI or SDK while their exact-version public dependencies
are unavailable is invalid. The graph is prepared and verified as one release
set.

## Artifact rules

`scripts/npm-release.ts`:

1. requires built `dist/index.js` and `dist/index.d.ts` for every package and
   retains the SDK's explicit `dist/development.*` WebSocket entrypoint;
2. excludes test output and all source/workspace-only files;
3. stages a public manifest with `private` removed, Node 22 engines, dist-only
   exports, public access metadata, repository links, and exact dependencies;
4. includes the Radius MIT license, third-party notices, and a package
   description;
5. creates npm tarballs and a SHA-256/size release manifest; and
6. installs and executes the complete graph in a clean external project.

The CLI build emits both its self-contained executable `dist/cli.js` and a
runtime library entrypoint `dist/index.js`; declaration output retains the
public package relationships. The native `@napi-rs/keyring` adapter remains an
external exact dependency so the package manager selects the correct optional
platform binary; native binaries are not embedded into the JavaScript bundle.

## Pre-publication verification

Exact sibling versions do not exist in the public registry before the first
publish. To test without weakening the real artifacts, verification:

- preserves and checksums each release tarball unchanged;
- extracts those exact tarballs into a temporary mirror;
- rewrites only internal unpublished sibling locators to topologically prior
  temporary tarballs;
- resolves all third-party dependencies from `https://registry.npmjs.org/`
  with an isolated npm configuration; and
- imports `@curve-ai/sdk`, `@curve-ai/sdk/development`,
  `@curve-ai/agent-contracts`, and
  `@curve-ai/platform-client`, then runs packaged CLI help, init, and validate.

This mirror is temporary and is never a publish artifact.

## Commands

Verify without retaining artifacts:

```bash
bun run release:npm:verify
```

Build a reviewable local release set under the ignored `.radius` tree:

```bash
bun run release:npm:pack
```

The pack command refuses a non-empty output directory. Publishing, changing
package names/scopes, creating npm credentials, tags, provenance attestations,
or GitHub releases remains a separate explicit release action.

## Python SDK companion

The first-party `radius-agent-sdk` wheel has a parallel external-release check:

```bash
bun run release:python:verify
```

It builds the wheel twice with the deterministic ZIP epoch and requires equal
SHA-256 digests, rejects tests/cache files, verifies package/dependency/Python
metadata and the embedded MIT license, installs into a fresh Python 3.12 virtual
environment using the public PyPI index, imports `define_agent`, and constructs
an agent. PyPI publication is not performed.
