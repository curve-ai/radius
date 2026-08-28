# Desktop testing profiles

## Default: use the normal Radius profile

Development, packaged application, agent-runtime, authentication, persistence,
and ordinary end-to-end smoke tests use the normal Radius profile:

```text
~/Library/Application Support/Radius/
```

Launch without `RADIUS_USER_DATA_PATH`:

```bash
bun run dev
```

or launch the packaged application normally. This keeps sessions, messages,
projects, credentials, installed agent releases, and runtime state visible
across dev and packaged builds. A successful smoke should remain visible after
Radius is closed and relaunched.

Do not create a new profile merely to test UI behavior, agent prompts, model
selection, packaged-agent discovery, OAuth, persistence, or ordinary recovery.
These paths should exercise the same data a developer actually uses.

Only one Radius/Electron instance may open a profile at a time. Sharing the
normal profile means sequential dev and packaged runs, not concurrent processes
against the same encrypted libSQL database.

## When isolation is justified

Use a cloned profile only for work that may intentionally damage, replace, or
invalidate local state:

- schema or migration verification;
- destructive deletion and retention tests;
- corrupted-database or credential-vault recovery;
- authentication disconnect/revocation edge cases;
- tests that require a known frozen dataset;
- parallel end-to-end workers;
- compatibility checks against an older database snapshot.

Unit and integration tests that already create temporary databases remain
isolated. They do not need a copy of the desktop profile.

## Clone the normal profile

Quit every Radius dev and packaged process first, then run:

```bash
bash scripts/clone-desktop-test-profile.sh <short-name>
```

The script refuses to copy while the main database is open. It creates:

```text
~/Library/Application Support/Radius/test-profiles/<short-name>/
```

and copies the encrypted database plus its matching credential vault. These
files are one cryptographic unit. Never copy `radius.db` without
`credential-vault.json`, or combine a database and vault from different
profiles.

Run an explicitly isolated test with the path printed by the script:

```bash
RADIUS_USER_DATA_PATH="<printed-path>" bun run dev
```

The clone preserves durable product records. Renderer navigation state and
Chromium caches are intentionally not copied, so the test may open on New chat
even though its sessions appear in Recents.

## Reporting verification

Always state which profile was exercised:

- `normal Radius profile` for the default Application Support database;
- `cloned profile: <short-name>` for database-sensitive testing;
- `temporary unit database` for automated storage tests.

Do not report persistence across launches unless both launches used the same
profile and the second launch visibly read the first launch's records.
