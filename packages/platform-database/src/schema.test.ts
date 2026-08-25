import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
  authRateLimits,
  betterAuthSchema,
  connectorCatalogEntries,
  deployments,
  groupAssignments,
  policyDeviceAssignments,
  policyGroupAssignments,
  policyMembershipAssignments,
  policyProjectAssignments,
  projects,
  syncedSessions,
  userAssignments,
  workspaceProjects,
} from "./schema/index.js";

test("separates platform agent projects from synced workspace projects", () => {
  assert.equal(getTableConfig(projects).schema, "platform");
  assert.equal(getTableName(projects), "projects");
  assert.equal(getTableConfig(workspaceProjects).schema, "sync");
  assert.equal(getTableName(workspaceProjects), "workspace_projects");
  assert.equal(getTableConfig(syncedSessions).schema, "sync");
});

test("keeps Better Auth and connector catalog in explicit schemas", () => {
  assert.equal(betterAuthSchema.rateLimit, authRateLimits);
  assert.equal(getTableConfig(authRateLimits).schema, "auth");
  assert.equal(getTableConfig(connectorCatalogEntries).schema, "connectors");
});

test("uses typed assignment subjects instead of polymorphic targets", () => {
  assert.equal(getTableName(userAssignments), "user_assignments");
  assert.equal(getTableName(groupAssignments), "group_assignments");
  assert.equal(getTableName(policyProjectAssignments), "policy_project_assignments");
  assert.equal(getTableName(policyGroupAssignments), "policy_group_assignments");
  assert.equal(
    getTableName(policyMembershipAssignments),
    "policy_membership_assignments",
  );
  assert.equal(getTableName(policyDeviceAssignments), "policy_device_assignments");
  assert.equal(getTableConfig(deployments).schema, "platform");
});

test("ships a fresh-database bootstrap and the security migration", async () => {
  const migrationsDirectory = new URL("../migrations/", import.meta.url);
  const journal = JSON.parse(
    await readFile(new URL("meta/_journal.json", migrationsDirectory), "utf8"),
  ) as { entries: Array<{ tag: string }> };
  assert.deepEqual(
    journal.entries.map((entry) => entry.tag),
    ["0000_strong_leper_queen", "0001_security"],
  );

  const baseline = await readFile(
    new URL("0000_strong_leper_queen.sql", migrationsDirectory),
    "utf8",
  );
  for (const schema of ["auth", "platform", "sync", "connectors", "audit"]) {
    assert.match(baseline, new RegExp(`CREATE SCHEMA IF NOT EXISTS "${schema}"`));
  }
});
