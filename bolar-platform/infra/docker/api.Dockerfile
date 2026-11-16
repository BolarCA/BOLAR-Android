# BOLAR API image (Express modular monolith). Build context: bolar-platform/
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache openssl
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/api/package.json packages/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/contracts/package.json packages/contracts/
COPY packages/integrations/package.json packages/integrations/
COPY packages/workers/package.json packages/workers/
COPY packages/testing/package.json packages/testing/
RUN pnpm install --frozen-lockfile --filter @bolar/api... --filter @bolar/workers...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
RUN pnpm --filter @bolar/shared --filter @bolar/contracts --filter @bolar/db --filter @bolar/integrations --filter @bolar/testing --filter @bolar/api --filter @bolar/workers build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "packages/api/dist/server.js"]
