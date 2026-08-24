import {
  createHash,
  createPrivateKey,
  sign,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";

import {
  ProviderCapabilitiesSchema,
  PullResponseSchema,
  PushResponseSchema,
  type ProviderCapabilities,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from "@curve-ai/radius-sync-protocol";

import type { SyncProvider } from "./provider.js";

export interface HttpProviderIdentity {
  clientInstanceId: string;
  displayName: string;
  platform: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  appVersion: string;
}

export interface HttpSyncProviderOptions {
  endpoint: string;
  identity: HttpProviderIdentity;
  getAccessToken(): Promise<string>;
  fetch?: typeof globalThis.fetch;
}

export class HttpSyncProvider implements SyncProvider {
  readonly #endpoint: URL;
  readonly #fetch: typeof globalThis.fetch;
  readonly #identity: HttpProviderIdentity;
  readonly #getAccessToken: () => Promise<string>;
  readonly #privateKey: KeyObject;

  constructor(options: HttpSyncProviderOptions) {
    this.#endpoint = new URL(
      options.endpoint.endsWith("/")
        ? options.endpoint
        : `${options.endpoint}/`,
    );
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#identity = options.identity;
    this.#getAccessToken = options.getAccessToken;
    this.#privateKey = createPrivateKey({
      key: options.identity.privateKeyJwk,
      format: "jwk",
    });
  }

  async registerDevice(): Promise<void> {
    const response = await this.#fetch(
      new URL("devices/register", this.#endpoint),
      {
        method: "POST",
        headers: await this.#headers(),
        body: JSON.stringify({
          clientInstanceId: this.#identity.clientInstanceId,
          displayName: this.#identity.displayName,
          platform: this.#identity.platform,
          publicKeyJwk: this.#identity.publicKeyJwk,
          appVersion: this.#identity.appVersion,
        }),
      },
    );
    if (!response.ok)
      throw new Error(`SYNC_DEVICE_REGISTRATION_${response.status}`);
  }

  async capabilities(): Promise<ProviderCapabilities> {
    const response = await this.#fetch(new URL("capabilities", this.#endpoint));
    if (!response.ok) throw new Error(`SYNC_CAPABILITIES_${response.status}`);
    return ProviderCapabilitiesSchema.parse(await response.json());
  }

  async push(request: PushRequest): Promise<PushResponse> {
    const url = new URL("push", this.#endpoint);
    const body = JSON.stringify(request);
    const response = await this.#fetch(url, {
      method: "POST",
      headers: await this.#signedHeaders("POST", url, body),
      body,
    });
    if (!response.ok) throw new Error(`SYNC_PUSH_${response.status}`);
    return PushResponseSchema.parse(await response.json());
  }

  async pull(cursor: string | null, limit = 100): Promise<PullResponse> {
    const url = new URL("pull", this.#endpoint);
    url.searchParams.set("limit", String(limit));
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await this.#fetch(url, {
      headers: await this.#signedHeaders("GET", url, ""),
    });
    if (!response.ok) throw new Error(`SYNC_PULL_${response.status}`);
    return PullResponseSchema.parse(await response.json());
  }

  async hasArtifact(contentSha256: string): Promise<boolean> {
    const url = new URL(`artifacts/${contentSha256}`, this.#endpoint);
    const response = await this.#fetch(url, {
      method: "HEAD",
      headers: await this.#signedHeaders("HEAD", url, ""),
    });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`SYNC_ARTIFACT_HEAD_${response.status}`);
    return true;
  }

  async uploadArtifact(input: {
    contentSha256: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<{ remoteLocator: string }> {
    const url = new URL(`artifacts/${input.contentSha256}`, this.#endpoint);
    const body = Buffer.from(
      input.bytes.buffer,
      input.bytes.byteOffset,
      input.bytes.byteLength,
    );
    const response = await this.#fetch(url, {
      method: "PUT",
      headers: {
        ...(await this.#signedHeaders("PUT", url, body)),
        "content-type": input.mimeType,
      },
      // Node's fetch accepts Buffer, while the renderer DOM types omit it.
      body: body as unknown as BodyInit,
    });
    if (!response.ok)
      throw new Error(`SYNC_ARTIFACT_UPLOAD_${response.status}`);
    const value = (await response.json()) as { remoteLocator?: unknown };
    if (
      typeof value.remoteLocator !== "string" ||
      value.remoteLocator.length === 0
    ) {
      throw new Error("SYNC_ARTIFACT_UPLOAD_RESPONSE_INVALID");
    }
    return { remoteLocator: value.remoteLocator };
  }

  async #headers(): Promise<Record<string, string>> {
    return {
      authorization: `Bearer ${await this.#getAccessToken()}`,
      "content-type": "application/json",
    };
  }

  async #signedHeaders(
    method: string,
    url: URL,
    body: string | Uint8Array | ArrayBuffer,
  ): Promise<Record<string, string>> {
    const timestamp = new Date().toISOString();
    const hashInput =
      typeof body === "string"
        ? body
        : body instanceof ArrayBuffer
          ? new Uint8Array(body)
          : body;
    const bodyHash = createHash("sha256").update(hashInput).digest("hex");
    const input = `${method}\n${url.pathname}${url.search}\n${timestamp}\n${bodyHash}`;
    const signature = sign(null, Buffer.from(input), this.#privateKey).toString(
      "base64url",
    );
    return {
      ...(await this.#headers()),
      "x-radius-client-instance-id": this.#identity.clientInstanceId,
      "x-radius-timestamp": timestamp,
      "x-radius-signature": signature,
    };
  }
}
