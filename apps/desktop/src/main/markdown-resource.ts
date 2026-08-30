import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import type {
  MarkdownLinkPreviewResolution,
  MarkdownMediaResolution,
} from "../radius-api";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_HTML_BYTES = 256 * 1024;
const MAX_CACHE_ENTRIES = 64;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const IMAGE_CONTENT_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

interface BoundedResponse {
  body: Buffer;
  contentType: string;
  finalUrl: string;
}

interface CacheEntry<Value> {
  bytes: number;
  value: Value;
}

class BoundedLru<Value> {
  private readonly entries = new Map<string, CacheEntry<Value>>();
  private totalBytes = 0;

  get(key: string): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: Value, bytes: number): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.totalBytes -= existing.bytes;
      this.entries.delete(key);
    }
    this.entries.set(key, { bytes, value });
    this.totalBytes += bytes;
    while (
      this.entries.size > MAX_CACHE_ENTRIES ||
      this.totalBytes > MAX_CACHE_BYTES
    ) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.totalBytes -= oldest?.bytes ?? 0;
    }
  }
}

const mediaCache = new BoundedLru<MarkdownMediaResolution>();
const previewCache = new BoundedLru<MarkdownLinkPreviewResolution>();
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
        if (declaredLength > options.maxBytes) {
          response.resume();
          reject(new Error("MARKDOWN_RESOURCE_TOO_LARGE"));
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
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

export function extractLinkMetadata(html: string): {
  description: string | null;
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
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return {
    title: cleanMetadataText(metadata.get("og:title") ?? titleMatch?.[1], 200),
    description: cleanMetadataText(
      metadata.get("og:description") ?? metadata.get("description"),
      500,
    ),
    siteName: cleanMetadataText(metadata.get("og:site_name"), 100),
    imageUrl: cleanMetadataText(metadata.get("og:image"), 2_000),
  };
}

async function resolveMediaUncached(
  url: URL,
): Promise<MarkdownMediaResolution> {
  try {
    const response = await requestBounded(url, {
      acceptedContentTypes: IMAGE_CONTENT_TYPES,
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

export async function resolveMarkdownMedia(
  value: unknown,
): Promise<MarkdownMediaResolution> {
  if (typeof value !== "string") return blockedReason("unsafe_url");
  const url = parsePublicHttpsUrl(value);
  if (!url) return blockedReason("unsafe_url");
  const key = url.toString();
  const cached = mediaCache.get(key);
  if (cached) return cached;
  const pending = mediaInflight.get(key);
  if (pending) return pending;
  const promise = resolveMediaUncached(url).then((result) => {
    const bytes = result.state === "ready" ? result.dataUrl.length : 64;
    mediaCache.set(key, result, bytes);
    mediaInflight.delete(key);
    return result;
  });
  mediaInflight.set(key, promise);
  return promise;
}

async function resolvePreviewUncached(
  url: URL,
): Promise<MarkdownLinkPreviewResolution> {
  try {
    const response = await requestBounded(url, {
      acceptedContentTypes: new Set(["application/xhtml+xml", "text/html"]),
      maxBytes: MAX_HTML_BYTES,
    });
    const metadata = extractLinkMetadata(response.body.toString("utf8"));
    let imageDataUrl: string | null = null;
    if (metadata.imageUrl) {
      try {
        const imageUrl = new URL(
          metadata.imageUrl,
          response.finalUrl,
        ).toString();
        const image = await resolveMarkdownMedia(imageUrl);
        if (image.state === "ready") imageDataUrl = image.dataUrl;
      } catch {
        imageDataUrl = null;
      }
    }
    const finalUrl = new URL(response.finalUrl);
    return {
      state: "ready",
      description: metadata.description,
      finalUrl: response.finalUrl,
      imageDataUrl,
      siteName: metadata.siteName ?? finalUrl.hostname,
      title: metadata.title ?? finalUrl.hostname,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "MARKDOWN_URL_PRIVATE" ||
        error.message === "MARKDOWN_REDIRECT_BLOCKED")
    ) {
      return { state: "blocked", reason: "unsafe_url" };
    }
    return { state: "unavailable" };
  }
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
  const promise = resolvePreviewUncached(url).then((result) => {
    const bytes =
      JSON.stringify(result).length +
      (result.state === "ready" ? (result.imageDataUrl?.length ?? 0) : 0);
    previewCache.set(key, result, bytes);
    previewInflight.delete(key);
    return result;
  });
  previewInflight.set(key, promise);
  return promise;
}
