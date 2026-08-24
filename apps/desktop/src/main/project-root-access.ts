import { realpath, stat } from "node:fs/promises";
import path from "node:path";

function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

export async function canonicalizeProjectRoot(
  rootPath: string,
): Promise<string> {
  const canonicalRoot = await realpath(rootPath);
  const metadata = await stat(canonicalRoot);
  if (!metadata.isDirectory()) {
    throw new Error("Project root must be a directory");
  }
  return canonicalRoot;
}

export async function resolveProjectPath(
  rootPath: string,
  relativePath: string,
  options: { allowMissing?: boolean } = {},
): Promise<string> {
  if (path.isAbsolute(relativePath)) {
    throw new Error("Project paths must be relative to the project root");
  }
  if (relativePath.includes("\0")) {
    throw new Error("Project path contains an invalid null byte");
  }

  const canonicalRoot = await canonicalizeProjectRoot(rootPath);
  const lexicalTarget = path.resolve(canonicalRoot, relativePath || ".");
  if (!isWithinRoot(canonicalRoot, lexicalTarget)) {
    throw new Error("Project path escapes the project root");
  }

  try {
    const canonicalTarget = await realpath(lexicalTarget);
    if (!isWithinRoot(canonicalRoot, canonicalTarget)) {
      throw new Error("Project path resolves outside the project root");
    }
    return canonicalTarget;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : null;
    if (!options.allowMissing || code !== "ENOENT") throw error;
  }

  const missingSegments: string[] = [];
  let existingAncestor = lexicalTarget;
  while (existingAncestor !== canonicalRoot) {
    try {
      const canonicalAncestor = await realpath(existingAncestor);
      if (!isWithinRoot(canonicalRoot, canonicalAncestor)) {
        throw new Error("Project path resolves outside the project root");
      }
      const reconstructedTarget = path.join(
        canonicalAncestor,
        ...missingSegments.reverse(),
      );
      if (!isWithinRoot(canonicalRoot, reconstructedTarget)) {
        throw new Error("Project path escapes the project root");
      }
      return reconstructedTarget;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : null;
      if (code !== "ENOENT") throw error;
    }

    missingSegments.push(path.basename(existingAncestor));
    existingAncestor = path.dirname(existingAncestor);
  }

  return path.join(canonicalRoot, ...missingSegments.reverse());
}
