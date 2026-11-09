#!/usr/bin/env bash
# One-shot local bootstrap (blueprint p6). Usage: scripts/dev-bootstrap.sh [database_name]
# Creates .env (if missing), installs deps, builds shared packages, creates/migrates the database, seeds demo data.
set -euo pipefail
cd "$(dirname "$0")/.."
DB_NAME="${1:-bolar}"
PG_URL_BASE="${PG_URL_BASE:-postgresql://bolar:local_only@localhost:5432}"
if [ ! -f .env ]; then cp .env.example .env; fi
sed -i.bak "s#^DATABASE_URL=.*#DATABASE_URL=${PG_URL_BASE}/${DB_NAME}?schema=public#" .env && rm -f .env.bak
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile
pnpm --filter @bolar/shared --filter @bolar/contracts --filter @bolar/db --filter @bolar/integrations --filter @bolar/testing build
# create database if missing (works for docker compose postgres and local postgres)
if command -v psql >/dev/null; then
  psql "${PG_URL_BASE}/postgres" -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || psql "${PG_URL_BASE}/postgres" -c "CREATE DATABASE \"${DB_NAME}\""
fi
pnpm db:migrate
pnpm db:seed
pnpm db:seed:demo
pnpm env:check
echo "bootstrap complete: DATABASE_URL -> ${PG_URL_BASE}/${DB_NAME}"
