import {
  bootstrapPlatformOwner,
  createPlatformPool,
  migratePlatformDatabase,
} from "@curve-ai/platform-database";

const HELP = `Radius Platform operator CLI

Commands:
  bootstrap-owner --organization <slug> --organization-name <name> --account-name <name> [--token-label <label>]

The bootstrap command is available only while the Platform has no organization.
It prints the initial developer token once; store it in a secret manager.`;

try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "help") {
    console.info(HELP);
  } else if (command === "bootstrap-owner") {
    await bootstrapOwner(args);
  } else {
    throw new Error(`Unknown command ${command}\n\n${HELP}`);
  }
} catch (error) {
  console.error(
    `radius-platform-admin: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}

async function bootstrapOwner(args: readonly string[]): Promise<void> {
  const flags = parseFlags(args);
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const pool = createPlatformPool({
    connectionString,
    applicationName: "radius-platform-admin",
    maxConnections: 1,
    statementTimeoutMs: 60_000,
  });
  try {
    await migratePlatformDatabase(
      pool,
      process.env.RADIUS_PLATFORM_MIGRATIONS_DIR,
    );
    const result = await bootstrapPlatformOwner(pool, {
      organizationSlug: requiredFlag(flags, "organization"),
      organizationDisplayName: requiredFlag(flags, "organization-name"),
      accountDisplayName: requiredFlag(flags, "account-name"),
      tokenLabel: flags.get("token-label"),
    });
    console.info(`Organization ID: ${result.organizationId}`);
    console.info(`Account ID: ${result.accountId}`);
    console.info(`Developer token ID: ${result.developerTokenId}`);
    console.info("");
    console.info("Developer token (shown once):");
    console.info(result.developerToken);
  } finally {
    await pool.end();
  }
}

function parseFlags(args: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Invalid arguments\n\n${HELP}`);
    }
    const name = flag.slice(2);
    if (flags.has(name)) throw new Error(`Duplicate flag --${name}`);
    if (
      ![
        "organization",
        "organization-name",
        "account-name",
        "token-label",
      ].includes(name)
    ) {
      throw new Error(`Unknown flag --${name}`);
    }
    flags.set(name, value);
  }
  return flags;
}

function requiredFlag(
  flags: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = flags.get(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}
