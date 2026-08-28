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

Desktop and packaged smokes use the normal Radius profile by default so
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
