FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS builder

WORKDIR /app

COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
COPY examples ./examples

RUN bun install --frozen-lockfile \
  --filter @curve-ai/radius-platform-jobs \
  && bun build apps/platform-jobs/src/server.ts \
  --target=bun \
  --format=esm \
  --minify \
  --outfile=/out/platform-jobs.js \
  && bun build apps/platform-jobs/scripts/health.ts \
  --target=bun \
  --format=esm \
  --minify \
  --outfile=/out/platform-jobs-health.js

FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d

WORKDIR /app
LABEL org.opencontainers.image.title="Radius Platform Jobs" \
  org.opencontainers.image.source="https://github.com/curve-ai/radius" \
  org.opencontainers.image.licenses="MIT"
COPY --from=builder --chown=bun:bun /out/platform-jobs.js ./platform-jobs.js
COPY --from=builder --chown=bun:bun /out/platform-jobs-health.js ./platform-jobs-health.js

ENV NODE_ENV=production
USER bun
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=5 \
  CMD bun platform-jobs-health.js
CMD ["bun", "platform-jobs.js"]
