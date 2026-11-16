# BOLAR web image (Next.js standalone). Build context: bolar-platform/
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/contracts/package.json packages/contracts/
COPY packages/api/package.json packages/api/
COPY packages/db/package.json packages/db/
COPY packages/integrations/package.json packages/integrations/
COPY packages/workers/package.json packages/workers/
COPY packages/testing/package.json packages/testing/
RUN pnpm install --frozen-lockfile --filter @bolar/web...

FROM deps AS build
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/contracts ./packages/contracts
COPY apps/web ./apps/web
RUN pnpm --filter @bolar/shared --filter @bolar/contracts build && pnpm --filter @bolar/web build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
