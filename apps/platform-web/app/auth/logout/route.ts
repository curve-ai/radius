import { platformApiUrl } from "@/lib/platform-server";
import { PLATFORM_ORGANIZATION_COOKIE } from "@/lib/platform-auth";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !sameRequestOrigin(origin, request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  await fetch(new URL("/api/platform/v1/auth/logout", platformApiUrl()), {
    method: "POST",
    headers: { cookie: request.headers.get("cookie") ?? "" },
    cache: "no-store",
  });
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set(
    process.env.RADIUS_PLATFORM_SESSION_COOKIE?.trim() ||
      "radius_platform_session",
    "",
    {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: 0,
    },
  );
  response.cookies.set(PLATFORM_ORGANIZATION_COOKIE, "", {
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 0,
  });
  return response;
}

function sameRequestOrigin(origin: string, request: Request): boolean {
  const candidate = new URL(origin);
  const requestUrl = new URL(request.url);
  const forwardedHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (
    candidate.protocol === requestUrl.protocol &&
    (candidate.host === requestUrl.host || candidate.host === forwardedHost)
  ) {
    return true;
  }
  const loopback = (hostname: string) =>
    ["localhost", "127.0.0.1", "::1"].includes(hostname);
  return (
    candidate.protocol === requestUrl.protocol &&
    candidate.port === requestUrl.port &&
    loopback(candidate.hostname) &&
    loopback(requestUrl.hostname)
  );
}
