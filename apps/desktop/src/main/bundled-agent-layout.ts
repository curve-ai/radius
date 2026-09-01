import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const RELEASE_TEMPLATE_LABEL = "ai.curve.radius.release-template.v1";
const VERSION_LABEL = "org.opencontainers.image.version";
const MAX_INDEX_BYTES = 256 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_RELEASE_TEMPLATE_BYTES = 128 * 1024;
const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/;

type JsonRecord = Record<string, unknown>;

export interface EmbeddedAgentRelease {
  imageReference: string;
  platformManifestDigest: string;
  template: JsonRecord;
}

function asRecord(value: unknown, code: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as JsonRecord;
}

async function readBounded(
  filePath: string,
  maxBytes: number,
): Promise<Buffer> {
  const bytes = await readFile(filePath);
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    throw new Error("BUNDLED_AGENT_OCI_METADATA_SIZE_INVALID");
  }
  return bytes;
}

function parseJson(bytes: Buffer, code: string): JsonRecord {
  try {
    return asRecord(JSON.parse(bytes.toString("utf8")), code);
  } catch (error) {
    if (error instanceof Error && error.message === code) throw error;
    throw new Error(code);
  }
}

function descriptor(
  value: unknown,
  maxBytes: number,
  code: string,
): { digest: string; size: number; annotations: JsonRecord } {
  const record = asRecord(value, code);
  const digest = record.digest;
  const size = record.size;
  if (
    typeof digest !== "string" ||
    !sha256DigestPattern.test(digest) ||
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > maxBytes
  ) {
    throw new Error(code);
  }
  const annotations =
    record.annotations === undefined ? {} : asRecord(record.annotations, code);
  return { digest, size, annotations };
}

async function readDescriptorBlob(
  layoutPath: string,
  value: unknown,
  maxBytes: number,
  code: string,
): Promise<{ descriptor: ReturnType<typeof descriptor>; json: JsonRecord }> {
  const parsed = descriptor(value, maxBytes, code);
  const digestHex = parsed.digest.slice("sha256:".length);
  const bytes = await readBounded(
    path.join(layoutPath, "blobs", "sha256", digestHex),
    maxBytes,
  );
  if (
    bytes.byteLength !== parsed.size ||
    createHash("sha256").update(bytes).digest("hex") !== digestHex
  ) {
    throw new Error("BUNDLED_AGENT_OCI_BLOB_INTEGRITY_INVALID");
  }
  return { descriptor: parsed, json: parseJson(bytes, code) };
}

function decodeTemplate(value: unknown): JsonRecord {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > Math.ceil((MAX_RELEASE_TEMPLATE_BYTES * 4) / 3) + 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error("BUNDLED_AGENT_RELEASE_TEMPLATE_MISSING");
  }
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_RELEASE_TEMPLATE_BYTES ||
    bytes.toString("base64") !== value
  ) {
    throw new Error("BUNDLED_AGENT_RELEASE_TEMPLATE_INVALID");
  }
  return parseJson(bytes, "BUNDLED_AGENT_RELEASE_TEMPLATE_INVALID");
}

export async function readEmbeddedAgentRelease(
  layoutPath: string,
): Promise<EmbeddedAgentRelease> {
  const index = parseJson(
    await readBounded(path.join(layoutPath, "index.json"), MAX_INDEX_BYTES),
    "BUNDLED_AGENT_OCI_INDEX_INVALID",
  );
  const manifests = index.manifests;
  if (!Array.isArray(manifests) || manifests.length !== 1) {
    throw new Error("BUNDLED_AGENT_OCI_INDEX_INVALID");
  }
  const manifest = await readDescriptorBlob(
    layoutPath,
    manifests[0],
    MAX_MANIFEST_BYTES,
    "BUNDLED_AGENT_OCI_MANIFEST_INVALID",
  );
  const imageReference =
    manifest.descriptor.annotations["io.containerd.image.name"];
  if (typeof imageReference !== "string" || imageReference.length === 0) {
    throw new Error("BUNDLED_AGENT_IMAGE_REFERENCE_MISSING");
  }

  const config = await readDescriptorBlob(
    layoutPath,
    manifest.json.config,
    MAX_CONFIG_BYTES,
    "BUNDLED_AGENT_OCI_CONFIG_INVALID",
  );
  const configBody = asRecord(
    config.json.config,
    "BUNDLED_AGENT_OCI_CONFIG_INVALID",
  );
  const labels = asRecord(
    configBody.Labels,
    "BUNDLED_AGENT_OCI_CONFIG_INVALID",
  );
  const template = decodeTemplate(labels[RELEASE_TEMPLATE_LABEL]);
  const releaseVersion = template.releaseVersion;
  const image = asRecord(
    template.image,
    "BUNDLED_AGENT_RELEASE_TEMPLATE_INVALID",
  );
  if (
    typeof releaseVersion !== "string" ||
    labels[VERSION_LABEL] !== releaseVersion ||
    image.reference !== imageReference
  ) {
    throw new Error("BUNDLED_AGENT_RELEASE_METADATA_MISMATCH");
  }
  image.digest = manifest.descriptor.digest;
  return {
    imageReference,
    platformManifestDigest: manifest.descriptor.digest,
    template,
  };
}
