import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

import { validatePlatformBaseUrl } from "@curve-ai/platform-client";

export interface RadiusTargetProfile {
  apiUrl: string;
}

interface RadiusProfileDocument {
  version: 1;
  active: string | null;
  profiles: Record<string, RadiusTargetProfile>;
}

const emptyProfiles = (): RadiusProfileDocument => ({
  version: 1,
  active: null,
  profiles: {},
});

export class RadiusProfileStore {
  readonly path: string;

  constructor(path = defaultProfilePath()) {
    this.path = path;
  }

  async list(): Promise<RadiusProfileDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      return parseProfileDocument(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyProfiles();
      throw error;
    }
  }

  async add(name: string, apiUrl: string): Promise<void> {
    validateProfileName(name);
    const document = await this.list();
    document.profiles[name] = {
      apiUrl: validatePlatformBaseUrl(apiUrl).href.replace(/\/$/, ""),
    };
    document.active ??= name;
    await this.write(document);
  }

  async switch(name: string): Promise<void> {
    validateProfileName(name);
    const document = await this.list();
    if (!document.profiles[name]) throw new Error(`Unknown Radius profile ${name}`);
    document.active = name;
    await this.write(document);
  }

  async resolve(name?: string): Promise<{ name: string; apiUrl: string }> {
    if (!name && process.env.RADIUS_API_URL?.trim()) {
      return {
        name: "environment",
        apiUrl: validatePlatformBaseUrl(process.env.RADIUS_API_URL).href.replace(/\/$/, ""),
      };
    }
    const document = await this.list();
    const selected = name ?? document.active;
    if (!selected) {
      throw new Error(
        "No Radius target profile. Add one with radius profiles add <name> --api-url <url>.",
      );
    }
    const profile = document.profiles[selected];
    if (!profile) throw new Error(`Unknown Radius profile ${selected}`);
    return { name: selected, apiUrl: profile.apiUrl };
  }

  private async write(document: RadiusProfileDocument): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.tmp-${process.pid}`;
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.path);
  }
}

export function defaultProfilePath(): string {
  const configured = process.env.RADIUS_CONFIG_HOME?.trim();
  if (configured) return join(configured, "profiles.json");
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return join(xdg || join(homedir(), ".config"), "radius", "profiles.json");
}

function validateProfileName(name: string): void {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) {
    throw new Error("Profile names must be lowercase identifiers up to 32 characters");
  }
}

function parseProfileDocument(value: unknown): RadiusProfileDocument {
  if (!value || typeof value !== "object") throw new Error("Invalid Radius profiles file");
  const candidate = value as Partial<RadiusProfileDocument>;
  if (candidate.version !== 1 || typeof candidate.profiles !== "object") {
    throw new Error("Invalid Radius profiles file");
  }
  const profiles: Record<string, RadiusTargetProfile> = {};
  for (const [name, profile] of Object.entries(candidate.profiles ?? {})) {
    validateProfileName(name);
    if (!profile || typeof profile.apiUrl !== "string") {
      throw new Error(`Invalid Radius profile ${name}`);
    }
    profiles[name] = {
      apiUrl: validatePlatformBaseUrl(profile.apiUrl).href.replace(/\/$/, ""),
    };
  }
  if (
    candidate.active !== null &&
    candidate.active !== undefined &&
    (typeof candidate.active !== "string" || !profiles[candidate.active])
  ) {
    throw new Error("Active Radius profile does not exist");
  }
  return {
    version: 1,
    active: candidate.active ?? null,
    profiles,
  };
}
