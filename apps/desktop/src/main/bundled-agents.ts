import {
  parseAgentReleaseDescriptor,
  parseBundledAgentIndex,
  type AgentReleaseDescriptor,
  type BundledAgentIndex,
} from "@curve-ai/radius-runtime";
import { app } from "electron";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

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
  const templatePath = bundledResourcePath(
    resourceRoot,
    definition.releaseTemplate,
  );
  const template = JSON.parse(await readFile(templatePath, "utf8")) as Record<
    string,
    unknown
  >;
  const unresolvedRelease = parseAgentReleaseDescriptor(template);
  const layoutPath = bundledResourcePath(resourceRoot, definition.imageLayout);
  const runtimeRoot = path.join(
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
  const image = template.image;
  if (!image || typeof image !== "object") {
    throw new Error("BUNDLED_AGENT_RELEASE_TEMPLATE_INVALID");
  }
  (image as Record<string, unknown>).digest = loaded.digest;
  const release: AgentReleaseDescriptor = parseAgentReleaseDescriptor(template);

  const installationRoot = path.join(
    app.getPath("userData"),
    "agents",
    definition.project,
  );
  const installedReleasePath = path.join(installationRoot, "release.json");
  const serialized = `${JSON.stringify(release, null, 2)}\n`;
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

async function installPackagedBundledAgents(): Promise<string[]> {
  if (!app.isPackaged) return [];
  const resourceRoot = path.join(process.resourcesPath, "agents");
  const index = parseBundledAgentIndex(
    JSON.parse(await readFile(path.join(resourceRoot, "index.json"), "utf8")),
  );
  const installed: Array<{ agentId: string; releasePath: string }> = [];
  for (const definition of index.agents) {
    installed.push(await installBundledAgent(resourceRoot, definition));
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

  const developmentRelease = path.join(
    app.getPath("appData"),
    "Radius/dev/fx/release.json",
  );
  if (!app.isPackaged && (await readOptional(developmentRelease))) {
    return [developmentRelease];
  }

  installationPromise ??= installPackagedBundledAgents().catch((error) => {
    installationPromise = null;
    throw error;
  });
  return installationPromise;
}

export async function initializeBundledAgents(): Promise<void> {
  await resolveAgentReleasePaths();
}
