import {
  ConnectorCatalogEntrySchema,
  ConnectorCatalogTaxonomyCategoryIdSchema,
  ConnectorCatalogListResponseSchema,
  ConnectorLogoResolutionSchema,
  type ConnectorCatalogEntry,
  type ConnectorCatalogListResponse,
} from "@curve-ai/radius-connector-protocol";
import {
  installCatalogConnector,
  type ConnectorSummary,
} from "@curve-ai/radius-storage";

import { localDeviceIdentity } from "./device-identity";
import { BoundedLru } from "./bounded-lru";
import { initializeStorage } from "./storage";
import { getConnectorCatalogAccessToken } from "./sync";

const CATALOG_TIMEOUT_MS = 20_000;
const LOGO_TIMEOUT_MS = 8_000;
const MAX_LOGO_BYTES = 1024 * 1024;
const MAX_LOGO_CACHE_ENTRIES = 128;
const MAX_LOGO_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_CONCURRENT_LOGO_REQUESTS = 8;
const logoCache = new BoundedLru<string | null>(
  MAX_LOGO_CACHE_ENTRIES,
  MAX_LOGO_CACHE_BYTES,
);
const logoRequests = new Map<string, Promise<string | null>>();

function catalogBaseUrl(): URL {
  const configured =
    process.env.RADIUS_CONNECTOR_CATALOG_URL?.trim() ||
    "http://localhost:3100/api/connector-catalog/v1/";
  const url = new URL(configured.endsWith("/") ? configured : `${configured}/`);
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("CONNECTOR_CATALOG_URL_INVALID");
  }
  return url;
}

async function catalogFetch(pathname: string): Promise<Response> {
  return fetch(new URL(pathname, catalogBaseUrl()), {
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
}

async function logoDataUrl(value: string | null): Promise<string | null> {
  if (!value) return null;
  const cached = logoCache.get(value);
  if (cached !== undefined) return cached;
  const pending = logoRequests.get(value);
  if (pending) return pending;

  const request = (async (): Promise<string | null> => {
    try {
      const url = new URL(value);
      const loopback =
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]";
      if (
        url.protocol !== "https:" &&
        !(loopback && url.protocol === "http:")
      ) {
        throw new Error("CONNECTOR_LOGO_URL_INVALID");
      }
      const response = await fetch(url, {
        signal: AbortSignal.timeout(LOGO_TIMEOUT_MS),
        headers: { accept: "image/png,image/jpeg,image/webp" },
      });
      if (!response.ok) throw new Error(`CONNECTOR_LOGO_${response.status}`);
      const contentType = response.headers.get("content-type")?.split(";")[0];
      if (
        !contentType ||
        !["image/png", "image/jpeg", "image/webp"].includes(contentType)
      ) {
        throw new Error("CONNECTOR_LOGO_TYPE_INVALID");
      }
      const declaredLength = Number(
        response.headers.get("content-length") || "0",
      );
      if (declaredLength > MAX_LOGO_BYTES) {
        throw new Error("CONNECTOR_LOGO_TOO_LARGE");
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) {
        throw new Error("CONNECTOR_LOGO_SIZE_INVALID");
      }
      return `data:${contentType};base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  })();
  logoRequests.set(value, request);
  try {
    const result = await request;
    logoCache.set(value, result, result ? Buffer.byteLength(result) : 0);
    return result;
  } finally {
    logoRequests.delete(value);
  }
}

async function resolveCatalogLogos(
  entries: ConnectorCatalogEntry[],
): Promise<ConnectorCatalogEntry[]> {
  const resolved = new Array<ConnectorCatalogEntry>(entries.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT_LOGO_REQUESTS, entries.length) },
    async () => {
      while (nextIndex < entries.length) {
        const index = nextIndex;
        nextIndex += 1;
        const entry = entries[index];
        if (!entry) continue;
        resolved[index] = {
          ...entry,
          logoUrl: await logoDataUrl(entry.logoUrl),
        };
      }
    },
  );
  await Promise.all(workers);
  return resolved;
}

export async function listConnectorCatalogForRenderer(
  input: unknown,
): Promise<ConnectorCatalogListResponse> {
  const request =
    typeof input === "object" && input !== null
      ? (input as {
          category?: unknown;
          cursor?: unknown;
          search?: unknown;
        })
      : {};
  const search =
    typeof request.search === "string"
      ? request.search.trim().slice(0, 120)
      : "";
  const category =
    request.category === undefined
      ? null
      : ConnectorCatalogTaxonomyCategoryIdSchema.safeParse(request.category);
  if (category && !category.success) {
    throw new Error("CONNECTOR_CATALOG_CATEGORY_INVALID");
  }
  const cursor =
    typeof request.cursor === "string"
      ? request.cursor.trim().slice(0, 4096)
      : "";
  const url = new URL("connectors", catalogBaseUrl());
  url.searchParams.set("limit", "100");
  if (search) url.searchParams.set("search", search);
  if (category?.success) url.searchParams.set("category", category.data);
  if (cursor) url.searchParams.set("cursor", cursor);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`CONNECTOR_CATALOG_${response.status}`);
  const parsed = ConnectorCatalogListResponseSchema.parse(
    await response.json(),
  );
  return {
    ...parsed,
    connectors: await resolveCatalogLogos(parsed.connectors),
  };
}

async function getCatalogEntry(id: string): Promise<ConnectorCatalogEntry> {
  const response = await catalogFetch(`connectors/${encodeURIComponent(id)}`);
  if (!response.ok)
    throw new Error(`CONNECTOR_CATALOG_ENTRY_${response.status}`);
  return ConnectorCatalogEntrySchema.parse(await response.json());
}

export async function installCatalogConnectorForRenderer(
  id: unknown,
): Promise<ConnectorSummary> {
  if (typeof id !== "string" || !id) {
    throw new Error("A catalog connector identifier is required");
  }
  const entry = await getCatalogEntry(id);
  const context = await initializeStorage();
  return installCatalogConnector(context.database, {
    clientInstanceId: localDeviceIdentity(context.vault).clientInstanceId,
    catalogEntry: entry,
  });
}

export async function getConnectorLogoForDomain(
  domain: string,
): Promise<string | null> {
  const response = await catalogFetch(
    `logos/${encodeURIComponent(domain.toLowerCase())}`,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`CONNECTOR_LOGO_${response.status}`);
  return logoDataUrl(
    ConnectorLogoResolutionSchema.parse(await response.json()).logoUrl,
  );
}

export async function requestConnectorLogoResolution(
  domain: string,
  homepageUrl: string,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const token = await getConnectorCatalogAccessToken(controller.signal);
    const response = await fetch(new URL("logos/resolve", catalogBaseUrl()), {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ domain, homepageUrl }),
    });
    if (!response.ok && response.status !== 202) {
      throw new Error(`CONNECTOR_LOGO_RESOLVE_${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
