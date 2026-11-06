import assert from "node:assert/strict";
import test from "node:test";

import {
  composerDraftContextKey,
  ComposerDraftWriteQueue,
} from "./composer-draft-write-queue";

test("uses distinct keys for standalone, project, and session drafts", () => {
  assert.notEqual(
    composerDraftContextKey({ kind: "new_chat", projectId: null }),
    composerDraftContextKey({ kind: "new_chat", projectId: "standalone" }),
  );
  assert.notEqual(
    composerDraftContextKey({ kind: "new_chat", projectId: "session:one" }),
    composerDraftContextKey({ kind: "session", sessionId: "one" }),
  );
});

test("serializes draft writes and clears in order for one context", async () => {
  const queue = new ComposerDraftWriteQueue();
  const operations: string[] = [];
  let releaseFirst: (() => void) | undefined;
  let markFirstStarted: (() => void) | undefined;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });

  const first = queue.enqueue("session:one", async () => {
    operations.push("save:first:start");
    markFirstStarted?.();
    await firstBlocked;
    operations.push("save:first:end");
  });
  const idle = queue.waitForIdle("session:one");
  const second = queue.enqueue("session:one", async () => {
    operations.push("save:second");
  });
  const clear = queue.enqueue("session:one", async () => {
    operations.push("clear");
  });

  await firstStarted;
  assert.deepEqual(operations, ["save:first:start"]);
  releaseFirst?.();
  await idle;
  assert.deepEqual(operations, [
    "save:first:start",
    "save:first:end",
    "save:second",
    "clear",
  ]);
  await Promise.all([first, second, clear]);
});

test("continues a context queue after a failed draft write", async () => {
  const queue = new ComposerDraftWriteQueue();
  const operations: string[] = [];
  const failed = queue.enqueue("new_chat:standalone", async () => {
    throw new Error("write failed");
  });
  const recovered = queue.enqueue("new_chat:standalone", async () => {
    operations.push("latest");
  });

  await assert.rejects(failed, /write failed/);
  await recovered;
  assert.deepEqual(operations, ["latest"]);
});

test("flushing one project does not inherit another project's save failure", async () => {
  const queue = new ComposerDraftWriteQueue();
  const firstProject = composerDraftContextKey({
    kind: "new_chat",
    projectId: "first",
  });
  const secondProject = composerDraftContextKey({
    kind: "new_chat",
    projectId: "second",
  });
  await assert.rejects(
    queue.enqueue(firstProject, async () => {
      throw new Error("first project failed");
    }),
    /first project failed/,
  );

  await queue.enqueue(secondProject, async () => undefined);
  await queue.flush(secondProject);
  await assert.rejects(queue.flush(firstProject), /first project failed/);

  await queue.enqueue(firstProject, async () => undefined);
  await queue.flush(firstProject);
});

test("flush reports a failed scheduled save after its queue entry is cleaned up", async () => {
  const queue = new ComposerDraftWriteQueue();
  const save = queue.scheduleLatest(
    "session:failed",
    async () => {
      throw new Error("save failed");
    },
    10_000,
  );
  const rejected = assert.rejects(save, /save failed/);
  await assert.rejects(queue.flush("session:failed"), /save failed/);
  await rejected;
  await assert.rejects(queue.flush("session:failed"), /save failed/);
});

test("coalesces pending draft saves and flushes the latest value", async () => {
  const queue = new ComposerDraftWriteQueue();
  const operations: string[] = [];
  const first = queue.scheduleLatest(
    "session:one",
    async () => {
      operations.push("first");
    },
    10_000,
  );
  const latest = queue.scheduleLatest(
    "session:one",
    async () => {
      operations.push("latest");
    },
    10_000,
  );

  assert.equal(first, latest);
  await queue.waitForIdle("session:one");
  await latest;
  assert.deepEqual(operations, ["latest"]);
});

test("flushes a pending save before a queued clear", async () => {
  const queue = new ComposerDraftWriteQueue();
  const operations: string[] = [];
  const save = queue.scheduleLatest(
    "session:one",
    async () => {
      operations.push("save");
    },
    10_000,
  );
  const clear = queue.enqueue("session:one", async () => {
    operations.push("clear");
  });

  await Promise.all([save, clear]);
  assert.deepEqual(operations, ["save", "clear"]);
});

test("commits during continuous edits after the maximum wait", async () => {
  const queue = new ComposerDraftWriteQueue();
  const operations: string[] = [];
  const save = queue.scheduleLatest(
    "session:one",
    async () => {
      operations.push("latest");
    },
    10_000,
    20,
  );

  await save;
  assert.deepEqual(operations, ["latest"]);
});
