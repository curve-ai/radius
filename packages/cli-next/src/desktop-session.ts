import { resolve } from "node:path";

import {
  defaultInstallPath,
  installDesktopApp,
  keychainNotice,
  readBundleVersion,
} from "./desktop-install.js";
import {
  readDesktopPresence,
  waitForDesktopPresence,
  type DesktopPresence,
} from "./desktop-presence.js";
import {
  compareVersions,
  desktopTarget,
  formatMegabytes,
  PINNED_DESKTOP_RELEASE,
  type DesktopRelease,
} from "./desktop-release.js";
import {
  devAgentLink,
  findDesktopApp,
  launchDesktopApp,
  type FoundApp,
  type Spawner,
} from "./desktop.js";
import { OperationalError, renderError } from "./errors.js";
import {
  defaultAgentsPath,
  WRITTEN_AGENT_SCHEMA_VERSION,
  type Registration,
} from "./registration.js";

/**
 * How `dev` gets its agent in front of the desktop app.
 *
 * Registration always comes first: the descriptor is what the app reads, so
 * an app opened before it would briefly show nothing. Then, in order, the app
 * is found or installed, launched on the agent, and waited for, so the
 * descriptor can follow it if it watches a folder other than the default.
 *
 * Its own module, with the outside world injected, so the decision can be
 * tested without a GUI app, a download or a real `open`.
 */

export interface DesktopSessionInput {
  readonly platform: string;
  readonly arch: string;
  readonly env: NodeJS.ProcessEnv;
  readonly projectRoot: string;
  readonly userDataPath: string;
  readonly agentId: string;
  /** --no-open: register, but never install or launch. */
  readonly noOpen: boolean;
  /** --yes: accept an install or update without asking. */
  readonly yes: boolean;
  /** Asks a yes/no question; null when there is nobody to ask. */
  readonly confirm: ((question: string) => Promise<boolean>) | null;
  /** Writes the descriptor into the given folder. */
  readonly register: (agentsPath: string) => Promise<Registration>;
  /** Progress and warnings, on stderr. */
  readonly note: (message: string) => void;
  /** Paths and timings, shown only with --verbose. */
  readonly verbose: (message: string) => void;

  readonly release?: DesktopRelease;
  /** Where the app is; injected so a test is not at the mercy of this machine. */
  readonly findApp?: () => Promise<FoundApp | null>;
  readonly spawner?: Spawner;
  readonly install?: typeof installDesktopApp;
  readonly isTranslated?: () => Promise<boolean>;
  readonly isAlive?: (pid: number) => boolean;
  readonly presenceTimeoutMs?: number;
}

export interface DesktopStatus {
  /** Whether an app bundle is on this machine once the flow is done. */
  readonly installed: boolean;
  readonly version: string | null;
  readonly launched: boolean;
  readonly agentsPath: string;
  /** Why it was not launched, or the bundle that was. */
  readonly detail: string;
}

export interface DesktopSession {
  readonly registration: Registration;
  readonly desktop: DesktopStatus;
}

export async function connectDesktop(
  input: DesktopSessionInput,
): Promise<DesktopSession> {
  // Checked before anything is written: a bad id would register an agent
  // the link can never open.
  if (!input.noOpen) devAgentLink(input.agentId);

  // A throw after registering must not leave a descriptor behind for an
  // agent nobody is serving, so the latest one is tracked and removed.
  let latest: Registration | null = null;
  try {
    return await decide({
      ...input,
      register: async (agentsPath) =>
        (latest = await input.register(agentsPath)),
    });
  } catch (error) {
    await (latest as Registration | null)?.remove();
    throw error;
  }
}

async function decide(input: DesktopSessionInput): Promise<DesktopSession> {
  const release = input.release ?? PINNED_DESKTOP_RELEASE;
  const presence = await readDesktopPresence(input.userDataPath, input.isAlive);

  if (presence) {
    // Checked before writing: a descriptor the app cannot parse is ignored
    // without a word, which looks exactly like `dev` being broken.
    requireReadable(presence);
    const registration = await input.register(presence.agentsPath);
    input.verbose(
      `[desktop] Radius ${presence.version} is running (pid ${presence.pid})`,
    );

    const app = input.noOpen ? null : await locate(input);
    const installedVersion = app?.installed
      ? await readBundleVersion(app.path)
      : null;
    // Running, so this is no moment to replace it; say so once and carry on.
    if (
      installedVersion !== null &&
      compareVersions(installedVersion, release.version) < 0
    ) {
      input.note(
        `Radius ${installedVersion} is older than ${release.version}. Quit it and run \`radius app update\` to update.`,
      );
    }
    if (input.noOpen) {
      return {
        registration,
        desktop: {
          installed: true,
          version: presence.version,
          launched: false,
          agentsPath: presence.agentsPath,
          detail: "--no-open",
        },
      };
    }
    // Opened even though it is up: the link is what brings the agent forward.
    const launch = app
      ? await launchDesktopApp({
          platform: input.platform,
          env: input.env,
          projectRoot: input.projectRoot,
          agentId: input.agentId,
          bundle: app.path,
          spawner: input.spawner,
        })
      : {
          launched: false,
          // Up but with no bundle to address: running from source.
          detail: "Radius is running; pick this agent in it.",
        };
    return {
      registration,
      desktop: {
        installed: true,
        version: presence.version,
        launched: launch.launched,
        agentsPath: presence.agentsPath,
        detail: launch.detail,
      },
    };
  }

  const firstPath = defaultAgentsPath(input.userDataPath);
  let registration = await input.register(firstPath);
  if (input.noOpen) {
    return {
      registration,
      desktop: {
        installed: false,
        version: null,
        launched: false,
        agentsPath: firstPath,
        detail: "--no-open",
      },
    };
  }

  let app = await locate(input);
  let version = app ? await readBundleVersion(app.path) : null;
  let notInstalledDetail: string | null = null;

  const target = await desktopTarget(
    { platform: input.platform, arch: input.arch },
    release,
    input.isTranslated,
  );
  if (app === null) {
    if (!target.supported) {
      notInstalledDetail = target.reason;
    } else {
      const size = formatMegabytes(target.artifact.size);
      const accepted = input.yes
        ? true
        : input.confirm
          ? await input.confirm(
              `Radius app not found. Download Radius ${release.version} (${size})?`,
            )
          : false;
      if (accepted) {
        const installed = await tryInstall(input, release, target.artifact);
        if (installed) {
          app = { path: installed.path, installed: true };
          version = installed.version;
        }
      }
      if (app === null) {
        notInstalledDetail =
          "Radius isn't installed; run `radius app install`, then open it and pick this agent.";
      }
    }
  } else if (
    app.installed &&
    target.supported &&
    version !== null &&
    compareVersions(version, release.version) < 0
  ) {
    // Not running (that case returned above), so replacing it is safe.
    const size = formatMegabytes(target.artifact.size);
    const accepted = input.yes
      ? true
      : input.confirm
        ? await input.confirm(
            `Radius ${version} is installed. Update to ${release.version} (${size})?`,
          )
        : false;
    if (accepted) {
      const updated = await tryInstall(input, release, target.artifact);
      if (updated) version = updated.version;
    } else {
      input.note(
        `Radius ${version} is older than ${release.version}; \`radius app update\` updates it.`,
      );
    }
  }

  if (app === null) {
    return {
      registration,
      desktop: {
        installed: false,
        version: null,
        launched: false,
        agentsPath: firstPath,
        detail: notInstalledDetail ?? "Radius isn't installed.",
      },
    };
  }

  const launch = await launchDesktopApp({
    platform: input.platform,
    env: input.env,
    projectRoot: input.projectRoot,
    agentId: input.agentId,
    bundle: app.path,
    spawner: input.spawner,
  });
  let agentsPath = firstPath;
  if (launch.launched) {
    const started = Date.now();
    const arrived = await waitForDesktopPresence(
      input.userDataPath,
      input.presenceTimeoutMs ?? 30_000,
      { isAlive: input.isAlive },
    );
    if (arrived) {
      input.verbose(
        `[desktop] Radius reported in after ${Date.now() - started}ms`,
      );
      if (!arrived.agentNoteVersions.includes(WRITTEN_AGENT_SCHEMA_VERSION)) {
        input.note(unreadableMessage(arrived));
      }
      // The app says where it watches; the default was only a guess made
      // before it was up. Moved by writing the new one first, so there is
      // never a moment with neither.
      if (resolve(arrived.agentsPath) !== resolve(firstPath)) {
        const moved = await input.register(arrived.agentsPath);
        await registration.remove();
        registration = moved;
        agentsPath = arrived.agentsPath;
        input.verbose(
          `[desktop] moved the descriptor to ${arrived.agentsPath}`,
        );
      }
      version = arrived.version;
    } else {
      input.verbose(
        `[desktop] Radius did not report in within ${Math.round((input.presenceTimeoutMs ?? 30_000) / 1000)}s; the descriptor stays in ${firstPath}`,
      );
    }
  }

  return {
    registration,
    desktop: {
      installed: true,
      version,
      launched: launch.launched,
      agentsPath,
      detail: launch.detail,
    },
  };
}

function locate(input: DesktopSessionInput): Promise<FoundApp | null> {
  return input.findApp
    ? input.findApp()
    : findDesktopApp({ env: input.env, projectRoot: input.projectRoot });
}

function requireReadable(presence: DesktopPresence): void {
  if (!presence.agentNoteVersions.includes(WRITTEN_AGENT_SCHEMA_VERSION)) {
    throw new OperationalError(
      unreadableMessage(presence),
      "Quit Radius, run `radius app update`, then start `radius dev` again.",
    );
  }
}

function unreadableMessage(presence: DesktopPresence): string {
  return `Radius ${presence.version} can't read this agent; run \`radius app update\`.`;
}

/**
 * An install failing inside `dev` is reported, not thrown: the agent is
 * already registered, and the session is still worth having without the app.
 */
async function tryInstall(
  input: DesktopSessionInput,
  release: DesktopRelease,
  artifact: Parameters<typeof installDesktopApp>[0]["artifact"],
): Promise<{ path: string; version: string } | null> {
  try {
    const outcome = await (input.install ?? installDesktopApp)({
      release,
      artifact,
      installPath: await defaultInstallPath(input.env),
      userDataPath: input.userDataPath,
      onProgress: input.note,
      isAlive: input.isAlive,
    });
    if (outcome.status !== "current") {
      input.note(`Installed Radius ${outcome.version} at ${outcome.path}.`);
      for (const line of keychainNotice()) input.note(line);
    }
    return { path: outcome.path, version: outcome.version };
  } catch (error) {
    input.note(renderError(error));
    return null;
  }
}
