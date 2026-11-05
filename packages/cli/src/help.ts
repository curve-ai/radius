/** Stricli only understands `--help`, so `radius help [command]` becomes that. */
export function expandHelpCommand(argv: readonly string[]): string[] {
  return argv[0] === "help" ? [...argv.slice(1), "--help"] : [...argv];
}
