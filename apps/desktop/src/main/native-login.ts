import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  NativeAuthorizationRequest,
  NativeOAuthConfiguration,
} from "@curve-ai/platform-contracts";

export const NATIVE_LOGIN_TIMEOUT_MS = 15 * 60_000;

/** The provider consumes the authorization code; this listener only captures it. */
export async function nativeBrowserLogin(
  config: NativeOAuthConfiguration & { authorizationEndpoint: string },
  openBrowser: (url: string) => Promise<void>,
  signal: AbortSignal,
  options: { timeoutMs?: number } = {},
): Promise<NativeAuthorizationRequest> {
  const callback = new URL(config.redirectUri);
  if (
    callback.protocol !== "http:" ||
    callback.hostname !== "127.0.0.1" ||
    callback.pathname !== "/callback" ||
    !callback.port ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password
  )
    throw new Error("AUTH_CONFIGURATION_INVALID");
  const endpoint = new URL(config.authorizationEndpoint);
  const localIssuer = new URL(config.issuer).protocol === "http:";
  if (
    endpoint.protocol !== "https:" &&
    !(
      localIssuer &&
      endpoint.protocol === "http:" &&
      (["localhost", "127.0.0.1"].includes(endpoint.hostname) ||
        endpoint.hostname.endsWith(".localhost"))
    )
  )
    throw new Error("AUTH_CONFIGURATION_INVALID");
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  endpoint.searchParams.set("response_type", "code");
  endpoint.searchParams.set("client_id", config.clientId);
  endpoint.searchParams.set("redirect_uri", callback.href);
  endpoint.searchParams.set("scope", config.scopes.join(" "));
  endpoint.searchParams.set("resource", config.resource);
  endpoint.searchParams.set("state", state);
  endpoint.searchParams.set("nonce", nonce);
  endpoint.searchParams.set(
    "code_challenge",
    createHash("sha256").update(codeVerifier).digest("base64url"),
  );
  endpoint.searchParams.set("code_challenge_method", "S256");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      error?: Error,
      result?: NativeAuthorizationRequest,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      server.close();
      server.closeAllConnections();
      if (error) reject(error);
      else resolve(result!);
    };
    const server = createServer((request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'",
      );
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      let url: URL;
      try {
        if ((request.url?.length ?? 0) > 8192) throw new Error();
        url = new URL(request.url ?? "/", callback.origin);
      } catch {
        response.writeHead(400).end("Invalid callback.");
        return;
      }
      if (
        request.method !== "GET" ||
        request.headers.host !== callback.host ||
        url.origin !== callback.origin ||
        url.pathname !== callback.pathname ||
        url.searchParams.getAll("state").length !== 1 ||
        url.searchParams.get("state") !== state
      ) {
        response
          .writeHead(400)
          .end(
            "This sign-in request does not match. Return to your application.",
          );
        return;
      }
      if (url.searchParams.has("error")) {
        response.end("Sign-in was cancelled. Return to your application.", () =>
          finish(new Error("AUTH_CANCELLED")),
        );
        return;
      }
      if (
        url.searchParams.getAll("code").length !== 1 ||
        !url.searchParams.get("code")
      ) {
        response.writeHead(400).end("Missing authorization code.");
        return;
      }
      response.end(
        "You can return to your application to finish signing in.",
        () =>
          finish(undefined, {
            callbackUrl: url.href,
            codeVerifier,
            state,
            nonce,
          }),
      );
    });
    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    const abort = (): void => finish(new Error("AUTH_CANCELLED"));
    const timeout = setTimeout(
      () => finish(new Error("AUTH_TIMEOUT")),
      options.timeoutMs ?? NATIVE_LOGIN_TIMEOUT_MS,
    );
    signal.addEventListener("abort", abort, { once: true });
    server.on("error", () => finish(new Error("AUTH_CALLBACK_UNAVAILABLE")));
    if (signal.aborted) {
      abort();
      return;
    }
    server.listen(Number(callback.port), "127.0.0.1", () => {
      if ((server.address() as AddressInfo).port !== Number(callback.port)) {
        finish(new Error("AUTH_CALLBACK_UNAVAILABLE"));
        return;
      }
      void openBrowser(endpoint.href).catch(() =>
        finish(new Error("AUTH_BROWSER_UNAVAILABLE")),
      );
    });
  });
}
