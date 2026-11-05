# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage: install all workspace dependencies and compile shared/server/web.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm build

# ---------------------------------------------------------------------------
# Production dependency stage (no dev dependencies).
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS prod-deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
# Runtime stage: only compiled artifacts and production dependencies.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    SUBWATCH_WEB_DIR=/app/web \
    TZ=Asia/Shanghai \
    PORT=8080 \
    HOST=0.0.0.0

# pnpm's isolated linker keeps runtime deps in each workspace package's
# node_modules plus the shared .pnpm store at the root. Copy all three.
COPY --chmod=755 --from=prod-deps /app/node_modules ./node_modules
COPY --chmod=755 --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --chmod=755 --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --chmod=644 --from=prod-deps /app/packages/shared/package.json ./packages/shared/package.json
COPY --chmod=755 --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --chmod=755 --from=build /app/apps/server/dist ./apps/server/dist
COPY --chmod=755 --from=build /app/apps/web/dist ./web
COPY --chmod=644 package.json ./

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
