import { emitJson, type RadiusContext } from "../../context.js";
import {
  defaultInstallPath,
  findInstalledApp,
  installDesktopApp,
  keychainNotice,
  type InstallOutcome,
} from "../../desktop-install.js";
import { desktopTarget, loadDesktopRelease } from "../../desktop-release.js";
import { launchDesktopApp } from "../../desktop.js";
import { OperationalError } from "../../errors.js";
import { handler } from "../../handler.js";
import { radiusUserDataPath } from "../../registration.js";

interface InstallFlags {
  readonly yes: boolean;
}

/**
 * `install` and `update` do the same thing and differ in what they say when
 * there is nothing to do: an install that finds the app present is a
 * success, an update that finds it current is the answer to the question.
 */
async function installOrUpdate(
  context: RadiusContext,
  verb: "install" | "update",
): Promise<void> {
  const release = await loadDesktopRelease(context.env);
  const target = await desktopTarget(
    { platform: context.process.platform, arch: context.process.arch },
    release,
  );
  if (!target.supported) throw new OperationalError(target.reason);

  const outcome: InstallOutcome = await installDesktopApp({
    release,
    artifact: target.artifact,
    installPath: await defaultInstallPath(context.env),
    userDataPath: radiusUserDataPath(context.process.platform, context.env),
    onProgress: (message) => context.note(message),
  });

  if (context.output === "json") {
    emitJson(context, {
      status: outcome.status,
      version: outcome.version,
      previousVersion: outcome.previousVersion,
      path: outcome.path,
      pinned: release.version,
    });
    return;
  }
  if (outcome.status === "current") {
    context.out(
      verb === "update"
        ? `Radius is already up to date (${outcome.version}, ${outcome.path}).`
        : `Radius ${outcome.version} is already installed at ${outcome.path}.`,
    );
    return;
  }
  context.out(
    outcome.status === "updated"
      ? `✓ Updated Radius ${outcome.previousVersion ?? "(unknown version)"} → ${outcome.version} at ${outcome.path}`
      : `✓ Installed Radius ${outcome.version} at ${outcome.path}`,
  );
  context.out("");
  for (const line of keychainNotice()) context.out(line);
}

export const install = handler<InstallFlags, []>(async function (this) {
  await installOrUpdate(this, "install");
});

export const update = handler<InstallFlags, []>(async function (this) {
  await installOrUpdate(this, "update");
});

export const path = handler<object, []>(async function (this) {
  const app = await findInstalledApp(this.env);
  if (!app) {
    throw new OperationalError(
      "Radius isn't installed.",
      "Run `radius app install`.",
    );
  }
  if (this.output === "json") {
    emitJson(this, { path: app.path, version: app.version });
    return;
  }
  this.out(app.path);
});

export const open = handler<object, []>(async function (this) {
  const result = await launchDesktopApp({
    platform: this.process.platform,
    env: this.env,
    projectRoot: this.cwd,
  });
  if (!result.launched) throw new OperationalError(result.detail);
  if (this.output === "json") {
    emitJson(this, { launched: true, path: result.path });
    return;
  }
  this.out(`Opened ${result.path}`);
});
