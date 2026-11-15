import {
  createHmac,
  createPrivateKey,
  hkdfSync,
  randomUUID,
  sign,
  timingSafeEqual,
  X509Certificate,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";

/** The `iss` every Radius registry token carries; the registry's `REGISTRY_AUTH_TOKEN_ISSUER`. */
export const REGISTRY_TOKEN_ISSUER = "radius-platform";

const TOKEN_LIFETIME_SECONDS = 5 * 60;
const UPLOAD_PASSWORD_LABEL = "radius-registry-upload-password";

export interface RegistryTokenAccess {
  type: "repository";
  name: string;
  actions: string[];
}

export interface SignedRegistryToken {
  token: string;
  expiresIn: number;
  issuedAt: string;
}

export interface RegistryTokenSigner {
  /**
   * Signs a Docker Registry token (ES256 JWT with an `x5c` header). It lasts
   * five minutes, or until `notAfter` if that is sooner.
   */
  sign(input: {
    subject: string;
    audience: string;
    access: RegistryTokenAccess[];
    notAfter?: Date;
    now?: Date;
  }): SignedRegistryToken;
  /** The password for one upload, derived from the first signing key. */
  uploadPassword(uploadId: string): string;
  /** Whether a password matches an upload under any key in the key file. */
  matchesUploadPassword(uploadId: string, password: string): boolean;
}

/**
 * Signs with the first key and certificate and accepts upload passwords from
 * any key, so a key can be rotated.
 */
export function createRegistryTokenSigner(options: {
  keyPem: string;
  certificatePem: string;
}): RegistryTokenSigner {
  const keys = pemBlocks(options.keyPem, "PRIVATE KEY").map((block) =>
    createPrivateKey(block),
  );
  const certificates = pemBlocks(options.certificatePem, "CERTIFICATE").map(
    (block) => new X509Certificate(block),
  );
  const signingKey = keys[0];
  const certificate = certificates[0];
  if (!signingKey || !certificate) {
    throw new Error(
      "Registry token key and certificate files must each contain at least one PEM entry",
    );
  }
  for (const key of keys) {
    if (key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      throw new Error("Registry token keys must be EC P-256 keys");
    }
  }
  if (!certificate.checkPrivateKey(signingKey)) {
    throw new Error(
      "The first registry token certificate does not match the first key",
    );
  }
  const x5c = certificate.raw.toString("base64");
  const uploadKeys = keys.map(uploadPasswordKey);

  return {
    sign({ subject, audience, access, notAfter, now = new Date() }) {
      const issuedAt = Math.floor(now.getTime() / 1000);
      const expiresAt = Math.min(
        issuedAt + TOKEN_LIFETIME_SECONDS,
        notAfter
          ? Math.floor(notAfter.getTime() / 1000)
          : Number.POSITIVE_INFINITY,
      );
      const header = { typ: "JWT", alg: "ES256", x5c: [x5c] };
      const claims = {
        iss: REGISTRY_TOKEN_ISSUER,
        sub: subject,
        aud: audience,
        iat: issuedAt,
        nbf: issuedAt,
        exp: expiresAt,
        jti: randomUUID(),
        access,
      };
      const unsigned = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
      const signature = sign("sha256", Buffer.from(unsigned), {
        key: signingKey,
        dsaEncoding: "ieee-p1363",
      });
      return {
        token: `${unsigned}.${signature.toString("base64url")}`,
        expiresIn: Math.max(0, expiresAt - issuedAt),
        issuedAt: new Date(issuedAt * 1000).toISOString(),
      };
    },
    uploadPassword(uploadId) {
      return uploadPassword(uploadKeys[0]!, uploadId);
    },
    matchesUploadPassword(uploadId, password) {
      const candidate = Buffer.from(password);
      let matched = false;
      for (const key of uploadKeys) {
        const expected = Buffer.from(uploadPassword(key, uploadId));
        // Every key is checked, so the time taken does not reveal which matched.
        if (
          candidate.length === expected.length &&
          timingSafeEqual(candidate, expected)
        ) {
          matched = true;
        }
      }
      return matched;
    },
  };
}

/** A `Bearer` header that may only pull from one repository. */
export function registryPullAuthorization(
  signer: RegistryTokenSigner,
  subject: string,
  registry: string,
  repository: string,
): string {
  const access = [
    { type: "repository" as const, name: repository, actions: ["pull"] },
  ];
  return `Bearer ${signer.sign({ subject, audience: registry, access }).token}`;
}

/** Reads the key and certificate paths; undefined when neither is set (dev). */
export function registryTokenSignerFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): RegistryTokenSigner | undefined {
  const keyPath = environment.RADIUS_REGISTRY_TOKEN_KEY?.trim();
  const certificatePath = environment.RADIUS_REGISTRY_TOKEN_CERT?.trim();
  if (!keyPath && !certificatePath) return undefined;
  if (!keyPath || !certificatePath) {
    throw new Error(
      "RADIUS_REGISTRY_TOKEN_KEY and RADIUS_REGISTRY_TOKEN_CERT must be configured together",
    );
  }
  return createRegistryTokenSigner({
    keyPem: readFileSync(keyPath, "utf8"),
    certificatePem: readFileSync(certificatePath, "utf8"),
  });
}

function pemBlocks(text: string, label: string): string[] {
  const pattern = /-----BEGIN ([A-Z ]+)-----[\s\S]+?-----END \1-----/g;
  return [...text.matchAll(pattern)]
    .filter((match) => match[1]!.endsWith(label))
    .map((match) => match[0]);
}

// Derived from the key's private value rather than the file's bytes, so the
// same key saved in another PEM layout gives the same passwords.
function uploadPasswordKey(key: KeyObject): Buffer {
  const privateValue = key.export({ format: "jwk" }).d;
  if (!privateValue) throw new Error("Registry token key has no private value");
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(privateValue, "base64url"),
      Buffer.alloc(0),
      UPLOAD_PASSWORD_LABEL,
      32,
    ),
  );
}

function uploadPassword(key: Buffer, uploadId: string): string {
  return createHmac("sha256", key).update(uploadId).digest("base64url");
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
