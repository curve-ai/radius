import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

interface SourceManifest {
  name: string;
  version: string;
  license?: string;
  type?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  bin?: Record<string, string>;
}

interface ReleasePackage {
  directory: string;
  description: string;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages: readonly ReleasePackage[] = [
  {
    directory: "packages/agent-contracts",
    description: "Versioned Radius agent configuration and manifest contracts.",
  },
  {
    directory: "packages/agent-build",
    description:
      "Deterministic OCI packaging for TypeScript and Python Radius agents.",
  },
  {
    directory: "packages/platform-contracts",
    description: "Versioned public contracts for compatible Radius Platforms.",
  },
  {
    directory: "packages/platform-client",
    description:
      "Validated HTTP client for Cloud and self-hosted Radius Platforms.",
  },
  {
    directory: "packages/runtime",
    description:
      "ACP client and supervised runtime primitives used by Radius tooling.",
  },
  {
    directory: "packages/sdk",
    description: "TypeScript SDK for authoring ACP-compatible Radius agents.",
  },
  {
    directory: "packages/cli",
    description:
      "Radius developer CLI for init, dev, packaging, deploy, and management.",
  },
];

const explicitOutput = parseOutput(process.argv.slice(2));
const temporaryRoot = await mkdtemp(join(tmpdir(), "radius-npm-release-"));
const outputRoot = explicitOutput ?? join(temporaryRoot, "release");
const stageRoot = join(temporaryRoot, "stage");
const tarballRoot = join(outputRoot, "tarballs");

try {
  if (explicitOutput) await requireEmptyOutput(outputRoot);
  await mkdir(stageRoot, { recursive: true });
  await mkdir(tarballRoot, { recursive: true });

  const releaseEntries: Array<{
    name: string;
    version: string;
    filename: string;
    sha256: string;
    byteSize: number;
  }> = [];

  for (const releasePackage of packages) {
    const sourceRoot = join(repositoryRoot, releasePackage.directory);
    const source = JSON.parse(
      await readFile(join(sourceRoot, "package.json"), "utf8"),
    ) as SourceManifest;
    const stage = join(stageRoot, source.name.replaceAll("/", "__"));
    await mkdir(stage, { recursive: true });
    await copyBuiltOutput(join(sourceRoot, "dist"), join(stage, "dist"));
    await cp(join(repositoryRoot, "LICENSE"), join(stage, "LICENSE"));
    await cp(
      join(repositoryRoot, "THIRD_PARTY_NOTICES.md"),
      join(stage, "THIRD_PARTY_NOTICES.md"),
    );
    await writeFile(
      join(stage, "README.md"),
      `# ${source.name}\n\n${releasePackage.description}\n\nSource and documentation: https://github.com/curve-ai/radius\n`,
    );
    await writeFile(
      join(stage, "package.json"),
      `${JSON.stringify(publicManifest(source, releasePackage.description), null, 2)}\n`,
    );

    const packed = await run("npm", [
      "pack",
      stage,
      "--pack-destination",
      tarballRoot,
      "--silent",
    ]);
    const filename = packed.trim().split(/\r?\n/).at(-1);
    if (!filename)
      throw new Error(`npm pack produced no filename for ${source.name}`);
    const tarball = join(tarballRoot, filename);
    const bytes = await readFile(tarball);
    releaseEntries.push({
      name: source.name,
      version: source.version,
      filename,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength,
    });
  }

  await writeFile(
    join(outputRoot, "release-manifest.json"),
    `${JSON.stringify({ schemaVersion: 1, packages: releaseEntries }, null, 2)}\n`,
  );
  const smoke = await createLocalDependencyMirror(tarballRoot, releaseEntries);
  await verifyExternalInstall(smoke.directory, smoke.entries);

  console.info(
    `Verified ${releaseEntries.length} Radius npm package artifacts`,
  );
  for (const entry of releaseEntries) {
    console.info(
      `${entry.name}@${entry.version}\t${entry.sha256}\t${entry.byteSize}`,
    );
  }
  if (explicitOutput) console.info(`Artifacts: ${outputRoot}`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function publicManifest(source: SourceManifest, description: string) {
  const exports: Record<
    string,
    { types: string; import: string; default: string }
  > = {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      default: "./dist/index.js",
    },
  };
  if (source.name === "@curve-ai/sdk") {
    exports["./development"] = {
      types: "./dist/development.d.ts",
      import: "./dist/development.js",
      default: "./dist/development.js",
    };
  }
  return {
    name: source.name,
    version: source.version,
    description,
    license: source.license ?? "MIT",
    type: source.type ?? "module",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports,
    bin: source.bin,
    files: ["dist", "LICENSE", "README.md", "THIRD_PARTY_NOTICES.md"],
    engines: { node: ">=22" },
    repository: {
      type: "git",
      url: "git+https://github.com/curve-ai/radius.git",
    },
    homepage: "https://github.com/curve-ai/radius#readme",
    bugs: { url: "https://github.com/curve-ai/radius/issues" },
    publishConfig: { access: "public" },
    dependencies: source.dependencies,
    peerDependencies: source.peerDependencies,
    optionalDependencies: source.optionalDependencies,
  };
}

async function copyBuiltOutput(source: string, target: string): Promise<void> {
  await stat(join(source, "index.js"));
  await stat(join(source, "index.d.ts"));
  await cp(source, target, {
    recursive: true,
    filter: (candidate) =>
      !/\.test\.(?:js|d\.ts|js\.map|d\.ts\.map)$/.test(candidate),
  });
}

async function verifyExternalInstall(
  tarballDirectory: string,
  entries: readonly { filename: string }[],
): Promise<void> {
  const consumer = join(temporaryRoot, "consumer");
  await mkdir(consumer, { recursive: true });
  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify({ name: "radius-release-smoke", private: true, type: "module" }, null, 2)}\n`,
  );
  const npmrc = join(consumer, ".npmrc");
  await writeFile(npmrc, "registry=https://registry.npmjs.org/\n");
  await run(
    "pnpm",
    [
      "add",
      "--ignore-scripts",
      ...entries.map((entry) => join(tarballDirectory, entry.filename)),
    ],
    consumer,
    {
      ...process.env,
      npm_config_registry: "https://registry.npmjs.org/",
      npm_config_userconfig: npmrc,
    },
  );
  await run(
    "node",
    [
      "--input-type=module",
      "--eval",
      [
        'import { defineAgent } from "@curve-ai/sdk";',
        'import { serveDevelopmentAgent } from "@curve-ai/sdk/development";',
        'import { AgentManifestSchema } from "@curve-ai/agent-contracts";',
        'import { RadiusPlatformClient } from "@curve-ai/platform-client";',
        'import { credentialAccount } from "@curve-ai/cli";',
        'if (typeof defineAgent !== "function") process.exit(1);',
        'if (typeof serveDevelopmentAgent !== "function") process.exit(1);',
        'if (typeof AgentManifestSchema?.parse !== "function") process.exit(1);',
        'if (typeof RadiusPlatformClient !== "function") process.exit(1);',
        'if (!credentialAccount({name:"smoke",apiUrl:"https://example.com"}).startsWith("profile:smoke:")) process.exit(1);',
      ].join(""),
    ],
    consumer,
  );
  const bin = join(consumer, "node_modules", ".bin", "radius");
  const help = await run(bin, ["--help"], consumer);
  if (!help.includes("radius tokens create")) {
    throw new Error("Packaged Radius CLI help is incomplete");
  }
  const project = join(consumer, "external-agent");
  await mkdir(project);
  await writeFile(
    join(project, "package.json"),
    `${JSON.stringify({ name: "external-agent", private: true, type: "module" }, null, 2)}\n`,
  );
  await run(
    bin,
    ["init", "--skip-install", "--agent-ref", "agent_external1"],
    project,
  );
  await run(bin, ["validate"], project);
}

async function createLocalDependencyMirror(
  tarballDirectory: string,
  entries: readonly { name: string; filename: string }[],
): Promise<{ directory: string; entries: Array<{ filename: string }> }> {
  const mirrorRoot = join(temporaryRoot, "local-dependency-mirror");
  const mirrorTarballs = join(mirrorRoot, "tarballs");
  await mkdir(mirrorTarballs, { recursive: true });
  const releaseNames = new Set(entries.map((entry) => entry.name));
  const mirrored = new Map<string, string>();
  const mirroredEntries: Array<{ filename: string }> = [];

  for (const entry of entries) {
    const extractRoot = join(mirrorRoot, entry.name.replaceAll("/", "__"));
    await mkdir(extractRoot, { recursive: true });
    await run("tar", [
      "-xzf",
      join(tarballDirectory, entry.filename),
      "-C",
      extractRoot,
    ]);
    const packageRoot = join(extractRoot, "package");
    const manifestPath = join(packageRoot, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    for (const [dependency] of Object.entries(manifest.dependencies ?? {})) {
      if (!releaseNames.has(dependency)) continue;
      const localTarball = mirrored.get(dependency);
      if (!localTarball) {
        throw new Error(
          `Release package order must place ${dependency} before ${entry.name}`,
        );
      }
      manifest.dependencies![dependency] = `file:${localTarball}`;
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const packed = await run("npm", [
      "pack",
      packageRoot,
      "--pack-destination",
      mirrorTarballs,
      "--silent",
    ]);
    const filename = packed.trim().split(/\r?\n/).at(-1);
    if (!filename) throw new Error(`Could not mirror ${entry.name}`);
    const tarball = join(mirrorTarballs, filename);
    mirrored.set(entry.name, tarball);
    mirroredEntries.push({ filename });
  }
  return { directory: mirrorTarballs, entries: mirroredEntries };
}

async function requireEmptyOutput(output: string): Promise<void> {
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length > 0) {
    throw new Error(`Release output must be empty: ${output}`);
  }
}

function parseOutput(args: readonly string[]): string | null {
  if (args.length === 0 || (args.length === 1 && args[0] === "--verify")) {
    return null;
  }
  if (args.length === 2 && args[0] === "--output" && args[1]) {
    return resolve(repositoryRoot, args[1]);
  }
  throw new Error(
    "Usage: bun scripts/npm-release.ts [--verify | --output <directory>]",
  );
}

function run(
  command: string,
  args: readonly string[],
  cwd = repositoryRoot,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolveRun(stdout);
      else
        reject(
          new Error(
            `${command} ${args.join(" ")} failed (${code})\n${stderr || stdout}`,
          ),
        );
    });
  });
}
