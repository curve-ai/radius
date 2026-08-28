import {
  ConnectorCatalogEntrySchema,
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
import { initializeStorage } from "./storage";
import { getConnectorCatalogAccessToken } from "./sync";

const CATALOG_TIMEOUT_MS = 20_000;
const LOGO_TIMEOUT_MS = 8_000;
const MAX_LOGO_BYTES = 1024 * 1024;
const logoCache = new Map<string, string | null>();

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
  try {
    const url = new URL(value);
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
      throw new Error("CONNECTOR_LOGO_URL_INVALID");
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
    if (declaredLength > MAX_LOGO_BYTES)
      throw new Error("CONNECTOR_LOGO_TOO_LARGE");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) {
      throw new Error("CONNECTOR_LOGO_SIZE_INVALID");
    }
    const result = `data:${contentType};base64,${bytes.toString("base64")}`;
    logoCache.set(value, result);
    return result;
  } catch {
    logoCache.set(value, null);
    return null;
  }
}

export async function listConnectorCatalogForRenderer(
  search: unknown,
): Promise<ConnectorCatalogListResponse> {
  const query = typeof search === "string" ? search.trim().slice(0, 120) : "";
  const url = new URL("connectors", catalogBaseUrl());
  url.searchParams.set("limit", "100");
  if (query) url.searchParams.set("search", query);
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
    connectors: await Promise.all(
      parsed.connectors.map(async (entry) => ({
        ...entry,
        logoUrl: await logoDataUrl(entry.logoUrl),
      })),
    ),
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
