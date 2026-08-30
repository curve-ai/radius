import { basePolicy, platformReadDefaults } from "./seatbelt/policies";

export interface SeatbeltCommandInput {
  command: string;
  args: readonly string[];
  cwd: string;
  readableRoots: readonly string[];
  writableRoots: readonly string[];
}

export interface SeatbeltCommand {
  program: "/usr/bin/sandbox-exec";
  args: string[];
}

function uniqueRoots(roots: readonly string[]): string[] {
  return [...new Set(roots)].sort((left, right) => left.localeCompare(right));
}

function rootPolicy(
  operation: "file-read* file-test-existence" | "file-write*",
  prefix: "READABLE_ROOT" | "WRITABLE_ROOT",
  count: number,
): string {
  if (count === 0) return "";
  const selectors = Array.from(
    { length: count },
    (_, index) => `  (subpath (param "${prefix}_${index}"))`,
  ).join("\n");
  return `(allow ${operation}\n${selectors})`;
}

export function createSeatbeltCommand(
  input: SeatbeltCommandInput,
): SeatbeltCommand {
  const writableRoots = uniqueRoots(input.writableRoots);
  const readableRoots = uniqueRoots([...input.readableRoots, ...writableRoots]);
  const policy = [
    basePolicy.trim(),
    platformReadDefaults.trim(),
    "; Standard developer tool installations are readable but never writable.",
    '(allow file-read* file-test-existence (subpath "/opt/homebrew") (subpath "/usr/local"))',
    rootPolicy(
      "file-read* file-test-existence",
      "READABLE_ROOT",
      readableRoots.length,
    ),
    rootPolicy("file-write*", "WRITABLE_ROOT", writableRoots.length),
    "; Commands have no direct network access in the workspace sandbox.",
    "(deny network*)",
  ]
    .filter(Boolean)
    .join("\n\n");
  const definitions = [
    ...readableRoots.map((root, index) => `-DREADABLE_ROOT_${index}=${root}`),
    ...writableRoots.map((root, index) => `-DWRITABLE_ROOT_${index}=${root}`),
  ];
  return {
    program: "/usr/bin/sandbox-exec",
    args: ["-p", policy, ...definitions, "--", input.command, ...input.args],
  };
}
