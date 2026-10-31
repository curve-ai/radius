import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { installDesktopApp, readBundleVersion } from "./desktop-install.js";
import type { DesktopArtifact, DesktopRelease } from "./desktop-release.js";
import { writeFakeBundle } from "./test-desktop.js";

const macOnly = {
  skip: process.platform !== "darwin" && "needs ditto and plutil",
};

/** Zipped the way the release is: Radius.app at the archive root. */
async function fakeReleaseZip(version: string): Promise<Buffer> {
  const scratch = await mkdtemp(join(tmpdir(), "radius-fake-release-"));
  const bundle = join(scratch, "Radius.app");
  await writeFakeBundle(bundle, version);
  const archive = join(scratch, "radius.zip");
  await promisify(execFile)("ditto", [
    "-c",
    "-k",
    "--keepParent",
    bundle,
    archive,
  ]);
  return readFile(archive);
}

interface Served {
  readonly url: string;
  readonly server: Server;
}

/** Serves `body` at /radius.zip; `cut` sends only that many bytes, then drops. */
async function serve(body: Buffer, cut?: number): Promise<Served> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "application/zip",
      "content-length": String(body.byteLength),
    });
    if (cut === undefined) {
      response.end(body);
      return;
    }
    response.write(body.subarray(0, cut), () => response.socket?.destroy());
  });
  await new Promise<void>((settle) => server.listen(0, "127.0.0.1", settle));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/radius.zip`, server };
}

function releaseFor(
  version: string,
  artifact: DesktopArtifact,
): DesktopRelease {
  return {
    version,
    agentNoteVersions: [1],
    platforms: { "darwin/arm64": artifact },
  };
}

async function setup(
  options: {
    readonly version?: string;
    readonly cut?: number;
    readonly size?: (actual: number) => number;
    readonly sha256?: string;
  } = {},
) {
  const version = options.version ?? "0.2.0";
  const body = await fakeReleaseZip(version);
  const served = await serve(body, options.cut);
  const artifact: DesktopArtifact = {
    url: served.url,
    sha256: options.sha256 ?? createHash("sha256").update(body).digest("hex"),
    size: options.size ? options.size(body.byteLength) : body.byteLength,
  };
  const root = await mkdtemp(join(tmpdir(), "radius-install-"));
  const userData = await mkdtemp(join(tmpdir(), "radius-install-userdata-"));
  return {
    release: releaseFor(version, artifact),
    artifact,
    installPath: join(root, "Applications", "Radius.app"),
    userData,
    close: () => served.server.close(),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Nothing but what was there before: no partial download, no staging dir. */
async function leftovers(installPath: string): Promise<string[]> {
  return readdir(dirname(installPath)).catch(() => []);
}

test(
  "installs a verified download and reads its version back",
  macOnly,
  async () => {
    const fixture = await setup();
    try {
      const progress: string[] = [];
      const outcome = await installDesktopApp({
        release: fixture.release,
        artifact: fixture.artifact,
        installPath: fixture.installPath,
        userDataPath: fixture.userData,
        onProgress: (message) => progress.push(message),
      });
      assert.equal(outcome.status, "installed");
      assert.equal(outcome.version, "0.2.0");
      assert.equal(await readBundleVersion(fixture.installPath), "0.2.0");
      assert.ok(
        await exists(join(fixture.installPath, "Contents", "MacOS", "Radius")),
      );
      assert.deepEqual(await leftovers(fixture.installPath), ["Radius.app"]);
      assert.match(progress[0] ?? "", /^Downloading Radius 0\.2\.0/);
    } finally {
      fixture.close();
    }
  },
);

test("updates an older copy in place", macOnly, async () => {
  const fixture = await setup();
  try {
    await writeFakeBundle(fixture.installPath, "0.1.0");
    const outcome = await installDesktopApp({
      release: fixture.release,
      artifact: fixture.artifact,
      installPath: fixture.installPath,
      userDataPath: fixture.userData,
    });
    assert.equal(outcome.status, "updated");
    assert.equal(outcome.previousVersion, "0.1.0");
    assert.equal(await readBundleVersion(fixture.installPath), "0.2.0");
    assert.deepEqual(await leftovers(fixture.installPath), ["Radius.app"]);
  } finally {
    fixture.close();
  }
});

for (const [name, options] of [
  ["size", { size: (actual: number) => actual + 1 }],
  ["sha256", { sha256: "0".repeat(64) }],
] as const) {
  test(
    `a ${name} mismatch deletes the download and installs nothing`,
    macOnly,
    async () => {
      const fixture = await setup(options);
      try {
        await assert.rejects(
          installDesktopApp({
            release: fixture.release,
            artifact: fixture.artifact,
            installPath: fixture.installPath,
            userDataPath: fixture.userData,
          }),
          new RegExp(
            `does not match its pinned ${name === "size" ? "size" : "checksum"}`,
          ),
        );
        assert.equal(await exists(fixture.installPath), false);
        assert.deepEqual(await leftovers(fixture.installPath), []);
      } finally {
        fixture.close();
      }
    },
  );
}

test(
  "a download larger than its pinned size is stopped and deleted",
  macOnly,
  async () => {
    const fixture = await setup({ size: (actual) => actual - 1 });
    try {
      await assert.rejects(
        installDesktopApp({
          release: fixture.release,
          artifact: fixture.artifact,
          installPath: fixture.installPath,
          userDataPath: fixture.userData,
        }),
        /does not match its pinned size/,
      );
      assert.deepEqual(await leftovers(fixture.installPath), []);
    } finally {
      fixture.close();
    }
  },
);

test(
  "an interrupted download installs nothing and leaves nothing",
  macOnly,
  async () => {
    const fixture = await setup({ cut: 64 });
    try {
      await assert.rejects(
        installDesktopApp({
          release: fixture.release,
          artifact: fixture.artifact,
          installPath: fixture.installPath,
          userDataPath: fixture.userData,
        }),
        /interrupted|does not match its pinned size/,
      );
      assert.equal(await exists(fixture.installPath), false);
      assert.deepEqual(await leftovers(fixture.installPath), []);
    } finally {
      fixture.close();
    }
  },
);

test("never downgrades, and does not even download", macOnly, async () => {
  const fixture = await setup({ version: "0.2.0" });
  try {
    await writeFakeBundle(fixture.installPath, "0.3.0");
    const outcome = await installDesktopApp({
      release: fixture.release,
      // A URL nothing listens on: reaching for it would fail the test.
      artifact: { ...fixture.artifact, url: "http://127.0.0.1:1/never" },
      installPath: fixture.installPath,
      userDataPath: fixture.userData,
    });
    assert.equal(outcome.status, "current");
    assert.equal(outcome.version, "0.3.0");
    assert.equal(await readBundleVersion(fixture.installPath), "0.3.0");
  } finally {
    fixture.close();
  }
});

test("refuses to replace a running app", macOnly, async () => {
  const fixture = await setup();
  try {
    await writeFakeBundle(fixture.installPath, "0.1.0");
    await mkdir(join(fixture.userData, "development"), { recursive: true });
    await writeFile(
      join(fixture.userData, "development", "desktop.json"),
      JSON.stringify({
        pid: process.pid,
        version: "0.1.0",
        packaged: true,
        agentNoteVersions: [1],
        agentsPath: join(fixture.userData, "development", "agents"),
      }),
    );
    await assert.rejects(
      installDesktopApp({
        release: fixture.release,
        artifact: fixture.artifact,
        installPath: fixture.installPath,
        userDataPath: fixture.userData,
      }),
      /is running .* can't be replaced/,
    );
    assert.equal(await readBundleVersion(fixture.installPath), "0.1.0");
  } finally {
    fixture.close();
  }
});
