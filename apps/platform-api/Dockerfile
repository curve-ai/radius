FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS builder

WORKDIR /app

COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
COPY examples ./examples

RUN bun install --frozen-lockfile \
  --filter @curve-ai/radius-platform-api \
  && bun build apps/platform-api/src/server.ts \
  --target=bun \
  --format=esm \
  --minify \
  --outfile=/out/platform-api.js \
  && bun build apps/platform-api/src/admin.ts \
  --target=bun \
  --format=esm \
  --minify \
  --outfile=/out/platform-admin.js

FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4

WORKDIR /app
LABEL org.opencontainers.image.title="Radius Platform API" \
  org.opencontainers.image.source="https://github.com/curve-ai/radius" \
  org.opencontainers.image.licenses="MIT"
COPY --from=builder --chown=bun:bun /out/platform-api.js ./platform-api.js
COPY --from=builder --chown=bun:bun /out/platform-admin.js ./platform-admin.js
COPY --from=builder --chown=bun:bun /app/packages/platform-database/drizzle ./drizzle

ENV NODE_ENV=production \
  PORT=3100 \
  RADIUS_PLATFORM_MIGRATIONS_DIR=/app/drizzle
USER bun
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=5 \
  CMD bun -e "fetch('http://127.0.0.1:3100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "platform-api.js"]
