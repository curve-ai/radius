# Contributor tooling

- Use the Bun version pinned in `package.json` (currently 1.4.4), including
  dependency installation, tests, and local scripts. Keep CI, container images,
  examples, and development instructions aligned when upgrading it.
- Prefer native `bun check` for TypeScript validation. Run focused checks during
  edits and the owning workspace's `typecheck` script before handoff. Keep
  TypeScript where builds emit JavaScript or declarations, or tooling needs its
  compiler API.
- Use `bun fmt <paths>` after logical edit batches and `bun fmt --check <paths>`
  before handoff. Format only task-owned files in a shared checkout. CI checks
  changed files, so a tooling change does not require formatting the repository.
- Keep ESLint's semantic and framework rules, and native-language checks for
  Rust, Swift, and Python. Formatting does not replace these checks.
- Read applicable scoped `AGENTS.md` files before editing a package. Preserve
  the public, independently usable Radius boundary and avoid credentials or
  private operated-service implementation in this repository.
