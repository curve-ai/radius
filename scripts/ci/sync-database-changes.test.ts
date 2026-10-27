import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncDatabaseChanges } from "./sync-database-changes.js";

function fixture(
  run: (repo: {
    root: string;
    base: string;
    git: (...args: string[]) => string;
    write: (file: string, content: string) => void;
    commit: () => string;
  }) => void,
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "radius-ci-diff-"));
  const git = (...args: string[]) => {
    const result = spawnSync(
      "git",
      [
        "-c",
        "user.name=AlexeyShishlyannikov",
        "-c",
        "user.email=shishlyannikov.dev@gmail.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  const commit = () => {
    git("add", ".");
    git("commit", "--quiet", "-m", "Update fixture");
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "--quiet");
    write(
      "package.json",
      JSON.stringify({ workspaces: ["apps/*", "packages/*"] }),
    );
    write(
      "apps/platform-api/package.json",
      JSON.stringify({
        name: "api",
        dependencies: { database: "workspace:*" },
      }),
    );
    write(
      "packages/database/package.json",
      JSON.stringify({
        name: "database",
        dependencies: { contracts: "workspace:*" },
      }),
    );
    write("packages/database/query.ts", "original query\n");
    write(
      "packages/contracts/package.json",
      JSON.stringify({ name: "contracts" }),
    );
    write("packages/contracts/source.ts", "original contract\n");
    write(
      "packages/frontend/package.json",
      JSON.stringify({ name: "frontend" }),
    );
    write("README.md", "original docs\n");
    run({ root, base: commit(), git, write, commit });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("docs and unrelated UI/package source skip the database suite", () => {
  fixture(({ root, base, write, commit }) => {
    write("README.md", "updated docs\n");
    write("apps/desktop/ui.ts", "UI change\n");
    write("packages/frontend/component.ts", "component change\n");
    commit();
    assert.equal(
      syncDatabaseChanges(root, base, "HEAD", "pull_request").required,
      false,
    );
  });
});

test("API, transitive database/contracts, and migrations trigger verification", () => {
  fixture(({ root, git, write, commit }) => {
    for (const file of [
      "apps/platform-api/src/sync/routes.ts",
      "packages/database/query.ts",
      "packages/contracts/source.ts",
      "packages/database/drizzle/0005.sql",
    ]) {
      const base = git("rev-parse", "HEAD");
      write(file, "changed\n");
      commit();
      assert.equal(
        syncDatabaseChanges(root, base, "HEAD", "push").required,
        true,
        file,
      );
    }
  });
});

test("a newly linked transitive workspace is discovered without editing a path list", () => {
  fixture(({ root, write, commit }) => {
    write(
      "packages/contracts/package.json",
      JSON.stringify({
        name: "contracts",
        dependencies: { shared: "workspace:*" },
      }),
    );
    write("packages/shared/package.json", JSON.stringify({ name: "shared" }));
    write("packages/shared/source.ts", "original shared code\n");
    const base = commit();
    write("packages/shared/source.ts", "updated shared code\n");
    commit();
    assert.equal(
      syncDatabaseChanges(root, base, "HEAD", "pull_request").required,
      true,
    );
  });
});

test("lockfiles, manifests, runtime/configuration and the CI harness invalidate the suite", () => {
  fixture(({ root, git, write, commit }) => {
    for (const file of [
      "bun.lock",
      "bunfig.toml",
      "tsconfig.packages.json",
      ".node-version",
      ".github/workflows/ci.yml",
      ".github/actions/shared/action.yml",
      "hosting/docker/compose.self-host.yml",
      "scripts/ci/detector.ts",
      "packages/frontend/package.json",
    ]) {
      const base = git("rev-parse", "HEAD");
      write(
        file,
        file.endsWith("package.json")
          ? JSON.stringify({ name: "frontend", dependencies: {} })
          : "changed\n",
      );
      commit();
      assert.equal(
        syncDatabaseChanges(root, base, "HEAD", "push").required,
        true,
        file,
      );
    }
  });
});

test("renaming a protected file outside its package still triggers verification", () => {
  fixture(({ root, base, git, commit }) => {
    git("mv", "packages/database/query.ts", "moved-outside.ts");
    commit();
    assert.equal(
      syncDatabaseChanges(root, base, "HEAD", "pull_request").required,
      true,
    );
  });
});

test("the whole PR remains affected after a later docs-only commit", () => {
  fixture(({ root, base, write, commit }) => {
    write("packages/database/query.ts", "untested database change\n");
    const previousPush = commit();
    write("README.md", "docs follow-up\n");
    commit();
    assert.equal(
      syncDatabaseChanges(root, previousPush, "HEAD", "push").required,
      false,
    );
    assert.equal(
      syncDatabaseChanges(root, base, "HEAD", "pull_request").required,
      true,
    );
  });
});

test("new branches, unavailable refs and broken manifest discovery run conservatively", () => {
  fixture(({ root, base, write }) => {
    for (const unknown of [undefined, "0".repeat(40), "missing-commit"])
      assert.equal(
        syncDatabaseChanges(root, unknown, "HEAD", "push").required,
        true,
      );
    assert.equal(
      syncDatabaseChanges(root, base, "missing-head", "pull_request").required,
      true,
    );
    write("package.json", "invalid JSON");
    assert.equal(
      syncDatabaseChanges(root, base, "HEAD", "pull_request").required,
      true,
    );
  });
});

test("CLI emits the GitHub job output without dependencies or database access", () => {
  fixture(({ root, base, write, commit }) => {
    write("README.md", "docs only\n");
    commit();
    const output = path.join(root, "github-output");
    const result = spawnSync(
      process.execPath,
      [import.meta.dir + "/sync-database-changes.ts"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          CI_DIFF_BASE: base,
          CI_DIFF_HEAD: "HEAD",
          CI_DIFF_EVENT: "pull_request",
          GITHUB_OUTPUT: output,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, "utf8"), "required=false\n");
  });
});
