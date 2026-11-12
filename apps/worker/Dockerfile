# ==============================================================================
# EventForge Background Worker — Production Multi-Stage Dockerfile
# ==============================================================================

# Stage 1: Base image with pnpm
FROM node:24-alpine AS base
ENV CI=true
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /app

# Stage 2: Install dependencies
FROM base AS dependencies
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY packages/common/package.json ./packages/common/
COPY packages/config/package.json ./packages/config/
COPY packages/database/package.json ./packages/database/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN pnpm install --frozen-lockfile

# Stage 3: Build application and packages
FROM dependencies AS builder
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY apps/worker/ ./apps/worker/
COPY turbo.json tsconfig*.json ./
# Only the worker and its workspace dependencies; the dashboard bundle is not part of this image.
RUN pnpm turbo run build --filter=@eventforge/worker...
# Keep only production dependencies. (`pnpm prune --prod` empties node_modules entirely in this
# workspace, so reinstall with --prod instead; the layout stays identical.)
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules \
    && pnpm install --frozen-lockfile --prod

# Stage 4: Minimal production runtime
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV WORKER_PORT=3001
ENV WORKER_HOST=0.0.0.0

# Copy root workspace files and pruned production node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

# Copy built workspace packages. pnpm keeps each package's dependencies as symlinks in its own
# node_modules (pointing into the root .pnpm store), so those directories must be copied too.
COPY --from=builder --chown=node:node /app/packages/common/package.json ./packages/common/package.json
COPY --from=builder --chown=node:node /app/packages/common/dist ./packages/common/dist
COPY --from=builder --chown=node:node /app/packages/common/node_modules ./packages/common/node_modules
COPY --from=builder --chown=node:node /app/packages/config/package.json ./packages/config/package.json
COPY --from=builder --chown=node:node /app/packages/config/dist ./packages/config/dist
COPY --from=builder --chown=node:node /app/packages/config/node_modules ./packages/config/node_modules
COPY --from=builder --chown=node:node /app/packages/database/package.json ./packages/database/package.json
COPY --from=builder --chown=node:node /app/packages/database/dist ./packages/database/dist
COPY --from=builder --chown=node:node /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=builder --chown=node:node /app/packages/database/migrations ./packages/database/migrations
COPY --from=builder --chown=node:node /app/packages/sdk/package.json ./packages/sdk/package.json
COPY --from=builder --chown=node:node /app/packages/sdk/dist ./packages/sdk/dist

# Copy Worker app
COPY --from=builder --chown=node:node /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder --chown=node:node /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=node:node /app/apps/worker/node_modules ./apps/worker/node_modules

USER node

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.WORKER_PORT || 3001) + '/v1/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/worker/dist/main.js"]
