FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS builder

WORKDIR /app

COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
COPY examples ./examples

RUN bun install --frozen-lockfile \
  --filter @curve-ai/radius-platform-web

ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run --cwd apps/platform-web build

FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d

WORKDIR /app
LABEL org.opencontainers.image.title="Radius Platform Web" \
  org.opencontainers.image.source="https://github.com/curve-ai/radius" \
  org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  PORT=3200

RUN groupadd --system --gid 1001 radius \
  && useradd --system --uid 1001 --gid radius radius

COPY --from=builder --chown=radius:radius /app/apps/platform-web/.next/standalone ./
COPY --from=builder --chown=radius:radius /app/apps/platform-web/.next/static ./apps/platform-web/.next/static

USER radius
EXPOSE 3200
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3200/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/platform-web/server.js"]
