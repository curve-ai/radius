import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { installDesktopApp } from "./desktop-install.js";
import { PINNED_DESKTOP_RELEASE } from "./desktop-release.js";
import { connectDesktop, type DesktopSessionInput } from "./desktop-session.js";
import type { FoundApp } from "./desktop.js";
import type { Registration } from "./registration.js";
import { writeFakeBundle, writePresence } from "./test-desktop.js";

const macOnly = {
  skip: process.platform !== "darwin" && "reads bundle versions with plutil",
};
const AGENT = "agent_testtesttest";

interface Harness {
  readonly input: DesktopSessionInput;
  readonly userData: string;
  readonly registered: string[];
  readonly removed: string[];
  readonly spawned: string[][];
  readonly installs: string[];
  readonly notes: string[];
}

/**
 * Everything outside the decision is faked: registration records the folder
 * it was given, `open` records its arguments and may play the app starting,
 * and the installer drops a fake bundle where it was asked to.
 */
async function harness(
  options: {
    readonly app?: { readonly version: string } | null;
    readonly yes?: boolean;
    readonly answer?: boolean | null;
    readonly noOpen?: boolean;
    readonly agentId?: string;
    /** What a launched app writes as its presence, if anything. */
    readonly onOpen?: (userData: string) => Promise<void>;
  } = {},
): Promise<Harness> {
  const userData = await mkdtemp(join(tmpdir(), "radius-session-"));
  const scratch = await mkdtemp(join(tmpdir(), "radius-session-app-"));
  const bundle = join(scratch, "Radius.app");
  let app: FoundApp | null = null;
  if (options.app) {
    await writeFakeBundle(bundle, options.app.version);
    app = { path: bundle, installed: true };
  }

  const registered: string[] = [];
  const removed: string[] = [];
  const spawned: string[][] = [];
  const installs: string[] = [];
  const notes: string[] = [];

  const install: typeof installDesktopApp = async (request) => {
    installs.push(request.installPath);
    await writeFakeBundle(bundle, request.release.version);
    app = { path: bundle, installed: true };
    return {
      status: "installed",
      path: bundle,
      version: request.release.version,
      previousVersion: null,
    };
  };

  const input: DesktopSessionInput = {
    platform: "darwin",
    arch: "arm64",
    env: { RADIUS_APP_PATH: bundle },
    projectRoot: scratch,
    userDataPath: userData,
    agentId: options.agentId ?? AGENT,
    noOpen: options.noOpen ?? false,
    yes: options.yes ?? false,
    confirm:
      options.answer === undefined || options.answer === null
        ? null
        : async () => options.answer as boolean,
    register: async (agentsPath): Promise<Registration> => {
      registered.push(agentsPath);
      return {
        path: join(agentsPath, `${AGENT}-test.json`),
        remove: async () => {
          removed.push(agentsPath);
        },
      };
    },
    note: (message) => notes.push(message),
    verbose: () => {},
    release: PINNED_DESKTOP_RELEASE,
    findApp: async () => app,
    spawner: async (command, args) => {
      spawned.push([command, ...args]);
      await options.onOpen?.(userData);
      return true;
    },
    install,
    isTranslated: async () => false,
    presenceTimeoutMs: 300,
  };
  return { input, userData, registered, removed, spawned, installs, notes };
}

function live(userData: string, overrides: Record<string, unknown> = {}) {
  return {
    pid: process.pid,
    version: "0.1.0",
    packaged: true,
    agentNoteVersions: [1],
    agentsPath: join(userData, "development", "agents"),
    ...overrides,
  };
}

test(
  "a running app: register where it watches, then open the agent in it",
  macOnly,
  async () => {
    const h = await harness({ app: { version: "0.1.0" } });
    const watched = join(h.userData, "moved", "agents");
    await writePresence(h.userData, live(h.userData, { agentsPath: watched }));

    const session = await connectDesktop(h.input);
    assert.deepEqual(h.registered, [watched]);
    assert.equal(session.desktop.agentsPath, watched);
    assert.equal(session.desktop.launched, true);
    assert.deepEqual(h.spawned, [
      [
        "open",
        "-a",
        h.input.env.RADIUS_APP_PATH!,
        `radius://dev-agent/${AGENT}`,
      ],
    ]);
    assert.deepEqual(h.installs, []);
  },
);

test("a running app that can't read this descriptor: fail before registering", async () => {
  const h = await harness({ app: { version: "0.1.0" } });
  await writePresence(
    h.userData,
    live(h.userData, { version: "0.0.9", agentNoteVersions: [2] }),
  );
  await assert.rejects(
    connectDesktop(h.input),
    /Radius 0\.0\.9 can't read this agent; run `radius app update`/,
  );
  assert.deepEqual(h.registered, []);
  assert.deepEqual(h.spawned, []);
});

test(
  "a running but older app is not updated under it, only mentioned",
  macOnly,
  async () => {
    const h = await harness({ app: { version: "0.0.9" }, yes: true });
    await writePresence(h.userData, live(h.userData, { version: "0.0.9" }));
    const session = await connectDesktop(h.input);
    assert.deepEqual(h.installs, []);
    assert.equal(session.desktop.launched, true);
    assert.ok(
      h.notes.some((line) =>
        /0\.0\.9 is older than 0\.1\.0.*radius app update/.test(line),
      ),
    );
  },
);

test("a stale presence counts as no app running", macOnly, async () => {
  const h = await harness({ app: { version: "0.1.0" } });
  await writePresence(
    h.userData,
    live(h.userData, { pid: 2 ** 22 + 12345, agentsPath: "/nowhere" }),
  );
  await connectDesktop(h.input);
  assert.deepEqual(h.registered, [join(h.userData, "development", "agents")]);
});

test("no app and nobody to ask: register, install nothing, say how", async () => {
  const h = await harness({ app: null });
  const session = await connectDesktop(h.input);
  assert.deepEqual(h.registered, [join(h.userData, "development", "agents")]);
  assert.deepEqual(h.installs, []);
  assert.deepEqual(h.spawned, []);
  assert.equal(session.desktop.installed, false);
  assert.match(session.desktop.detail, /run `radius app install`/);
});

test("no app and the user declines: nothing is installed", async () => {
  const h = await harness({ app: null, answer: false });
  const session = await connectDesktop(h.input);
  assert.deepEqual(h.installs, []);
  assert.equal(session.desktop.installed, false);
});

test(
  "no app with --yes: install, launch, and follow the app's agentsPath",
  macOnly,
  async () => {
    const h = await harness({
      app: null,
      yes: true,
      onOpen: (userData) =>
        writePresence(
          userData,
          live(userData, { agentsPath: join(userData, "moved", "agents") }),
        ),
    });
    const session = await connectDesktop(h.input);
    const first = join(h.userData, "development", "agents");
    const moved = join(h.userData, "moved", "agents");
    assert.equal(h.installs.length, 1);
    assert.equal(session.desktop.launched, true);
    assert.equal(session.desktop.ready, true, "it reported in");
    assert.equal(session.desktop.version, "0.1.0");
    assert.deepEqual(
      h.registered,
      [first, moved],
      "registered before launch, then moved",
    );
    assert.deepEqual(h.removed, [first], "the first descriptor is removed");
    assert.equal(session.desktop.agentsPath, moved);
    assert.equal(session.registration.path, join(moved, `${AGENT}-test.json`));
    assert.ok(
      h.notes.some((line) => /Always Allow/.test(line)),
      "the keychain prompt is explained",
    );
  },
);

test(
  "no app and the user agrees: installs before launching",
  macOnly,
  async () => {
    const h = await harness({ app: null, answer: true });
    const session = await connectDesktop(h.input);
    assert.equal(h.installs.length, 1);
    assert.equal(session.desktop.launched, true);
    assert.equal(h.spawned.length, 1);
  },
);

test(
  "an older app that is not running, nobody to ask: a hint, then launch it",
  macOnly,
  async () => {
    const h = await harness({ app: { version: "0.0.9" } });
    const session = await connectDesktop(h.input);
    assert.deepEqual(h.installs, []);
    assert.equal(session.desktop.launched, true);
    assert.ok(
      h.notes.some((line) =>
        /0\.0\.9 is older than 0\.1\.0.*radius app update/.test(line),
      ),
    );
  },
);

test(
  "an older app that is not running, user agrees: update, then launch",
  macOnly,
  async () => {
    const h = await harness({ app: { version: "0.0.9" }, answer: true });
    const session = await connectDesktop(h.input);
    assert.equal(h.installs.length, 1);
    assert.equal(session.desktop.version, "0.1.0");
    assert.equal(session.desktop.launched, true);
  },
);

test(
  "an update goes where the app was found, and launches what was installed",
  macOnly,
  async () => {
    const h = await harness({ app: { version: "0.0.9" }, answer: true });
    const found = await h.input.findApp!();
    const scratch = await mkdtemp(join(tmpdir(), "radius-session-moved-"));
    const installedAt = join(scratch, "Radius.app");
    const session = await connectDesktop({
      ...h.input,
      // Not the default install path: the update must follow the found copy.
      env: {},
      install: async (request) => {
        h.installs.push(request.installPath);
        await writeFakeBundle(installedAt, request.release.version);
        return {
          status: "updated",
          path: installedAt,
          version: request.release.version,
          previousVersion: "0.0.9",
        };
      },
    });
    assert.deepEqual(h.installs, [found!.path]);
    assert.equal(session.desktop.launched, true);
    assert.ok(
      h.spawned[0]?.includes(installedAt),
      `opened ${JSON.stringify(h.spawned[0])}`,
    );
  },
);

test("stopped at the install prompt: nothing installed or opened, descriptor removed", async () => {
  const h = await harness({ app: null });
  const stopping = new AbortController();
  await assert.rejects(
    connectDesktop({
      ...h.input,
      signal: stopping.signal,
      confirm: async () => {
        stopping.abort();
        throw new Error("Stopped.");
      },
    }),
  );
  assert.deepEqual(h.installs, []);
  assert.deepEqual(h.spawned, []);
  assert.deepEqual(h.removed, h.registered);
});

test(
  "stopped while waiting for the app: the wait ends at once",
  macOnly,
  async () => {
    const h = await harness({ app: { version: "0.1.0" } });
    const stopping = new AbortController();
    const started = Date.now();
    await assert.rejects(
      connectDesktop({
        ...h.input,
        presenceTimeoutMs: 10_000,
        signal: stopping.signal,
        spawner: async () => {
          setTimeout(() => stopping.abort(), 50);
          return true;
        },
      }),
    );
    assert.ok(Date.now() - started < 5_000, "did not sit out the 10s wait");
    assert.deepEqual(h.removed, h.registered);
  },
);

test(
  "the app never reports in: the descriptor stays in the default folder",
  macOnly,
  async () => {
    const h = await harness({ app: { version: "0.1.0" } });
    const session = await connectDesktop({ ...h.input, slowStartNoticeMs: 50 });
    assert.equal(session.desktop.launched, true);
    // Launched is not ready: an app at its keychain prompt has not opened
    // the agent yet, and the wait says what is probably holding it up.
    assert.equal(session.desktop.ready, false);
    assert.ok(h.notes.some((line) => /login password/.test(line)));
    assert.deepEqual(h.registered, [join(h.userData, "development", "agents")]);
    assert.deepEqual(h.removed, []);
  },
);

test("--no-open installs and launches nothing", async () => {
  const h = await harness({ app: null, yes: true, noOpen: true });
  await connectDesktop(h.input);
  assert.deepEqual(h.installs, []);
  assert.deepEqual(h.spawned, []);
  assert.equal(h.registered.length, 1);
});

test("an agent id the app would ignore fails before anything is written", async () => {
  const h = await harness({ app: null, agentId: "agent_x" });
  await assert.rejects(
    connectDesktop(h.input),
    /not an agent id Radius can open/,
  );
  assert.deepEqual(h.registered, []);
});

test("Windows: a missing app is installed, then radius.exe opens on the agent", async () => {
  const h = await harness({ app: null, yes: true });
  const session = await connectDesktop({
    ...h.input,
    platform: "win32",
    arch: "x64",
  });
  assert.equal(h.installs.length, 1);
  assert.equal(session.desktop.installed, true);
  assert.equal(session.desktop.launched, true);
  assert.equal(h.spawned.length, 1);
  assert.match(h.spawned[0]?.[0] ?? "", /radius\.exe$/);
  assert.deepEqual(h.spawned[0]?.slice(1), [`radius://dev-agent/${AGENT}`]);
  assert.ok(!h.notes.some((note) => /keychain|macOS/.test(note)));
});
