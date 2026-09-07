# Issue tracker: Linear

Issues and specs for this repo live in **Linear**, team **Curve**. Use the Linear
MCP tools for all operations; do not fall back to GitHub Issues or to markdown
files under `.scratch/`.

GitHub is used for code review only. Pull requests reference the Linear issue
they implement.

## Conventions

- **Create an issue**: `save_issue` with `team: "Curve"` and a `title`. Omit `id`
  when creating.
- **Update an issue**: `save_issue` with `id` set to the identifier (e.g.
  `CUR-42`). Prefer `patch` for partial edits over resending the whole
  description.
- **Read an issue**: `get_issue` with the identifier. Add
  `includeRelations: true` to see blocking and related links.
- **Read comments**: `list_comments` with `issueId`. Resolution answers are
  recorded as comments, so a closed issue's comments are the record.
- **List issues**: `list_issues`, filtered by `team`, `state`, `label`,
  `assignee`, or `parentId`.
- **Comment**: `save_comment` with `issueId` and `body` (Markdown, literal
  newlines, no escape sequences).
- **Labels**: `addLabels` / `removeLabels` on `save_issue`. `list_issue_labels`
  to see what exists; `create_issue_label` to add one.
- **Close**: `save_issue` with `state: "Done"`.

Markdown in descriptions and comments is rendered by Linear, which rewrites some
link syntax on save. When editing with `patch`, re-read the current content
first — anchors must match what Linear stored, not what was sent.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a Linear issue in team **Curve**.

## When a skill says "fetch the relevant ticket"

`get_issue` with the identifier, then `list_comments` for its discussion.

## Wayfinding operations

The **map** is a single Linear issue; its decision tickets are **sub-issues**.

- **Map**: an issue labelled `wayfinder:map`, holding the Destination / Notes /
  Decisions-so-far / Not-yet-specified / Out-of-scope body.
- **Child ticket**: an issue created with `parentId` set to the map's identifier.
  Labels: `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or
  `wayfinder:task`.
- **Blocking**: Linear's **native** issue relations, which render the frontier
  visually in Linear's own UI. Add edges with `blockedBy` (or `blocks`) on
  `save_issue`; both are append-only, and `removeBlockedBy` / `removeBlocks`
  undo them. Create issues first, then wire relations in a second pass — issues
  need identifiers before they can reference each other.
- **Frontier query**: `list_issues` with `parentId` set to the map and
  `state` open; drop any issue with an unfinished blocker or an assignee. First
  in map order wins.
- **Claim**: `save_issue` with `assignee: "me"` and `state: "In Progress"` — the
  session's first write, before any work, so concurrent sessions skip it.
- **Resolve**: `save_comment` with the answer, then `save_issue` with
  `state: "Done"`, then append a one-line gist plus link to the map's
  Decisions-so-far.

Research findings that a later session will need must be written into Linear as
comments on their ticket. Scratchpad files are session-local and do not survive.

## Domain docs

- Architecture decision records live in **`docs/architecture/adr/`**, numbered
  sequentially (`008-cli-command-architecture.md`), not in `docs/adr/`.
- Longer-form architecture notes live in `docs/architecture/`.
- There is no root `CONTEXT.md`; create one only when a glossary term is first
  resolved and needs recording.
