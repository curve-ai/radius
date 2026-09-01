import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import path from "node:path";

import { resolveLocalArtifactPath } from "@curve-ai/radius-sync-core";
import { app } from "electron";
import type {
  MarkdownLinkPreviewResolution,
  MarkdownMediaResolution,
} from "../radius-api";
import { BoundedLru } from "./bounded-lru";
import {
  MAX_LOCAL_IMAGE_BYTES,
  readBoundedImageFile,
  radiusImageMatchesSignature,
  radiusImageMimeTypeForPath,
  RADIUS_IMAGE_CONTENT_TYPES,
} from "./image-content";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FAVICON_BYTES = 256 * 1024;
const MAX_HTML_BYTES = 256 * 1024;
const MAX_CACHE_ENTRIES = 64;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const FAVICON_CONTENT_TYPES = new Set([
  ...RADIUS_IMAGE_CONTENT_TYPES,
  "image/vnd.microsoft.icon",
  "image/x-icon",
]);

interface BoundedResponse {
  body: Buffer;
  contentType: string;
  finalUrl: string;
}

const mediaCache = new BoundedLru<MarkdownMediaResolution>(
  MAX_CACHE_ENTRIES,
  MAX_CACHE_BYTES,
);
const previewCache = new BoundedLru<MarkdownLinkPreviewResolution>(
  MAX_CACHE_ENTRIES,
  MAX_CACHE_BYTES,
);
const mediaInflight = new Map<string, Promise<MarkdownMediaResolution>>();
const previewInflight = new Map<
  string,
  Promise<MarkdownLinkPreviewResolution>
>();

function blockedReason(
  reason: Extract<MarkdownMediaResolution, { state: "blocked" }>["reason"],
): MarkdownMediaResolution {
  return { state: "blocked", reason };
}

function parsePublicHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true;
  }
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (isIP(mapped) === 4) return isPrivateIpv4(mapped);
    const segments = mapped.split(":");
    if (segments.length !== 2) return true;
    const high = Number.parseInt(segments[0] ?? "", 16);
    const low = Number.parseInt(segments[1] ?? "", 16);
    if (
      !Number.isInteger(high) ||
      !Number.isInteger(low) ||
      high < 0 ||
      high > 0xffff ||
      low < 0 ||
      low > 0xffff
    ) {
      return true;
    }
    return isPrivateIpv4(
      `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
    );
  }
  if (normalized.startsWith("::")) return true;
  const firstSegment = Number.parseInt(normalized.split(":")[0] || "0", 16);
  return (
    (firstSegment & 0xfe00) === 0xfc00 ||
    (firstSegment & 0xffc0) === 0xfe80 ||
    (firstSegment & 0xffc0) === 0xfec0 ||
    (firstSegment & 0xff00) === 0xff00 ||
    normalized.startsWith("2001:db8:")
  );
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !isPrivateIpv4(address);
  if (family === 6) return !isPrivateIpv6(address);
  return false;
}

async function publicAddresses(
  hostname: string,
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const normalizedHostname =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  const literalFamily = isIP(normalizedHostname);
  if (literalFamily) {
    if (!isPublicIpAddress(normalizedHostname)) {
      throw new Error("MARKDOWN_URL_PRIVATE");
    }
    return [{ address: normalizedHostname, family: literalFamily as 4 | 6 }];
  }

  const addresses = await dnsLookup(normalizedHostname, {
    all: true,
    verbatim: true,
  });
  if (
    addresses.length === 0 ||
    addresses.some((entry) => !isPublicIpAddress(entry.address))
  ) {
    throw new Error("MARKDOWN_URL_PRIVATE");
  }
  return addresses.map((entry) => ({
    address: entry.address,
    family: entry.family as 4 | 6,
  }));
}

async function requestBounded(
  initialUrl: URL,
  options: {
    acceptedContentTypes: ReadonlySet<string>;
    maxBytes: number;
    truncate?: boolean;
  },
  redirectCount = 0,
): Promise<BoundedResponse> {
  const addresses = await publicAddresses(initialUrl.hostname);
  const selected = addresses[0];
  if (!selected) throw new Error("MARKDOWN_URL_UNRESOLVED");

  return new Promise<BoundedResponse>((resolve, reject) => {
    const request = httpsRequest(
      initialUrl,
      {
        headers: {
          accept: [...options.acceptedContentTypes].join(", "),
          "accept-encoding": "identity",
          "user-agent": "Radius/0.0.1 MarkdownResource",
        },
        lookup: (_hostname, lookupOptions, callback) => {
          if (lookupOptions.all) {
            callback(null, addresses);
            return;
          }
          callback(null, selected.address, selected.family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error("MARKDOWN_REDIRECT_LIMIT"));
            return;
          }
          const redirectUrl = parsePublicHttpsUrl(
            new URL(location, initialUrl).toString(),
          );
          if (!redirectUrl) {
            reject(new Error("MARKDOWN_REDIRECT_BLOCKED"));
            return;
          }
          void requestBounded(redirectUrl, options, redirectCount + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error("MARKDOWN_HTTP_STATUS"));
          return;
        }

        const contentType = String(response.headers["content-type"] ?? "")
          .split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        if (!contentType || !options.acceptedContentTypes.has(contentType)) {
          response.resume();
          reject(new Error("MARKDOWN_CONTENT_TYPE"));
          return;
        }
        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (declaredLength > options.maxBytes && !options.truncate) {
          response.resume();
          reject(new Error("MARKDOWN_RESOURCE_TOO_LARGE"));
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          if (options.truncate && bytes + chunk.length > options.maxBytes) {
            const remaining = options.maxBytes - bytes;
            if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
            bytes = options.maxBytes;
            resolve({
              body: Buffer.concat(chunks, bytes),
              contentType,
              finalUrl: initialUrl.toString(),
            });
            response.destroy();
            return;
          }
          bytes += chunk.length;
          if (bytes > options.maxBytes) {
            request.destroy(new Error("MARKDOWN_RESOURCE_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks, bytes),
            contentType,
            finalUrl: initialUrl.toString(),
          });
        });
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("MARKDOWN_REQUEST_TIMEOUT"));
    });
    request.on("error", reject);
    request.end();
  });
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      }
      if (entity.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      }
      return named[entity.toLowerCase()] ?? match;
    },
  );
}

function cleanMetadataText(
  value: string | undefined,
  maxLength: number,
): string | null {
  if (!value) return null;
  const text = decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, maxLength) : null;
}

function tagAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(
    /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g,
  )) {
    const name = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4];
    if (name && value !== undefined) attributes.set(name, value);
  }
  return attributes;
}

function iconPreference(
  attributes: ReadonlyMap<string, string>,
  relations: readonly string[],
  href: string,
): number {
  const type = (attributes.get("type") ?? "").toLowerCase();
  const pathname = href.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  const raster =
    RADIUS_IMAGE_CONTENT_TYPES.has(type) ||
    /\.(?:avif|gif|jpe?g|png|webp)$/.test(pathname);
  if (raster && relations.includes("icon")) return 4;
  if (raster && relations.includes("apple-touch-icon")) return 3;
  if (relations.includes("icon")) return 2;
  return 1;
}

export function extractLinkMetadata(html: string): {
  description: string | null;
  iconDarkUrl: string | null;
  iconLightUrl: string | null;
  iconUrl: string | null;
  imageUrl: string | null;
  siteName: string | null;
  title: string | null;
} {
  const metadata = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    const key = (
      attributes.get("property") ?? attributes.get("name")
    )?.toLowerCase();
    const content = attributes.get("content");
    if (key && content && !metadata.has(key)) metadata.set(key, content);
  }
  let iconUrl: string | null = null;
  let iconDarkUrl: string | null = null;
  let iconLightUrl: string | null = null;
  let iconRank = 0;
  let iconDarkRank = 0;
  let iconLightRank = 0;
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    const relations = (attributes.get("rel") ?? "").toLowerCase().split(/\s+/);
    const href = attributes.get("href");
    if (
      href &&
      relations.some(
        (relation) => relation === "icon" || relation.endsWith("-icon"),
      )
    ) {
      const media = (attributes.get("media") ?? "").toLowerCase();
      const rank = iconPreference(attributes, relations, href);
      if (media.includes("prefers-color-scheme") && media.includes("dark")) {
        if (rank > iconDarkRank) {
          iconDarkUrl = href;
          iconDarkRank = rank;
        }
      } else if (
        media.includes("prefers-color-scheme") &&
        media.includes("light")
      ) {
        if (rank > iconLightRank) {
          iconLightUrl = href;
          iconLightRank = rank;
        }
      } else if (rank > iconRank) {
        iconUrl = href;
        iconRank = rank;
      }
    }
  }
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return {
    title: cleanMetadataText(metadata.get("og:title") ?? titleMatch?.[1], 200),
    description: cleanMetadataText(
      metadata.get("og:description") ?? metadata.get("description"),
      500,
    ),
    iconDarkUrl,
    iconLightUrl,
    iconUrl,
    siteName: cleanMetadataText(metadata.get("og:site_name"), 100),
    imageUrl: cleanMetadataText(metadata.get("og:image"), 2_000),
  };
}

async function resolveFavicon(
  pageUrl: string,
  iconUrl: string | null,
  includeConventionalFallback = true,
): Promise<string | null> {
  const candidates = includeConventionalFallback
    ? [new URL("/favicon.ico", pageUrl).toString()]
    : [];
  if (iconUrl) {
    try {
      candidates.unshift(new URL(iconUrl, pageUrl).toString());
    } catch {
      // Ignore malformed icon metadata and retain the conventional fallback.
    }
  }
  for (const candidate of new Set(candidates)) {
    const url = parsePublicHttpsUrl(candidate);
    if (!url) continue;
    try {
      const response = await requestBounded(url, {
        acceptedContentTypes: FAVICON_CONTENT_TYPES,
        maxBytes: MAX_FAVICON_BYTES,
      });
      return `data:${response.contentType};base64,${response.body.toString("base64")}`;
    } catch {
      continue;
    }
  }
  return null;
}

async function resolveMediaUncached(
  url: URL,
): Promise<MarkdownMediaResolution> {
  try {
    const response = await requestBounded(url, {
      acceptedContentTypes: RADIUS_IMAGE_CONTENT_TYPES,
      maxBytes: MAX_IMAGE_BYTES,
    });
    return {
      state: "ready",
      contentType: response.contentType,
      dataUrl: `data:${response.contentType};base64,${response.body.toString("base64")}`,
      finalUrl: response.finalUrl,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "MARKDOWN_URL_PRIVATE" ||
        error.message === "MARKDOWN_REDIRECT_BLOCKED")
    ) {
      return blockedReason("unsafe_url");
    }
    if (
      error instanceof Error &&
      (error.message === "MARKDOWN_CONTENT_TYPE" ||
        error.message === "MARKDOWN_RESOURCE_TOO_LARGE")
    ) {
      return blockedReason(
        error.message === "MARKDOWN_CONTENT_TYPE"
          ? "unsupported_type"
          : "too_large",
      );
    }
    return { state: "unavailable" };
  }
}

async function resolveGeneratedImageUncached(
  value: string,
): Promise<MarkdownMediaResolution> {
  try {
    const url = new URL(value);
    if (url.protocol !== "sandbox:" || url.hostname) {
      return blockedReason("unsafe_url");
    }
    const absolutePath = decodeURIComponent(url.pathname);
    const generatedImageRoot = path.join(
      app.getPath("home"),
      ".codex",
      "generated_images",
    );
    const relativePath = path.relative(generatedImageRoot, absolutePath);
    const filePath = await resolveLocalArtifactPath(
      generatedImageRoot,
      relativePath,
    );
    const mimeType = radiusImageMimeTypeForPath(filePath);
    if (!mimeType) return blockedReason("unsupported_type");
    const bytes = await readBoundedImageFile(filePath, MAX_LOCAL_IMAGE_BYTES);
    if (!radiusImageMatchesSignature(mimeType, bytes)) {
      return blockedReason("unsupported_type");
    }
    return {
      state: "ready",
      contentType: mimeType,
      dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
      finalUrl: value,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "RADIUS_IMAGE_TOO_LARGE") {
      return blockedReason("too_large");
    }
    return { state: "unavailable" };
  }
}

export async function resolveMarkdownMedia(
  value: unknown,
): Promise<MarkdownMediaResolution> {
  if (typeof value !== "string") return blockedReason("unsafe_url");
  const url = parsePublicHttpsUrl(value);
  const generatedImage = value.startsWith("sandbox:");
  if (!url && !generatedImage) return blockedReason("unsafe_url");
  const key = url?.toString() ?? value;
  const cached = mediaCache.get(key);
  if (cached) return cached;
  const pending = mediaInflight.get(key);
  if (pending) return pending;
  const promise = (
    url ? resolveMediaUncached(url) : resolveGeneratedImageUncached(value)
  )
    .then((result) => {
      const bytes = result.state === "ready" ? result.dataUrl.length : 64;
      mediaCache.set(key, result, bytes);
      return result;
    })
    .finally(() => mediaInflight.delete(key));
  mediaInflight.set(key, promise);
  return promise;
}

async function resolvePreviewUncached(
  url: URL,
): Promise<MarkdownLinkPreviewResolution> {
  let response: BoundedResponse;
  try {
    response = await requestBounded(url, {
      acceptedContentTypes: new Set(["application/xhtml+xml", "text/html"]),
      maxBytes: MAX_HTML_BYTES,
      truncate: true,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "MARKDOWN_URL_PRIVATE" ||
        error.message === "MARKDOWN_REDIRECT_BLOCKED")
    ) {
      return { state: "blocked", reason: "unsafe_url" };
    }
    const faviconDataUrl = await resolveFavicon(url.toString(), null);
    return faviconDataUrl
      ? { state: "ready", faviconDataUrl, faviconDarkDataUrl: null }
      : { state: "unavailable" };
  }

  const metadata = extractLinkMetadata(response.body.toString("utf8"));
  const [faviconDataUrl, faviconDarkDataUrl] = await Promise.all([
    resolveFavicon(
      response.finalUrl,
      metadata.iconLightUrl ?? metadata.iconUrl,
    ),
    metadata.iconDarkUrl
      ? resolveFavicon(response.finalUrl, metadata.iconDarkUrl, false)
      : null,
  ]);
  return {
    state: "ready",
    faviconDataUrl,
    faviconDarkDataUrl,
  };
}

export async function resolveMarkdownLinkPreview(
  value: unknown,
): Promise<MarkdownLinkPreviewResolution> {
  if (typeof value !== "string") {
    return { state: "blocked", reason: "unsafe_url" };
  }
  const url = parsePublicHttpsUrl(value);
  if (!url) return { state: "blocked", reason: "unsafe_url" };
  const key = url.toString();
  const cached = previewCache.get(key);
  if (cached) return cached;
  const pending = previewInflight.get(key);
  if (pending) return pending;
  const promise = resolvePreviewUncached(url)
    .then((result) => {
      const bytes = JSON.stringify(result).length;
      previewCache.set(key, result, bytes);
      return result;
    })
    .finally(() => previewInflight.delete(key));
  previewInflight.set(key, promise);
  return promise;
}
