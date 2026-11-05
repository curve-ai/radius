import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { test } from "node:test";

import {
  folderFromUninstallString,
  windowsInstallPath,
  windowsInstallPathFor,
} from "./desktop-install-windows.js";

const windowsOnly = {
  skip: process.platform !== "win32" && "Windows paths",
};

test("the install folder comes from the uninstall entry", windowsOnly, () => {
  assert.equal(
    folderFromUninstallString(
      '"C:\\Users\\a b\\AppData\\Local\\Programs\\@curve-airadius-desktop\\Uninstall radius.exe" /currentuser',
    ),
    "C:\\Users\\a b\\AppData\\Local\\Programs\\@curve-airadius-desktop",
  );
  assert.equal(folderFromUninstallString("msiexec /x {GUID}"), null);
});

test(
  "a relative RADIUS_APP_PATH becomes absolute for NSIS",
  windowsOnly,
  () => {
    assert.ok(
      isAbsolute(windowsInstallPath({ RADIUS_APP_PATH: "apps\\Radius" })),
    );
  },
);

test("an update goes over the copy that was found", windowsOnly, () => {
  const env = { LOCALAPPDATA: "C:\\Local" };
  assert.equal(
    windowsInstallPathFor({ path: "D:\\Radius", installed: true }, env),
    "D:\\Radius",
  );
  assert.equal(windowsInstallPathFor(null, env), "C:\\Local\\Programs\\Radius");
});
