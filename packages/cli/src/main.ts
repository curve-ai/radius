import { parseArgs } from "node:util";

import { loadAgentConfig } from "./config.js";
import { buildAgent } from "./build.js";
import { deployAgent } from "./deploy.js";
import { changeAgentDeployment } from "./deployments.js";
import { runDevelopmentAgent } from "./dev.js";
import { initializeAgentProject } from "./init.js";
import {
  showAgentDeployments,
  showAgentEnvironmentHistory,
} from "./inventory.js";
import { processIo, type CliIo } from "./io.js";
import { loginToRadius, logoutFromRadius } from "./login.js";
import {
  listOrganizationMembers,
  parseOrganizationMemberRole,
  updateOrganizationMember,
} from "./members.js";
import { showIdentity, showPlatformInfo } from "./platform.js";
import { RadiusProfileStore } from "./profiles.js";
import { readSecretFromStdin } from "./secret-input.js";
import {
  createDeveloperToken,
  listDeveloperTokens,
  revokeDeveloperToken,
} from "./tokens.js";

export async function runCli(
  argv: string[],
  options: {
    cwd?: string;
    io?: CliIo;
    readSecret?: () => Promise<string>;
  } = {},
): Promise<void> {
  const [command, ...args] = argv;
  const root = options.cwd ?? process.cwd();
  const io = options.io ?? processIo;

  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    io.out(helpText());
    return;
  }

  if (command === "init") {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      options: {
        "agent-ref": { type: "string" },
        language: { type: "string" },
        "skip-install": { type: "boolean", default: false },
        force: { type: "boolean", default: false },
      },
    });
    const language = parsed.values.language ?? "typescript";
    if (language !== "typescript" && language !== "python") {
      throw new Error("--language must be typescript or python");
    }
    await initializeAgentProject({
      root,
      agentRef: parsed.values["agent-ref"],
      language,
      skipInstall: parsed.values["skip-install"],
      force: parsed.values.force,
      io,
    });
    return;
  }

  if (command === "validate") {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      options: { config: { type: "string" } },
    });
    const loaded = await loadAgentConfig(root, parsed.values.config);
    io.out(`Valid Radius config: ${loaded.path}`);
    io.out(`Agent: ${loaded.config.name}`);
    io.out(`Runtime: ${loaded.config.runtime.kind}`);
    return;
  }

  if (command === "dev") {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      options: {
        config: { type: "string" },
        endpoint: { type: "string" },
        "authorization-env": { type: "string" },
      },
    });
    await runDevelopmentAgent({
      root,
      configPath: parsed.values.config,
      endpoint: parsed.values.endpoint,
      authorizationEnv: parsed.values["authorization-env"],
      io,
    });
    return;
  }

  if (command === "deploy") {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      options: {
        config: { type: "string" },
        build: { type: "string" },
        environment: { type: "string" },
        organization: { type: "string" },
        profile: { type: "string" },
        "skip-promotion": { type: "boolean", default: false },
        "expected-revision": { type: "string" },
      },
    });
    const expectedRevision = parsed.values["expected-revision"]
      ? Number(parsed.values["expected-revision"])
      : null;
    if (
      expectedRevision !== null &&
      (!Number.isInteger(expectedRevision) || expectedRevision <= 0)
    ) {
      throw new Error("--expected-revision must be a positive integer");
    }
    await deployAgent({
      root,
      configPath: parsed.values.config,
      buildReference: parsed.values.build,
      environment: parsed.values.environment,
      organization: parsed.values.organization,
      profile: parsed.values.profile,
      promote: !parsed.values["skip-promotion"],
      expectedDeploymentRevision: expectedRevision,
      io,
    });
    return;
  }

  if (command === "build") {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      options: {
        config: { type: "string" },
        "runtime-host": { type: "string" },
        kernel: { type: "string" },
        "runtime-root": { type: "string" },
      },
    });
    await buildAgent({
      root,
      configPath: parsed.values.config,
      runtimeHostPath: parsed.values["runtime-host"],
      kernelPath: parsed.values.kernel,
      runtimeRoot: parsed.values["runtime-root"],
      io,
    });
    return;
  }

  if (command === "promote" || command === "rollback") {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        to: { type: "string" },
        config: { type: "string" },
        environment: { type: "string" },
        profile: { type: "string" },
        "expected-revision": { type: "string" },
      },
    });
    const agentDeploymentId =
      command === "promote" ? parsed.positionals[0] : parsed.values.to;
    if (!agentDeploymentId) {
      throw new Error(
        command === "promote"
          ? "Usage: radius promote <agent-deployment-id>"
          : "Usage: radius rollback --to <agent-deployment-id>",
      );
    }
    if (command === "promote" && parsed.positionals.length !== 1) {
      throw new Error("Usage: radius promote <agent-deployment-id>");
    }
    await changeAgentDeployment({
      action: command,
      root,
      agentDeploymentId,
      configPath: parsed.values.config,
      environment: parsed.values.environment,
      profile: parsed.values.profile,
      expectedDeploymentRevision: parseExpectedRevision(
        parsed.values["expected-revision"],
      ),
      io,
    });
    return;
  }

  if (command === "deployments" || command === "environments") {
    const [action, ...inventoryArgs] = args;
    const expectedAction = command === "deployments" ? "list" : "status";
    if (action !== expectedAction) {
      throw new Error(
        command === "deployments"
          ? "Usage: radius deployments list"
          : "Usage: radius environments status",
      );
    }
    const parsed = parseArgs({
      args: inventoryArgs,
      allowPositionals: false,
      options: {
        config: { type: "string" },
        environment: { type: "string" },
        profile: { type: "string" },
        limit: { type: "string" },
        cursor: { type: "string" },
        json: { type: "boolean", default: false },
      },
    });
    const inventoryOptions = {
      root,
      configPath: parsed.values.config,
      profile: parsed.values.profile,
      limit: parsePageLimit(parsed.values.limit),
      cursor: parsed.values.cursor,
      json: parsed.values.json,
      io,
    };
    if (command === "deployments") {
      await showAgentDeployments(inventoryOptions);
    } else {
      await showAgentEnvironmentHistory({
        ...inventoryOptions,
        environment: parsed.values.environment,
      });
    }
    return;
  }

  if (command === "profiles") {
    const [action, name, ...profileArgs] = args;
    const store = new RadiusProfileStore();
    if (action === "list") {
      const document = await store.list();
      for (const [profileName, profile] of Object.entries(document.profiles)) {
        io.out(
          `${document.active === profileName ? "*" : " "} ${profileName}\t${profile.apiUrl}`,
        );
      }
      return;
    }
    if (action === "add" && name) {
      const parsed = parseArgs({
        args: profileArgs,
        allowPositionals: false,
        options: { "api-url": { type: "string" } },
      });
      if (!parsed.values["api-url"]) throw new Error("--api-url is required");
      await store.add(name, parsed.values["api-url"]);
      io.out(`Added Radius profile ${name}`);
      return;
    }
    if (action === "switch" && name) {
      await store.switch(name);
      io.out(`Active Radius profile: ${name}`);
      return;
    }
    throw new Error("Usage: radius profiles list|add|switch");
  }

  if (command === "login") {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      options: {
        profile: { type: "string" },
        "api-url": { type: "string" },
      },
    });
    const token = await (options.readSecret ?? readSecretFromStdin)();
    await loginToRadius({
      profile: parsed.values.profile,
      apiUrl: parsed.values["api-url"],
      token,
      io,
    });
    return;
  }

  if (command === "logout") {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      options: { profile: { type: "string" } },
    });
    await logoutFromRadius({ profile: parsed.values.profile, io });
    return;
  }

  if (command === "tokens") {
    const [action, ...tokenArgs] = args;
    if (action === "list") {
      const parsed = parseArgs({
        args: tokenArgs,
        allowPositionals: false,
        options: {
          organization: { type: "string" },
          profile: { type: "string" },
          json: { type: "boolean", default: false },
        },
      });
      await listDeveloperTokens({
        organization: parsed.values.organization,
        profile: parsed.values.profile,
        json: parsed.values.json,
        io,
      });
      return;
    }
    if (action === "create") {
      const parsed = parseArgs({
        args: tokenArgs,
        allowPositionals: false,
        options: {
          organization: { type: "string" },
          profile: { type: "string" },
          label: { type: "string" },
          scope: { type: "string", multiple: true },
          "expires-at": { type: "string" },
        },
      });
      if (!parsed.values.label) throw new Error("--label is required");
      await createDeveloperToken({
        organization: parsed.values.organization,
        profile: parsed.values.profile,
        label: parsed.values.label,
        scopes: parsed.values.scope ?? [],
        expiresAt: parsed.values["expires-at"],
        io,
      });
      return;
    }
    if (action === "revoke") {
      const parsed = parseArgs({
        args: tokenArgs,
        allowPositionals: true,
        options: {
          organization: { type: "string" },
          profile: { type: "string" },
        },
      });
      if (parsed.positionals.length !== 1) {
        throw new Error("Usage: radius tokens revoke <token-id>");
      }
      await revokeDeveloperToken({
        developerTokenId: parsed.positionals[0]!,
        organization: parsed.values.organization,
        profile: parsed.values.profile,
        io,
      });
      return;
    }
    throw new Error("Usage: radius tokens list|create|revoke");
  }

  if (command === "members") {
    const [action, ...memberArgs] = args;
    if (action === "list") {
      const parsed = parseArgs({
        args: memberArgs,
        allowPositionals: false,
        options: {
          organization: { type: "string" },
          profile: { type: "string" },
          json: { type: "boolean", default: false },
        },
      });
      await listOrganizationMembers({
        organization: parsed.values.organization,
        profile: parsed.values.profile,
        json: parsed.values.json,
        io,
      });
      return;
    }
    if (["role", "suspend", "restore", "remove"].includes(action ?? "")) {
      const parsed = parseArgs({
        args: memberArgs,
        allowPositionals: true,
        options: {
          organization: { type: "string" },
          profile: { type: "string" },
          role: { type: "string" },
          json: { type: "boolean", default: false },
        },
      });
      if (parsed.positionals.length !== 1) {
        throw new Error(`Usage: radius members ${action} <membership-id>`);
      }
      await updateOrganizationMember({
        membershipId: parsed.positionals[0]!,
        organization: parsed.values.organization,
        profile: parsed.values.profile,
        json: parsed.values.json,
        ...(action === "role"
          ? { role: parseOrganizationMemberRole(parsed.values.role) }
          : {
              lifecycleState:
                action === "suspend"
                  ? "suspended"
                  : action === "restore"
                    ? "active"
                    : "removed",
            }),
        io,
      });
      return;
    }
    throw new Error("Usage: radius members list|role|suspend|restore|remove");
  }

  if (command === "platform-info" || command === "whoami") {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      options: { profile: { type: "string" } },
    });
    if (command === "platform-info") {
      await showPlatformInfo({ profile: parsed.values.profile, io });
    } else {
      await showIdentity({ profile: parsed.values.profile, io });
    }
    return;
  }

  throw new Error(`Unknown Radius command ${command}`);
}

function helpText(): string {
  return `Radius developer CLI

Commands:
  radius login [--profile <name>] [--api-url <url>]
  radius logout [--profile <name>]
  radius init [--language typescript|python] [--agent-ref <ref>] [--skip-install]
  radius validate [--config <path>]
  radius dev [--endpoint <ws-url>] [--authorization-env <name>] [--config <path>]
  radius build [--config <path>]
  radius deploy [--build <digest-or-receipt>] [--organization <slug>] [--environment <slug>] [--profile <name>]
  radius deployments list [--limit <n>] [--cursor <cursor>] [--json]
  radius environments status [--environment <slug>] [--limit <n>] [--json]
  radius promote <agent-deployment-id> [--environment <slug>] [--expected-revision <n>]
  radius rollback --to <agent-deployment-id> --expected-revision <n> [--environment <slug>]
  radius tokens list [--organization <slug>] [--json]
  radius tokens create --label <label> --scope <scope> [--scope <scope> ...]
  radius tokens revoke <token-id> [--organization <slug>]
  radius members list [--organization <slug>] [--json]
  radius members role <membership-id> --role owner|admin|developer|viewer
  radius members suspend|restore|remove <membership-id>
  radius profiles list|add|switch
  radius platform-info [--profile <name>]
  radius whoami [--profile <name>]
`;
}

function parseExpectedRevision(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--expected-revision must be a positive integer");
  }
  return parsed;
}

function parsePageLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("--limit must be an integer from 1 to 100");
  }
  return parsed;
}
