# Radius implementation plans

This folder contains executable product and interaction plans for Radius.

## Animation plans

Plans 001-005 were selected from the read-only Radius desktop animation
opportunity sweep.

All plans are stamped at `d04af22`, but they were authored against a dirty
working tree containing pending transcript, connector, and workspace changes.
Before executing, commit or explicitly carry those pending changes into the
execution worktree. Each plan contains a prerequisite excerpt and requires the
executor to stop on drift.

| #   | Plan                                                                              | Severity | Status | Depends on                             |
| --- | --------------------------------------------------------------------------------- | -------- | ------ | -------------------------------------- |
| 001 | [Animate individual trace-row disclosure](001-animate-trace-row-disclosure.md)    | MEDIUM   | DONE   | Current two-level trace UI             |
| 002 | [Animate connector depth transitions](002-animate-connector-depth-transitions.md) | MEDIUM   | DONE   | Current connector category/detail work |
| 003 | [Animate agent authentication state replacement](003-animate-agent-auth-state.md) | MEDIUM   | DONE   | None                                   |
| 004 | [Animate run completion state](004-animate-run-completion.md)                     | MEDIUM   | DONE   | 001                                    |
| 005 | [Animate Copy confirmation](005-animate-copy-confirmation.md)                     | LOW      | DONE   | 001, 004                               |

## Animation execution record

1. **001** — establishes the Motion imports and layout treatment in
   `session-thread.tsx`.
2. **004** — reuses that setup for the coarse run-state transition.
3. **005** — finishes the same file with the smallest feedback transition.
4. **002** — independent connector navigation work.
5. **003** — independent authentication feedback work.

All five plans were executed sequentially in an isolated worktree, reviewed
against the Radius motion bar, and applied to the main checkout with guarded
prerequisite hashes. Each plan remains as the implementation and verification
record.

## Product rendering plans

| #   | Plan                                                                      | Priority | Status | Depends on                         |
| --- | ------------------------------------------------------------------------- | -------- | ------ | ---------------------------------- |
| 006 | [Complete Markdown message rendering](006-complete-markdown-rendering.md) | P0/P1    | DONE   | Current GFM and shadcn table layer |
