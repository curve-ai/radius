import type {
  AcpFileSystemHandlers,
  ReadTextFileRequest,
  WriteTextFileRequest,
} from "@curve-ai/radius-runtime";
import { realpath, stat, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_READ_LINES = 10_000;

export interface FileAuthorizationRequest {
  operation: "read" | "write";
  path: string;
  outsideProjectRoots: boolean;
}

export interface FileAccessResult {
  correlationId: string;
  operation: "read" | "write";
  path: string;
  succeeded: boolean;
}

export interface HostFileSystemManagerOptions {
  projectRoots: readonly string[];
  authorize(
    request: FileAuthorizationRequest,
    signal: AbortSignal,
  ): Promise<string>;
  onResult(result: FileAccessResult): Promise<void> | void;
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function assertAbsolutePath(target: string): void {
  if (!path.isAbsolute(target) || target.includes("\0")) {
    throw new Error("ACP file paths must be valid absolute paths");
  }
}

async function canonicalReadPath(target: string): Promise<string> {
  assertAbsolutePath(target);
  const canonical = await realpath(target);
  const metadata = await stat(canonical);
  if (!metadata.isFile()) throw new Error("ACP text reads require a file");
  if (metadata.size > MAX_TEXT_FILE_BYTES) {
    throw new Error("ACP text file is too large");
  }
  return canonical;
}

async function canonicalWritePath(target: string): Promise<string> {
  assertAbsolutePath(target);
  try {
    const canonical = await realpath(target);
    if (!(await stat(canonical)).isFile()) {
      throw new Error("ACP text writes require a file path");
    }
    return canonical;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const parent = await realpath(path.dirname(target));
  if (!(await stat(parent)).isDirectory()) {
    throw new Error("ACP text file parent must be a folder");
  }
  return path.join(parent, path.basename(target));
}

function abortError(): Error {
  const error = new Error("ACP file request was cancelled");
  error.name = "AbortError";
  return error;
}

export class HostFileSystemManager implements AcpFileSystemHandlers {
  readonly #projectRoots: string[];
  #sessionId: string | null = null;

  constructor(private readonly options: HostFileSystemManagerOptions) {
    this.#projectRoots = [...new Set(options.projectRoots)];
  }

  bindSession(sessionId: string): void {
    if (this.#sessionId && this.#sessionId !== sessionId) {
      throw new Error("ACP file manager is already bound to another session");
    }
    this.#sessionId = sessionId;
  }

  async readTextFile(
    request: ReadTextFileRequest,
    signal: AbortSignal,
  ): Promise<{ content: string }> {
    this.#assertSession(request.sessionId);
    if (signal.aborted) throw abortError();
    const target = await canonicalReadPath(request.path);
    const correlationId = await this.options.authorize(
      {
        operation: "read",
        path: target,
        outsideProjectRoots: !this.#projectRoots.some((root) =>
          isWithinRoot(root, target),
        ),
      },
      signal,
    );
    try {
      const content = await readFile(target, "utf8");
      const line = Math.max(1, Number(request.line ?? 1));
      const limit = Math.min(
        MAX_READ_LINES,
        Math.max(0, Number(request.limit ?? MAX_READ_LINES)),
      );
      const selected = content
        .split(/(?<=\n)/)
        .slice(line - 1, line - 1 + limit);
      await this.options.onResult({
        correlationId,
        operation: "read",
        path: target,
        succeeded: true,
      });
      return { content: selected.join("") };
    } catch (error) {
      await this.options.onResult({
        correlationId,
        operation: "read",
        path: target,
        succeeded: false,
      });
      throw error;
    }
  }

  async writeTextFile(
    request: WriteTextFileRequest,
    signal: AbortSignal,
  ): Promise<void> {
    this.#assertSession(request.sessionId);
    if (signal.aborted) throw abortError();
    if (Buffer.byteLength(request.content) > MAX_TEXT_FILE_BYTES) {
      throw new Error("ACP text file content is too large");
    }
    const target = await canonicalWritePath(request.path);
    const correlationId = await this.options.authorize(
      {
        operation: "write",
        path: target,
        outsideProjectRoots: !this.#projectRoots.some((root) =>
          isWithinRoot(root, target),
        ),
      },
      signal,
    );
    try {
      await writeFile(target, request.content, "utf8");
      await this.options.onResult({
        correlationId,
        operation: "write",
        path: target,
        succeeded: true,
      });
    } catch (error) {
      await this.options.onResult({
        correlationId,
        operation: "write",
        path: target,
        succeeded: false,
      });
      throw error;
    }
  }

  #assertSession(sessionId: string): void {
    if (!this.#sessionId) {
      this.#sessionId = sessionId;
      return;
    }
    if (sessionId !== this.#sessionId) {
      throw new Error("ACP file request does not belong to this session");
    }
  }
}
