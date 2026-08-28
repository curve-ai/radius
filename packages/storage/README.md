# Radius embedded storage

The Radius desktop owns an encrypted embedded libSQL/SQLite database through
Drizzle. The renderer and agent runtimes never receive the database path or a
raw connection.

The unchanged 61-table physical model is organized by domain:

```text
src/schema/
├── common.ts
├── workspace.ts
├── agents.ts
├── connectors.ts
├── sync.ts
├── scheduling.ts
└── index.ts
```

`src/schema.ts` is a compatibility barrel only. New schema definitions belong
in the relevant domain module. `drizzle.config.ts` reads `schema/index.ts`, and
committed SQL migrations remain under `drizzle/`.

After a schema-only refactor, run `drizzle-kit generate` and require the result
to report no changes. Existing desktop databases must never be reset merely to
reorganize TypeScript files.
