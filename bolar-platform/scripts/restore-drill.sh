#!/usr/bin/env bash
# Backup restore drill (blueprint p298 "backup restore proof"; docs/runbooks/restore-drill.md).
#
# Proves that a logical backup of the database named by DATABASE_URL can be restored into a fresh database and that
# the restored copy is usable: the Prisma migration history is complete and the tenant-isolation suite passes against
# it. Nothing in the source database is modified.
#
#   scripts/restore-drill.sh [--keep] [--skip-tests]
#     --keep        leave the scratch database in place for inspection (printed at the end)
#     --skip-tests  stop after the row-count comparison and `prisma migrate status`
#
# Environment: DATABASE_URL (or bolar-platform/.env), psql/pg_dump/pg_restore 16 on PATH, workspace packages built
# (`scripts/dev-bootstrap.sh` does this). SCRATCH_DB overrides the generated scratch database name.
#
# Warning: the tenant-isolation suite truncates every table in the database it runs against. This script only ever
# points it at the scratch copy; never run it against the restore target of a real incident.
set -euo pipefail
cd "$(dirname "$0")/.."

KEEP=0
SKIP_TESTS=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "[restore-drill] unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2-)"
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[restore-drill] DATABASE_URL is not set and .env has no DATABASE_URL" >&2
  exit 2
fi

redact() { sed -E 's#://([^:/@]+):[^@]*@#://\1:***@#'; }

SRC_URL="${DATABASE_URL%%\?*}"           # drop ?schema=public and friends
BASE_URL="${SRC_URL%/*}"                 # postgresql://user[:pass]@host:port
SRC_DB="${SRC_URL##*/}"
STAMP="$(date -u +%Y%m%d%H%M%S)"
SCRATCH_DB="${SCRATCH_DB:-bolar_restore_${STAMP}}"
SCRATCH_URL="${BASE_URL}/${SCRATCH_DB}"
WORK="$(mktemp -d)"
DUMP="${WORK}/${SRC_DB}-${STAMP}.dump"
T0=$(date +%s)

cleanup() {
  local code=$?
  if [ "$KEEP" -eq 1 ]; then
    echo "[restore-drill] keeping scratch database ${SCRATCH_DB} (drop it with: dropdb ${SCRATCH_DB})"
  else
    psql "${BASE_URL}/postgres" -qAtc "DROP DATABASE IF EXISTS \"${SCRATCH_DB}\" WITH (FORCE)" >/dev/null 2>&1 || true
    echo "[restore-drill] scratch database ${SCRATCH_DB} dropped"
  fi
  rm -rf "$WORK"
  echo "[restore-drill] total duration $(( $(date +%s) - T0 ))s, exit ${code}"
}
trap cleanup EXIT

# Row counts for every table in public, one "table=count" line each. Used to compare source and restored copy.
ROWCOUNT_SQL="SELECT table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"

timed() { # timed <label> <command...>; prints the phase duration and propagates the exit code
  local label=$1; shift
  local start; start=$(date +%s)
  echo "[restore-drill] ${label}: start"
  "$@"
  local code=$?
  echo "[restore-drill] ${label}: done in $(( $(date +%s) - start ))s"
  return $code
}

echo "[restore-drill] source   $(echo "$SRC_URL" | redact)"
echo "[restore-drill] scratch  $(echo "$SCRATCH_URL" | redact)"
echo "[restore-drill] server   $(psql "${BASE_URL}/postgres" -qAtc 'show server_version')"

psql "$SRC_URL" -qAtc "$ROWCOUNT_SQL" > "${WORK}/source.counts"
SRC_TABLES=$(wc -l < "${WORK}/source.counts")
SRC_ROWS=$(awk -F= '{ s += $2 } END { print s + 0 }' "${WORK}/source.counts")
echo "[restore-drill] source has ${SRC_TABLES} tables and ${SRC_ROWS} rows"

timed "pg_dump (custom format)" pg_dump --format=custom --no-owner --no-privileges --file "$DUMP" "$SRC_URL"
echo "[restore-drill] dump size $(du -h "$DUMP" | cut -f1)"

timed "create scratch database" psql "${BASE_URL}/postgres" -v ON_ERROR_STOP=1 -qAtc "CREATE DATABASE \"${SCRATCH_DB}\""
timed "pg_restore into scratch" pg_restore --no-owner --no-privileges --exit-on-error --dbname "$SCRATCH_URL" "$DUMP"

psql "$SCRATCH_URL" -qAtc "$ROWCOUNT_SQL" > "${WORK}/scratch.counts"
if diff -u "${WORK}/source.counts" "${WORK}/scratch.counts" > "${WORK}/counts.diff"; then
  echo "[restore-drill] row counts match on all ${SRC_TABLES} tables (${SRC_ROWS} rows)"
else
  echo "[restore-drill] row counts differ between source and restored copy:" >&2
  cat "${WORK}/counts.diff" >&2
  exit 1
fi

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# dotenv-cli and the test setup never override a DATABASE_URL that is already in the environment, so exporting the
# scratch URL here is enough to point Prisma and vitest at the restored copy.
export DATABASE_URL="${SCRATCH_URL}?schema=public"
timed "prisma migrate status (scratch)" pnpm --filter @bolar/db migrate:status

if [ "$SKIP_TESTS" -eq 1 ]; then
  echo "[restore-drill] --skip-tests: tenant-isolation suite not run"
else
  timed "tenant-isolation suite (scratch)" pnpm --filter @bolar/api exec vitest run src/__tests__/tenant-isolation.test.ts
fi

echo "[restore-drill] OK source=${SRC_DB} scratch=${SCRATCH_DB} tables=${SRC_TABLES} rows=${SRC_ROWS} dump=$(du -h "$DUMP" | cut -f1)"
