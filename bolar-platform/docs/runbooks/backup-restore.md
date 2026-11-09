# Runbook: backup and restore

## Backups
- Managed PostgreSQL automated snapshots daily, 14-day retention.
- Weekly logical dump: `pg_dump --format=custom "$DATABASE_URL" > bolar-$(date +%F).dump` uploaded to the storage
  bucket under `backups/` with server-side encryption. Object storage bucket has versioning enabled.
- Redis holds only queues; no backup needed (jobs are idempotent and re-enqueued from source records).

## Restore drill (required before go-live, repeat quarterly)
1. Create a scratch database: `createdb bolar_restore_test`.
2. `pg_restore --no-owner --dbname "$SCRATCH_URL" bolar-<date>.dump`.
3. Point a local API at the scratch DB and run `pnpm --filter @bolar/db migrate:status` (must be clean) and
   `pnpm --filter @bolar/api test tenant-isolation`.
4. Log the duration and any gaps in the release issue; drop the scratch database.

## Object storage
Documents and media live under `org/<tenantOrgId>/...`. Restore by copying the versioned objects back; document
and media rows reference keys, not URLs, so restores do not require database changes.
