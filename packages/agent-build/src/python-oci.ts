import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, parse, relative } from "node:path";

import {
  AgentConfigSchema,
  type AgentConfigInput,
  type AgentManifest,
} from "@curve-ai/agent-contracts";

import { BuildError } from "./errors.js";
import { canonicalJson, createAgentManifest } from "./manifest.js";
import {
  releaseTemplateLabels,
  synthesiseReleaseTemplate,
} from "./release-template.js";
import { writeImportableLayout } from "./importable.js";

const PYTHON_IMAGE =
  "python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7";
/**
 * Compressed size of the pinned Python base plus the uv layer, measured once.
 * Same reasoning as the TypeScript pipeline: rootfsMb has to be in the
 * template, which is embedded in the image it describes, so it is estimated
 * from pinned inputs and verified against the built layout afterwards.
 * Python installs dependencies into the image, so the floor is higher.
 */
const BASE_IMAGE_COMPRESSED_BYTES = 120_000_000;

const UV_IMAGE =
  "ghcr.io/astral-sh/uv:0.8.22@sha256:9874eb7afe5ca16c363fe80b294fe700e460df29a55532bbfea234a0f12eddb1";

export interface PythonOciBuildOptions {
  root: string;
  config: AgentConfigInput;
  outputRoot?: string;
  dockerExecutable?: string;
  uvExecutable?: string;
}

export interface PythonOciBuildResult {
  buildDigest: string;
  imageReference: string;
  imageDigest: `sha256:${string}`;
  layoutPath: string;
  contextPath: string;
  manifest: AgentManifest;
  bundleSha256: string;
  /** The release version embedded in the layout, `<version>+<digest16>`. */
  releaseVersion: string;
  /** Where the bundled-agent index entry was written. */
  indexPath: string;
}

/** Deterministic: pinned base plus the agent's own sources. */
/**
 * Dependencies are installed inside the image, so their size is the one input
 * not known before the build.
 *
 * The estimate used to be the base image plus the bytes of `pyproject.toml`
 * and `uv.lock` — two text files. Any agent with real dependencies therefore
 * claimed a few hundred megabytes, built something far larger, and failed the
 * post-build check. The lockfile at least says how many packages there are,
 * which is a much better signal than how long it is, and the allowance is
 * deliberately generous because undershooting fails the build while
 * overshooting only reserves rootfs the guest does not use.
 */
const PER_PACKAGE_BYTES = 16 * 1024 * 1024;
const MINIMUM_DEPENDENCY_BYTES = 512 * 1024 * 1024;

export function countLockedPackages(lockfile: string): number {
  return (lockfile.match(/^name = "/gm) ?? []).length;
}

export function estimatePythonImageMb(
  sourceBytes: number,
  lockedPackages = 0,
): number {
  const dependencies = Math.max(
    MINIMUM_DEPENDENCY_BYTES,
    lockedPackages * PER_PACKAGE_BYTES,
  );
  return Math.ceil(
    ((BASE_IMAGE_COMPRESSED_BYTES + sourceBytes) * 4 + dependencies) /
      (1024 * 1024),
  );
}

export async function buildPythonOciLayout(
  options: PythonOciBuildOptions,
): Promise<PythonOciBuildResult> {
  const config = AgentConfigSchema.parse(options.config);
  if (config.runtime.kind !== "python") {
    throw new Error("Python OCI build requires a Python runtime config");
  }
  if (config.runtime.python !== "3.12") {
    throw new Error("Python OCI builds currently support the pinned Python 3.12 line");
  }

  const lockfilePath = join(options.root, config.runtime.lockfile);
  await requireRegularFile(lockfilePath, "Python lockfile");
  const pyprojectPath = join(options.root, "pyproject.toml");
  await requireRegularFile(pyprojectPath, "pyproject.toml");
  const modulePackage = config.runtime.module.split(".")[0];
  const moduleRoot = await findModuleRoot(options.root, modulePackage);
  const sdkRoot = await findPythonSdk(options.root);

  const outputRoot = options.outputRoot ?? join(options.root, ".radius", "builds");
  await mkdir(outputRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(join(outputRoot, ".python-sandbox-"));
  const contextPath = join(temporaryRoot, "context");
  await mkdir(contextPath, { recursive: true });

  try {
    const sourcePath = join(contextPath, "src", modulePackage);
    const sourceHash = createHash("sha256");
    await copyModuleTree(moduleRoot, sourcePath, modulePackage, sourceHash);

    const uv = options.uvExecutable ?? "uv";
    const requirements = await captureCommand(
      uv,
      [
        "export",
        "--locked",
        "--project",
        options.root,
        "--no-dev",
        "--no-emit-project",
        "--no-emit-package",
        "radius-agent-sdk",
        "--format",
        "requirements.txt",
        "--no-annotate",
        "--no-header",
      ],
      options.root,
    );
    if (!requirements.trim()) {
      throw new Error("Python lockfile exported no runtime dependencies");
    }
    await writeFile(join(contextPath, "requirements.txt"), requirements, "utf8");

    const wheelsPath = join(contextPath, "wheels");
    await mkdir(wheelsPath, { recursive: true });
    await runCommand(
      uv,
      ["build", "--wheel", "--project", sdkRoot, "--out-dir", wheelsPath],
      sdkRoot,
      { ...process.env, SOURCE_DATE_EPOCH: "315532800" },
    );
    const wheels = (await readdir(wheelsPath)).filter((name) => name.endsWith(".whl"));
    if (wheels.length !== 1) {
      throw new Error("Radius Python SDK build must produce exactly one wheel");
    }
    const sdkWheel = await readFile(join(wheelsPath, wheels[0]));
    const pyproject = await readFile(pyprojectPath);
    const lockfile = await readFile(lockfilePath);
    const manifest = createAgentManifest(config);
    const manifestJson = canonicalJson(manifest);
    const bundleSha256 = createHash("sha256")
      .update(sourceHash.digest())
      .update(requirements)
      .update(sdkWheel)
      .digest("hex");
    const buildDigest = createHash("sha256")
      .update(manifestJson)
      .update(pyproject)
      .update(lockfile)
      .update(bundleSha256)
      .digest("hex");
    const imageReference = `radius.local/dev/${safeImageName(config.name)}:${buildDigest.slice(0, 16)}`;

    const sourceBytes = Buffer.byteLength(pyproject) + Buffer.byteLength(lockfile);
    const template = synthesiseReleaseTemplate({
      config,
      buildDigest,
      imageReference,
      platform: "linux/arm64",
      processArguments: ["python", "-m", config.runtime.module],
      imageSizeMb: estimatePythonImageMb(
        sourceBytes,
        countLockedPackages(lockfile.toString()),
      ),
    });
    const labels = releaseTemplateLabels(template);

    await writeFile(
      join(contextPath, "Containerfile"),
      renderPythonContainerfile(config.runtime.module),
      "utf8",
    );
    await writeFile(join(contextPath, "manifest.json"), manifestJson, "utf8");

    const imageTarPath = join(temporaryRoot, "image.oci.tar");
    await runCommand(
      options.dockerExecutable ?? "docker",
      [
        "buildx",
        "build",
        "--platform",
        "linux/arm64",
        "--provenance=false",
        "--sbom=false",
        "--build-arg",
        "SOURCE_DATE_EPOCH=0",
        "--tag",
        imageReference,
        ...Object.entries(labels).flatMap(([key, value]) => [
          "--label",
          `${key}=${value}`,
        ]),
        "--output",
        `type=oci,dest=${imageTarPath}`,
        "--file",
        join(contextPath, "Containerfile"),
        contextPath,
      ],
      options.root,
    );

    const layoutPath = join(temporaryRoot, "oci-layout");
    await mkdir(layoutPath, { recursive: true });
    await runCommand("tar", ["-xf", imageTarPath, "-C", layoutPath], options.root);
    await rm(imageTarPath, { force: true });
    const { imageDigest, imageSizeMb } = await writeImportableLayout({
      layoutPath,
      imageReference,
      platform: "linux/arm64",
      agentId: config.agent!,
      outputRoot: temporaryRoot,
    });

    const claimedMb = estimatePythonImageMb(
      sourceBytes,
      countLockedPackages(lockfile.toString()),
    );
    if (imageSizeMb > claimedMb) {
      throw new BuildError(
        `This agent's dependencies make a larger image than Radius budgeted for: ${Math.ceil(imageSizeMb)}MB against ${claimedMb}MB.\n` +
          "The guest would be given a rootfs too small to boot, so the layout was not written.\n" +
          "Please report this with the dependency list — the per-package allowance in python-oci.ts needs raising.",
      );
    }

    const finalRoot = join(outputRoot, buildDigest);
    await rm(finalRoot, { recursive: true, force: true });
    await rename(temporaryRoot, finalRoot);
    return {
      buildDigest,
      imageReference,
      imageDigest,
      layoutPath: join(finalRoot, "oci-layout"),
      contextPath: join(finalRoot, "context"),
      manifest,
      bundleSha256,
      releaseVersion: String(template.releaseVersion),
      indexPath: join(finalRoot, "index.json"),
    };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

export function renderPythonContainerfile(module: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(module)) {
    throw new Error("Python module is invalid");
  }
  return `FROM ${UV_IMAGE} AS uv
FROM ${PYTHON_IMAGE}

COPY --from=uv /uv /uvx /bin/
RUN groupadd --gid 10000 radius \\
  && useradd --uid 10000 --gid 10000 --home-dir /opt/data --no-create-home radius \\
  && mkdir -p /opt/agent/src /opt/agent/wheels /opt/data \\
  && chown -R 10000:10000 /opt/agent /opt/data

COPY requirements.txt /opt/agent/requirements.txt
COPY wheels /opt/agent/wheels
RUN uv pip install --system --require-hashes -r /opt/agent/requirements.txt \\
  && uv pip install --system --no-deps /opt/agent/wheels/*.whl \\
  && rm -rf /root/.cache

COPY --chown=10000:10000 src /opt/agent/src
COPY --chown=10000:10000 manifest.json /opt/agent/manifest.json
USER 10000:10000
WORKDIR /opt/data
ENV HOME=/opt/data \\
  PYTHONPATH=/opt/agent/src \\
  PYTHONDONTWRITEBYTECODE=1 \\
  PYTHONUNBUFFERED=1
ENTRYPOINT ["python", "-m", ${JSON.stringify(module)}]
`;
}

async function findModuleRoot(root: string, packageName: string): Promise<string> {
  const resolvedRoot = await realpath(root);
  for (const candidate of [join(root, packageName), join(root, "src", packageName)]) {
    try {
      const info = await lstat(candidate);
      if (info.isSymbolicLink() || !info.isDirectory()) continue;
      const resolved = await realpath(candidate);
      const child = relative(resolvedRoot, resolved);
      if (!child.startsWith("..") && !child.startsWith("/")) return resolved;
    } catch {
      // Try the next standard Python package layout.
    }
  }
  throw new Error(
    `Could not find Python package ${packageName} at ${root}/${packageName} or ${root}/src/${packageName}`,
  );
}

async function copyModuleTree(
  source: string,
  destination: string,
  relativePath: string,
  hash: ReturnType<typeof createHash>,
): Promise<void> {
  const resolvedSource = await realpath(source);
  await mkdir(destination, { recursive: true });
  const entries = await readdir(resolvedSource, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.name === "__pycache__" || entry.name === ".DS_Store" || entry.name.endsWith(".pyc")) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`Python package source must not contain symlinks: ${relativePath}/${entry.name}`);
    }
    const from = join(resolvedSource, entry.name);
    const to = join(destination, entry.name);
    const childRelative = `${relativePath}/${entry.name}`;
    if (entry.isDirectory()) {
      await copyModuleTree(from, to, childRelative, hash);
    } else if (entry.isFile()) {
      const bytes = await readFile(from);
      hash.update(childRelative).update("\0").update(bytes).update("\0");
      await copyFile(from, to);
    }
  }
}

async function findPythonSdk(start: string): Promise<string> {
  let current = start;
  const filesystemRoot = parse(current).root;
  for (;;) {
    const candidate = join(current, "sdks", "python", "pyproject.toml");
    try {
      await requireRegularFile(candidate, "Radius Python SDK");
      return dirname(candidate);
    } catch {
      if (current === filesystemRoot) break;
      current = dirname(current);
    }
  }
  throw new Error(
    "Could not locate the Radius Python SDK source. Published SDK wheel packaging is not available yet.",
  );
}

async function requireRegularFile(path: string, label: string): Promise<void> {
  try {
    if ((await stat(path)).isFile()) return;
  } catch {
    // Throw the normalized message below.
  }
  throw new Error(`${label} is missing: ${path}`);
}

function safeImageName(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || basename(process.cwd()).toLowerCase();
}

async function captureCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-1_048_576);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-65_536);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} failed with ${code}: ${stderr.trim()}`));
    });
  });
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-65_536);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed with ${code}: ${stderr.trim()}`));
    });
  });
}
