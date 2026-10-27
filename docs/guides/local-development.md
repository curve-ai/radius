# Local development

Use the Bun version pinned in package.json (1.4.4), Node.js 22.23.4 or newer,
and Docker Compose or equivalent PostgreSQL, Redis, and registry services.
The native macOS runtime also needs Apple Silicon, macOS 26 and Xcode 26.2.

## Source development

Run from the Radius repository root:

```sh
bun install --frozen-lockfile
cp .env.example .env.local
cp apps/platform-api/.env.example apps/platform-api/.env.local
cp apps/platform-web/.env.example apps/platform-web/.env.local
bun run --cwd hosting infra:up
```

Run each application in its own terminal:

```sh
bun run dev:platform
bun run --cwd apps/platform-jobs dev:local
bun run --cwd apps/platform-web dev:local
bun run dev
```

The dependency stack uses PostgreSQL on port 5441, Redis on 6381, and the registry on 5001.
The source API listens on 3100 and the dashboard on 3200. The desktop launcher
retains main's optional distribution configuration and local-only behavior.
Existing databases are not reset by setup. Do not point development fixtures at
shared or production databases. Existing OIDC/native sign-in configuration is
documented in [vendor authentication](vendor-authentication.md).

## Component-owned tooling

Root build/test/typecheck/lint commands schedule JavaScript tasks through Turbo.
Run focused tasks with `bun run --cwd <app-or-package> <command>`. The desktop
owns its development launcher and packaging entry points, native runtime tools
live with their runtime, and hosting owns Compose and container verification.

Use `bun fmt <changed-paths>` and `bun fmt --check <changed-paths>`.
`bun run ci:verify` runs workspace checks and the desktop bundle. Library builds
emit declarations and remain available through `bun run build` or a focused
package build. Python examples use their own locked upstream ACP dependencies.

Tracked procedures belong beside their component. Temporary investigation code
belongs in ignored .scratch; credentials, populated env files, build products,
and caches remain ignored. Stop source processes with Ctrl+C and stop local
Compose dependencies with `bun run --cwd hosting infra:down`; no volumes are
removed by that command.
