# Contributing to Radius

Radius executes code and brokers access to user files and tools. Changes to permissions, IPC, package execution, credentials, updates, or protocol compatibility require careful design and adversarial review.

## Before writing code

- Search existing issues and architecture decisions.
- Open an issue for new capabilities, protocol changes, dependencies with native privileges, or changes to a trust boundary.
- Keep pull requests focused. Separate mechanical refactors from behavior changes.
- Submit only code, documentation, and assets that you have the right to
  license under MIT.

## Local checks

```bash
bun install
bun run typecheck
bun run lint
bun run test
bun run package
```

Add focused tests as runtime and protocol packages are introduced. Security-sensitive behavior must include failure-path coverage.

Desktop development and packaged-app verification use the normal Radius profile by default so
persistence is exercised across launches. Use an isolated clone only for
database-sensitive or destructive work. See
[`docs/guides/desktop-testing.md`](docs/guides/desktop-testing.md).

## Pull requests

Describe:

- The user or developer problem.
- The boundary or package changed.
- Security and compatibility implications.
- How the change was verified.
- Follow-up work deliberately left out.

Never include credentials, customer data, private source code, proprietary prompts, or internal service details in issues, fixtures, logs, or screenshots.

## Task and file ownership

Run commands in the owning app/package. The root build, test, typecheck, and
lint commands delegate to Turbo; component-only tasks stay local.
Python examples use `uv` and their own `pyproject.toml`, for example:

```sh
uv run --directory examples/python-agent pytest
uv run --directory examples/python-agent ruff check .
```

A workspace package should have an independently useful API, multiple consumers,
or its own build/release boundary. Keep implementation details inside their
owner rather than introducing another package for every module.

Check in repeatable setup, build, release, and test procedures beside their
owner. Use the ignored `.scratch/` directory for personal utilities,
investigations, temporary repair scripts, and generated reports. Keep local
credentials, caches, environments, and build output untracked. A procedure run
once per machine can still be reusable contributor tooling.

The root `.env.local` holds shared local-stack addresses. Service-only settings
belong in each application's ignored `.env.local`, based on its `.env.example`.
`dev:local` commands load the shared file followed by the app file. Existing
root environment overrides remain supported.

Hosting operations belong to `hosting/package.json`. Its `test:integration`
command builds and exercises a disposable stack; `verify:images` inspects
multi-architecture build artifacts. Run these for hosting/release changes,
rather than as routine unit tests.

## Cached verification

`bun run ci:verify` schedules JavaScript typechecks, lint, tests, and the desktop
bundle together. Turbo caches successful pure checks and tracks dependency
source changes through the output-free `check:inputs` graph. Library builds
cache their `dist/` output. Desktop and dashboard builds remain uncached because
they can read injected distribution/runtime configuration; the desktop bundle
always rebuilds in CI. Database-backed sync verification, Python checks, native
packaging, hosting operations, and release publication run outside this cache.

Task hashes include shared TypeScript/tooling configuration, environment-file
contents, relevant environment values, and CI OS/architecture/runtime versions.
The desktop also tracks its tooling imports from Platform API source. Update
these inputs when adding cross-package imports outside declared dependencies.
The per-checkout `.turbo/` directory is generated and ignored.

GitHub Actions restores Turbo results between commits and caches Bun/Electron
downloads separately. Cache entries are separated by OS, architecture, and
Bun/Node versions. It never restores an entire `node_modules` tree. Successful
verification results are saved before the independent dependency audit, so an
audit failure does not throw away completed check work. No remote-cache account
or credentials are required.

Use `bunx turbo run <task> --dry=json` to inspect task inputs and hashes.
Use `bunx turbo run <task> --force` when an uncached verification is needed.

## Desktop releases

`.github/workflows/desktop-release.yml` builds the desktop app for macOS arm64,
Windows x64, and Linux x64 and attaches it to a draft GitHub release. There is
no Intel macOS build: the macOS runtime host needs Apple Silicon.

Nobody edits the desktop version by hand. Released versions live in
`desktop-v*` tags, and `main` may carry an older version in `package.json`.

1. Optionally, run **Desktop release** manually with `dry-run` set. It builds
   every platform and keeps the files, `radius-desktop.json`, and `SHA256SUMS`
   as workflow artifacts without publishing anything.
2. Run **Desktop release cut** and choose `patch`, `minor`, or `major`, or
   give an exact version. It bumps the newest stable `desktop-v*` tag (or
   `package.json` before the first release), commits only
   `apps/desktop/package.json`, pushes the `desktop-v<version>` tag, and builds
   the draft release from it. A version that is not newer than the latest
   release is refused.
3. Check the draft release, then publish it and mark it as the latest
   release. The auto-updater and the CLI only see published releases, and the
   updater follows the repository's latest release, so other releases must not
   take that place.

Pushing a `desktop-v<version>` tag by hand still builds a release, provided the
tagged `apps/desktop/package.json` carries that version.

Every release carries `radius-desktop.json`, which the radius CLI reads to
install the app: per-platform archive URLs, SHA-256 digests, and sizes, plus the
development agent descriptor versions the app reads.
`apps/desktop/scripts/release-manifest.ts` writes it and
`apps/desktop/scripts/release-manifest.schema.json` documents it. Change both
only in ways an already-released CLI still accepts. The dmg and the NSIS
installer are attached for people but are not listed in the manifest.

Signing turns on for a platform when its repository secrets exist. Without
them, the same workflow produces unsigned builds.

| Secret                         | Purpose                                                      |
| ------------------------------ | ------------------------------------------------------------ |
| `MACOS_CERTIFICATE_P12`        | Base64 Developer ID Application certificate and key (`.p12`) |
| `MACOS_CERTIFICATE_PASSWORD`   | Password for that `.p12`                                     |
| `APPLE_API_KEY_P8`             | App Store Connect API key (`.p8` contents) for notarization  |
| `APPLE_API_KEY_ID`             | That key's ID                                                |
| `APPLE_API_ISSUER`             | That key's issuer ID                                         |
| `WINDOWS_CERTIFICATE_PFX`      | Base64 code signing certificate and key (`.pfx`)             |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password for that `.pfx`                                     |

Notarization runs only for a signed macOS build.

An unsigned macOS build has no Apple Team ID, so macOS ties keychain access to
each build. After every install or update, Radius must ask for the user's login
password before it can read the key that protects its local storage. A signed
build with the same certificate does not ask again; a self-signed certificate
does not help. The workflow adds this explanation to the draft release notes
whenever the macOS build is unsigned.
