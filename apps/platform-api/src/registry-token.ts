import type {
  RegistryTokenAccess,
  RegistryTokenSigner,
} from "@curve-ai/platform-providers";
import { Hono, type Context } from "hono";

export interface RegistryUploadRecord {
  state: string;
  expiresAt: Date;
  imageReference: string;
}

const UPLOAD_USERNAME =
  /^upload-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const ACTIVE_UPLOAD_STATES = new Set(["prepared", "finalized"]);

/**
 * Docker Registry token endpoint: swaps an upload's username and password for
 * a short-lived token for that upload's repository.
 */
export function createRegistryTokenRoutes(options: {
  signer: RegistryTokenSigner;
  /** The registry's `REGISTRY_AUTH_TOKEN_SERVICE`, its public name. */
  service: string;
  findUpload(uploadId: string): Promise<RegistryUploadRecord | null>;
  now?: () => Date;
}): Hono {
  const now = options.now ?? (() => new Date());
  const app = new Hono();

  app.get("/token", async (context) => {
    const service = context.req.query("service");
    if (service !== options.service) {
      return context.json(
        {
          errors: [
            { code: "SERVICE_UNKNOWN", message: "Unknown registry service" },
          ],
        },
        400,
      );
    }
    const credentials = readBasicCredentials(
      context.req.header("authorization"),
    );
    const uploadId = credentials?.username.match(UPLOAD_USERNAME)?.[1];
    if (!credentials || !uploadId) return unauthorized(context);

    const passwordMatches = options.signer.matchesUploadPassword(
      uploadId,
      credentials.password,
    );
    const upload = await options.findUpload(uploadId);
    const issuedAt = now();
    // A finalized upload keeps working until it expires, so re-running the
    // same push (which replays the same upload) still succeeds.
    if (
      !passwordMatches ||
      !upload ||
      !ACTIVE_UPLOAD_STATES.has(upload.state) ||
      upload.expiresAt.getTime() <= issuedAt.getTime()
    ) {
      return unauthorized(context);
    }

    const repository = repositoryOf(upload.imageReference);
    const signed = options.signer.sign({
      subject: credentials.username,
      audience: service,
      access: grantedAccess(requestedScopes(context), repository),
      notAfter: upload.expiresAt,
      now: issuedAt,
    });
    context.header("cache-control", "no-store");
    // No refresh_token: Docker would then switch to the OAuth flow.
    return context.json({
      token: signed.token,
      access_token: signed.token,
      expires_in: signed.expiresIn,
      issued_at: signed.issuedAt,
    });
  });

  return app;
}

function requestedScopes(context: Context): string[] {
  return (context.req.queries("scope") ?? []).flatMap((value) =>
    value.split(" ").filter(Boolean),
  );
}

// Only push and pull on the upload's own repository survive; anything else
// is dropped, and the registry then denies it.
function grantedAccess(
  scopes: string[],
  repository: string,
): RegistryTokenAccess[] {
  const wanted = new Set(
    scopes.flatMap((scope) => {
      const [type, name, actions, ...rest] = scope.split(":");
      return type === "repository" && name === repository && rest.length === 0
        ? (actions ?? "").split(",")
        : [];
    }),
  );
  const actions = ["push", "pull"].filter((action) => wanted.has(action));
  return actions.length
    ? [{ type: "repository", name: repository, actions }]
    : [];
}

/** `registry.example.com/agent_x/agent:tag` → `agent_x/agent`. */
export function repositoryOf(imageReference: string): string {
  const path = imageReference.slice(imageReference.indexOf("/") + 1);
  const tag = path.lastIndexOf(":");
  return tag > path.lastIndexOf("/") ? path.slice(0, tag) : path;
}

function readBasicCredentials(
  authorization: string | undefined,
): { username: string; password: string } | null {
  const encoded = authorization?.match(/^Basic ([A-Za-z0-9+/=]+)$/)?.[1];
  if (!encoded) return null;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return null;
  return {
    username: decoded.slice(0, colon),
    password: decoded.slice(colon + 1),
  };
}

function unauthorized(context: Context) {
  context.header("www-authenticate", 'Basic realm="Radius registry"');
  return context.json(
    {
      errors: [
        {
          code: "UNAUTHORIZED",
          message: "Upload credentials are invalid or expired",
        },
      ],
    },
    401,
  );
}
