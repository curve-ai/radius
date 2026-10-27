/** UI guidance only; the provider still verifies the signature and expiry. */
export function authorizationLinkExpired(
  search: string,
  now = Date.now(),
): boolean {
  const params = new URLSearchParams(search);
  if (!params.has("client_id")) return false;
  const expiration = Number(params.get("exp"));
  return !Number.isFinite(expiration) || expiration * 1000 <= now;
}
