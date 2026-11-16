# BOLAR workers image reuses the API build stage. Build context: bolar-platform/
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache openssl
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NODE_ENV=production
COPY --from=bolar-api-build /app ./
USER node
CMD ["node", "packages/workers/dist/index.js"]
