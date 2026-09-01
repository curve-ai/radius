import {
  parseAgentReleaseDescriptor,
  parseBundledAgentIndex,
  type BundledAgentIndex,
} from "@curve-ai/radius-runtime";
import { app } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { readEmbeddedAgentRelease } from "./bundled-agent-layout";

interface ImageLoadReport {
  type: "radius.runtime.images-loaded";
  protocolVersion: 1;
  images: Array<{ reference: string; digest: string }>;
}

let installationPromise: Promise<string[]> | null = null;

function runtimeHostPath(): string {
  return app.isPackaged
    ? path.join(
        process.resourcesPath,
        "runtime/macos-arm64/radius-runtime-host",
      )
    : path.resolve(
        app.getAppPath(),
        "../runtime-host-macos/.build/release/radius-runtime-host",
      );
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function bundledResourcePath(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("BUNDLED_AGENT_RESOURCE_ESCAPE");
  }
  return target;
}

async function loadImage(
  layoutPath: string,
  runtimeRoot: string,
): Promise<ImageLoadReport> {
  return new Promise<ImageLoadReport>((resolve, reject) => {
    const child = spawn(
      runtimeHostPath(),
      ["load-image", "--layout", layoutPath, "--root", runtimeRoot],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-64 * 1024);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-64 * 1024);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `BUNDLED_AGENT_IMAGE_IMPORT_FAILED:${stderr.trim().slice(-500)}`,
          ),
        );
        return;
      }
      try {
        const report = JSON.parse(stdout) as ImageLoadReport;
        if (
          report.type !== "radius.runtime.images-loaded" ||
          report.protocolVersion !== 1 ||
          !Array.isArray(report.images)
        ) {
          throw new Error("BUNDLED_AGENT_IMAGE_IMPORT_INVALID");
        }
        resolve(report);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function installBundledAgent(
  resourceRoot: string,
  definition: BundledAgentIndex["agents"][number],
): Promise<{ agentId: string; releasePath: string }> {
  const layoutPath = bundledResourcePath(resourceRoot, definition.imageLayout);
  const embedded = await readEmbeddedAgentRelease(layoutPath);
  const unresolvedRelease = parseAgentReleaseDescriptor(embedded.template);
  const runtimeRoot =
    !app.isPackaged && unresolvedRelease.agentId === "fx"
      ? path.join(app.getPath("appData"), "Radius/dev/runtime/fx-image-store")
      : path.join(
          app.getPath("userData"),
          "runtime",
          unresolvedRelease.agentId,
        );
  const report = await loadImage(layoutPath, runtimeRoot);
  const loaded = report.images.find(
    (image) => image.reference === unresolvedRelease.image.reference,
  );
  if (!loaded || !/^sha256:[a-f0-9]{64}$/.test(loaded.digest)) {
    throw new Error("BUNDLED_AGENT_IMAGE_IMPORT_MISSING");
  }
  const image = embedded.template.image;
  if (!image || typeof image !== "object" || Array.isArray(image)) {
    throw new Error("BUNDLED_AGENT_RELEASE_TEMPLATE_INVALID");
  }
  (image as Record<string, unknown>).digest = loaded.digest;
  const release = parseAgentReleaseDescriptor(embedded.template);

  const installationRoot = path.join(
    app.getPath("userData"),
    "agents",
    definition.project,
  );
  const installedReleasePath = path.join(installationRoot, "release.json");
  const serialized = `${JSON.stringify(release, null, 2)}\n`;
  const manifestSha256 = createHash("sha256")
    .update(JSON.stringify(release))
    .digest("hex");
  const historicalReleasePath = path.join(
    installationRoot,
    "releases",
    "sha256",
    `${manifestSha256}.json`,
  );
  await mkdir(path.dirname(historicalReleasePath), {
    recursive: true,
    mode: 0o700,
  });
  const historical = await readOptional(historicalReleasePath);
  if (historical === null) {
    await writeFile(historicalReleasePath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } else if (historical !== serialized) {
    throw new Error("BUNDLED_AGENT_RELEASE_HISTORY_CONFLICT");
  }
  if ((await readOptional(installedReleasePath)) !== serialized) {
    await mkdir(installationRoot, { recursive: true, mode: 0o700 });
    const temporaryPath = `${installedReleasePath}.tmp-${process.pid}`;
    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, installedReleasePath);
  }
  return { agentId: release.agentId, releasePath: installedReleasePath };
}

function installedReleasePath(project: string): string {
  return path.join(app.getPath("userData"), "agents", project, "release.json");
}

async function lastValidReleasePath(project: string): Promise<string | null> {
  const releasePath = installedReleasePath(project);
  const raw = await readOptional(releasePath);
  if (raw === null) return null;
  parseAgentReleaseDescriptor(JSON.parse(raw));
  return releasePath;
}

async function installBundledAgents(resourceRoot: string): Promise<string[]> {
  const indexJson = await readOptional(path.join(resourceRoot, "index.json"));
  if (indexJson === null) return [];
  const index = parseBundledAgentIndex(JSON.parse(indexJson));
  const installed: Array<{ agentId: string; releasePath: string }> = [];
  for (const definition of index.agents) {
    try {
      installed.push(await installBundledAgent(resourceRoot, definition));
    } catch (error) {
      const fallback = await lastValidReleasePath(definition.project);
      if (!fallback) throw error;
      console.error(
        `[agents] Bundled update for ${definition.project} was rejected; keeping the last valid release`,
        error instanceof Error ? error.message : "BUNDLED_AGENT_UPDATE_INVALID",
      );
      const release = parseAgentReleaseDescriptor(
        JSON.parse(await readFile(fallback, "utf8")),
      );
      installed.push({ agentId: release.agentId, releasePath: fallback });
    }
  }
  if (
    new Set(installed.map((entry) => entry.agentId)).size !== installed.length
  ) {
    throw new Error("BUNDLED_AGENT_IDS_MUST_BE_UNIQUE");
  }
  return installed.map((entry) => entry.releasePath);
}

export async function resolveAgentReleasePaths(): Promise<string[]> {
  const configured = process.env.RADIUS_AGENT_RELEASE_PATH?.trim();
  if (configured) return [path.resolve(configured)];

  const resourceRoot = app.isPackaged
    ? path.join(process.resourcesPath, "agents")
    : path.resolve(
        app.getAppPath(),
        "../runtime-host-macos/.build/provider-assets",
      );
  installationPromise ??= installBundledAgents(resourceRoot).catch((error) => {
    installationPromise = null;
    throw error;
  });
  const bundled = await installationPromise;
  if (bundled.length > 0) return bundled;

  const developmentRelease = path.join(
    app.getPath("appData"),
    "Radius/dev/fx/release.json",
  );
  if (!app.isPackaged && (await readOptional(developmentRelease))) {
    return [developmentRelease];
  }
  return [];
}

export async function initializeBundledAgents(): Promise<void> {
  await resolveAgentReleasePaths();
}
