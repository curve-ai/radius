import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { access, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { BlockList, isIP } from "node:net";
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
  build: { imageReference: string; layoutPath: string };
  imageReference: string;
  credentials: RegistryUploadCredentials;
  dockerExecutable?: string;
  commandRunner?: OciCommandRunner;
}): Promise<`sha256:${string}`> {
  validateImageReference(options.imageReference);
  const runner = options.commandRunner ?? runOciCommand;
  const docker = options.dockerExecutable ?? "docker";
  const configParent = dirname(options.build.layoutPath);
  await mkdir(configParent, { recursive: true });
  const dockerConfig = await mkdtemp(join(configParent, ".docker-config-"));
  const imageArchive = join(dockerConfig, "image.oci.tar");
  await exposeDockerBuildxPlugin(dockerConfig);
  const env = { ...process.env, DOCKER_CONFIG: dockerConfig };

  try {
    await assertDockerUsesHttps(
      [options.credentials.registry, options.imageReference.split("/")[0]!],
      async () =>
        (
          await runner({
            command: docker,
            args: ["info", "--format", "{{json .RegistryConfig}}"],
            cwd: options.build.layoutPath,
            env,
          })
        ).stdout,
    );
    await runner({
      command: "tar",
      args: ["-cf", imageArchive, "-C", options.build.layoutPath, "."],
      cwd: options.build.layoutPath,
    });
    await runner({
      command: docker,
      args: ["image", "load", "--input", imageArchive],
      cwd: options.build.layoutPath,
      env,
    });
    await runner({
      command: docker,
      args: [
        "login",
        options.credentials.registry,
        "--username",
        options.credentials.username,
        "--password-stdin",
      ],
      cwd: options.build.layoutPath,
      env,
      stdin: `${options.credentials.password}\n`,
    });
    await runner({
      command: docker,
      args: [
        "image",
        "tag",
        options.build.imageReference,
        options.imageReference,
      ],
      cwd: options.build.layoutPath,
      env,
    });
    await runner({
      command: docker,
      args: ["image", "push", options.imageReference],
      cwd: options.build.layoutPath,
      env,
    });
    const inspected = await runner({
      command: docker,
      args: ["buildx", "imagetools", "inspect", options.imageReference],
      cwd: options.build.layoutPath,
      env,
    });
    const digest = inspected.stdout.match(
      /^Digest:\s+(sha256:[a-f0-9]{64})$/m,
    )?.[1];
    if (!digest)
      throw new Error("Registry did not report a digest for the pushed image");
    return digest as `sha256:${string}`;
  } finally {
    await Promise.allSettled([
      runner({
        command: docker,
        args: ["image", "rm", "--force", options.imageReference],
        cwd: options.build.layoutPath,
        env,
      }),
      runner({
        command: docker,
        args: ["image", "rm", "--force", options.build.imageReference],
        cwd: options.build.layoutPath,
        env,
      }),
    ]);
    await rm(dockerConfig, { recursive: true, force: true });
  }
}

export const pushTypeScriptOciImage = pushAgentOciImage;

async function exposeDockerBuildxPlugin(dockerConfig: string): Promise<void> {
  if (process.platform !== "darwin") return;
  const plugin =
    "/Applications/Docker.app/Contents/Resources/cli-plugins/docker-buildx";
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
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${options.command} failed with ${code}: ${stderr.trim().slice(-2_000)}`,
          ),
        );
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      // A command may exit before reading stdin; report its exit status after
      // both output streams close instead of crashing on the broken pipe.
      if (error.code !== "EPIPE" && error.code !== "EOF") reject(error);
    });
    child.stdin.end(options.stdin ?? "");
  });
}

interface DockerRegistryConfig {
  InsecureRegistryCIDRs?: string[];
  IndexConfigs?: Record<string, { Secure?: boolean }>;
}

// Docker's own defaults; both are loopback, which may use plain HTTP anyway.
const DEFAULT_INSECURE_CIDRS = new Set(["127.0.0.0/8", "::1/128"]);

/**
 * Refuses an upload Docker would send over plain HTTP, unless the registry is
 * on this machine.
 */
async function assertDockerUsesHttps(
  registries: string[],
  readRegistryConfig: () => Promise<string>,
): Promise<void> {
  const remote = [...new Set(registries)].filter(
    (registry) => !isLoopbackRegistry(registry),
  );
  if (remote.length === 0) return;

  let config: DockerRegistryConfig;
  try {
    config = JSON.parse((await readRegistryConfig()).trim());
    if (!config || typeof config !== "object") throw new Error("not an object");
  } catch (error) {
    throw new Error(
      "Could not read Docker's registry settings (docker info) to confirm the upload uses HTTPS",
      { cause: error },
    );
  }

  const insecureCidrs = (config.InsecureRegistryCIDRs ?? []).filter(
    (cidr) => !DEFAULT_INSECURE_CIDRS.has(cidr),
  );
  const insecureNetworks = new BlockList();
  for (const cidr of insecureCidrs) {
    const [network, prefix] = cidr.split("/");
    if (network && prefix && isIP(network)) {
      insecureNetworks.addSubnet(network, Number(prefix), ipFamily(network));
    }
  }

  for (const registry of remote) {
    const host = registryHost(registry);
    // A hostname is resolved only when someone added insecure networks, so a
    // normal setup makes no DNS call. If it fails, docker login fails too.
    const addresses = isIP(host)
      ? [host]
      : insecureCidrs.length > 0
        ? await lookup(host, { all: true }).then(
            (results) => results.map((result) => result.address),
            () => [],
          )
        : [];
    if (
      // Registry names ignore case, so Docker's entry may be spelled differently.
      Object.entries(config.IndexConfigs ?? {}).some(
        ([name, index]) =>
          name.toLowerCase() === registry.toLowerCase() &&
          index.Secure === false,
      ) ||
      addresses.some((address) =>
        insecureNetworks.check(address, ipFamily(address)),
      )
    ) {
      throw new Error(
        `Docker would upload to ${registry} over plain HTTP. Radius uploads only over HTTPS, except to a registry on this machine. Remove ${registry} from Docker's insecure registries.`,
      );
    }
  }
}

function registryHost(registry: string): string {
  const lower = registry.toLowerCase();
  if (lower.startsWith("[")) return lower.slice(1, lower.indexOf("]"));
  return lower.split(":")[0]!;
}

function isLoopbackRegistry(registry: string): boolean {
  const host = registryHost(registry);
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    (isIP(host) === 4 && host.startsWith("127."))
  );
}

function ipFamily(address: string): "ipv4" | "ipv6" {
  return isIP(address) === 6 ? "ipv6" : "ipv4";
}

function validateImageReference(value: string): void {
  if (!/^[a-z0-9.-]+(?::\d+)?\/[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error("Platform returned an invalid OCI image reference");
  }
}
