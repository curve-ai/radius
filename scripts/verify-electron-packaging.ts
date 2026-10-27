import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32")
  throw new Error("Run the NSIS installer smoke on Windows");
const requireDesktop = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url),
);
const builder = requireDesktop.resolve("electron-builder/cli.js");
const desktop = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../apps/desktop/package.json", import.meta.url)),
    "utf8",
  ),
);
const version = desktop.devDependencies.electron;

function run(
  executable: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
) {
  const result = spawnSync(executable, args, {
    stdio: "inherit",
    timeout: 180_000,
    ...options,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${path.basename(executable)} failed`);
}

for (const useZip of [false, true]) {
  const format = useZip ? "zip" : "7z";
  const root = mkdtempSync(
    path.join(os.tmpdir(), `radius-packaging-${format}-`),
  );
  const name = `RadiusPackagingSmoke${format}`;
  const install = path.join(root, "installed");
  const marker = path.join(root, "result.json");
  const uninstaller = path.join(install, `Uninstall ${name}.exe`);
  try {
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: `radius-packaging-smoke-${format}`,
        version: "0.0.1",
        description: "Disposable installer validation",
        author: "Radius maintainers",
        license: "MIT",
        main: "index.cjs",
      }),
    );
    writeFileSync(path.join(root, "payload.txt"), `radius-${format}-payload`);
    writeFileSync(
      path.join(root, "index.cjs"),
      `
const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
app.setPath('userData',process.env.RADIUS_PACKAGING_PROFILE);
app.whenReady().then(()=>{
 fs.writeFileSync(process.env.RADIUS_PACKAGING_MARKER,JSON.stringify({
  packaged:app.isPackaged,
  asar:app.getAppPath().endsWith('app.asar'),
  payload:fs.readFileSync(path.join(app.getAppPath(),'payload.txt'),'utf8')
 }));
 app.exit(0);
}).catch(()=>app.exit(1));
`,
    );
    const config = path.join(root, "builder.json");
    writeFileSync(
      config,
      JSON.stringify({
        appId: `ai.curve.radius.packaging-smoke.${format}`,
        productName: name,
        electronVersion: version,
        asar: true,
        npmRebuild: false,
        publish: null,
        files: ["index.cjs", "payload.txt", "package.json"],
        win: {
          target: "nsis",
          executableName: "radius-packaging-smoke",
          signAndEditExecutable: false,
        },
        nsis: {
          oneClick: false,
          perMachine: false,
          runAfterFinish: false,
          createDesktopShortcut: false,
          createStartMenuShortcut: false,
          useZip,
          differentialPackage: !useZip,
        },
        directories: { output: "dist" },
      }),
    );
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
    };
    for (const secret of [
      "CSC_LINK",
      "CSC_KEY_PASSWORD",
      "WIN_CSC_LINK",
      "WIN_CSC_KEY_PASSWORD",
    ])
      delete environment[secret];
    run(
      "node",
      [
        builder,
        "--projectDir",
        root,
        "--config",
        config,
        "--win",
        "nsis",
        "--x64",
        "--publish",
        "never",
      ],
      { cwd: root, env: environment },
    );
    const installers = readdirSync(path.join(root, "dist")).filter((file) =>
      file.endsWith(".exe"),
    );
    assert.equal(installers.length, 1);
    run(path.join(root, "dist", installers[0]!), ["/S", `/D=${install}`]);
    assert.ok(existsSync(path.join(install, "resources", "app.asar")));
    const launch: NodeJS.ProcessEnv = {
      ...environment,
      RADIUS_PACKAGING_MARKER: marker,
      RADIUS_PACKAGING_PROFILE: path.join(root, "profile"),
    };
    delete launch.ELECTRON_RUN_AS_NODE;
    run(path.join(install, "radius-packaging-smoke.exe"), [], {
      env: launch,
      timeout: 45_000,
    });
    assert.deepEqual(JSON.parse(readFileSync(marker, "utf8")), {
      packaged: true,
      asar: true,
      payload: `radius-${format}-payload`,
    });
    console.info(
      `NSIS ${format} payload: build, silent install, ASAR payload and installed Electron launch passed`,
    );
  } finally {
    try {
      if (existsSync(uninstaller))
        run(uninstaller, ["/S"], { timeout: 45_000 });
    } finally {
      rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 250,
      });
    }
  }
}
