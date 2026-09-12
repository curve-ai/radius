import { fileURLToPath } from "node:url";
import { join, resolve, sep } from "node:path";
import { Hono } from "hono";

export function createAuthUi(options: {
  directory?: string;
  googleEnabled: boolean;
}) {
  const root = resolve(
    options.directory ??
      fileURLToPath(new URL("../dist/auth-ui", import.meta.url)),
  );
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    await next();
  });
  app.get("/auth-ui/config", (c) =>
    c.json({ googleEnabled: options.googleEnabled }),
  );
  app.get("/auth-ui/assets/:file", async (c) => {
    const path = resolve(join(root, "assets", c.req.param("file")));
    if (!path.startsWith(`${root}${sep}assets${sep}`)) return c.notFound();
    const file = Bun.file(path);
    if (!(await file.exists())) return c.notFound();
    return c.body(await file.arrayBuffer(), 200, { "Content-Type": file.type });
  });
  const page = async () => {
    const file = Bun.file(join(root, "index.html"));
    if (!(await file.exists()))
      return new Response(
        "Sign-in assets are missing. Run bun run --cwd apps/platform-api build:auth-ui.",
        { status: 503 },
      );
    return new Response(file, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };
  app.get("/sign-in", page);
  app.get("/consent", page);
  return app;
}
