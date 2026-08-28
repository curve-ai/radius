# Radius Platform database

This package contains the approved PostgreSQL 17 Drizzle schema, generated and
custom Drizzle migrations, typed relations, and node-postgres-backed Drizzle
connection foundation for the open Radius Platform.

The schema and migration boundaries are:

```text
src/schema/             domain-split Drizzle PostgreSQL models and relations
drizzle/                generated core plus reviewed custom invariant migration
```

Run static verification or apply to an explicitly selected database:

```bash
npx bun@1.3.14 run --cwd packages/platform-database typecheck
npx bun@1.3.14 run --cwd packages/platform-database test
DATABASE_URL=postgresql://... npx bun@1.3.14 run --cwd packages/platform-database migrate
```

The runner takes a session advisory lock and uses Drizzle's migration ledger to
apply checked-in migrations. The tests parse both generated and custom SQL with
the PostgreSQL 17 parser and assert the core integrity boundaries without
connecting to a database.

Platform repositories execute through the Drizzle database and transaction
adapter. Reviewed PostgreSQL SQL remains for advisory locks, `SKIP LOCKED`,
append-only enforcement, and complex revision-checked operations; parameter
binding and transaction ownership stay inside Drizzle.

`bootstrapPlatformOwner` provides the one-time initial ownership transaction.
It takes a separate advisory lock, refuses to run once any organization exists,
creates the account/organization/owner/token/audit subjects atomically, grants
the explicit owner scope set, and returns the generated token only to the
calling operator process. PostgreSQL receives only the token hash and prefix.
