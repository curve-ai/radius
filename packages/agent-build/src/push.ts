import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface RegistryUploadCredentials {
  registry: string;
  username: string;
  password: string;
}

export interface OciCommandResult {
  stdout: string;
  stderr: string;
}

export type OciCommandRunner = (options: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
}) => Promise<OciCommandResult>;

export async function pushAgentOciImage(options: {
  build: { contextPath: string };
  imageReference: string;
  credentials: RegistryUploadCredentials;
  dockerExecutable?: string;
  commandRunner?: OciCommandRunner;
}): Promise<`sha256:${string}`> {
  validateImageReference(options.imageReference);
  const runner = options.commandRunner ?? runOciCommand;
  const docker = options.dockerExecutable ?? "docker";
  const configParent = dirname(options.build.contextPath);
  await mkdir(configParent, { recursive: true });
  const dockerConfig = await mkdtemp(join(configParent, ".docker-config-"));
  await exposeDockerBuildxPlugin(dockerConfig);
  const env = { ...process.env, DOCKER_CONFIG: dockerConfig };

  try {
    await runner({
      command: docker,
      args: [
        "login",
        options.credentials.registry,
        "--username",
        options.credentials.username,
        "--password-stdin",
      ],
      cwd: options.build.contextPath,
      env,
      stdin: `${options.credentials.password}\n`,
    });
    await runner({
      command: docker,
      args: [
        "buildx",
        "build",
        "--platform",
        "linux/arm64",
        "--provenance=false",
        "--sbom=false",
        "--build-arg",
        "SOURCE_DATE_EPOCH=0",
        "--tag",
        options.imageReference,
        "--push",
        "--file",
        join(options.build.contextPath, "Containerfile"),
        options.build.contextPath,
      ],
      cwd: options.build.contextPath,
      env,
    });
    const inspected = await runner({
      command: docker,
      args: ["buildx", "imagetools", "inspect", options.imageReference],
      cwd: options.build.contextPath,
      env,
    });
    const digest = inspected.stdout.match(/^Digest:\s+(sha256:[a-f0-9]{64})$/m)?.[1];
    if (!digest) throw new Error("Registry did not report a digest for the pushed image");
    return digest as `sha256:${string}`;
  } finally {
    await rm(dockerConfig, { recursive: true, force: true });
  }
}

export const pushTypeScriptOciImage = pushAgentOciImage;

async function exposeDockerBuildxPlugin(dockerConfig: string): Promise<void> {
  if (process.platform !== "darwin") return;
  const plugin = "/Applications/Docker.app/Contents/Resources/cli-plugins/docker-buildx";
  try {
    await access(plugin);
  } catch {
    return;
  }
  const pluginDirectory = join(dockerConfig, "cli-plugins");
  await mkdir(pluginDirectory, { recursive: true });
  await symlink(plugin, join(pluginDirectory, "docker-buildx"));
}

export async function runOciCommand(options: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
}): Promise<OciCommandResult> {
  return new Promise<OciCommandResult>((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-65_536);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-65_536);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(
        new Error(
          `${options.command} failed with ${code}: ${stderr.trim().slice(-2_000)}`,
        ),
      );
    });
    child.stdin.end(options.stdin ?? "");
  });
}

function validateImageReference(value: string): void {
  if (!/^[a-z0-9.-]+(?::\d+)?\/[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error("Platform returned an invalid OCI image reference");
  }
}
