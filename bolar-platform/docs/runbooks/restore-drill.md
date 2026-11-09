# Runbook: backup restore drill

Proves, with a script anyone on the team can run, that a logical backup of the platform database restores into a
fresh database and that the restored copy is usable. The launch gate requires one passing drill on staging before
go-live and [backup-restore.md](backup-restore.md) requires it quarterly after that. The script is
`scripts/restore-drill.sh`.

## What the script does

1. Reads `DATABASE_URL` from the environment or `bolar-platform/.env` (the password, if any, is masked in output).
2. Snapshots the row count of every table in `public` on the source.
3. `pg_dump --format=custom --no-owner --no-privileges` of the source into a temporary file.
4. Creates a scratch database `bolar_restore_<UTC timestamp>` on the same server (override with `SCRATCH_DB`).
5. `pg_restore --exit-on-error` into the scratch database.
6. Compares the row counts of every table between source and scratch; any difference fails the drill.
7. Points Prisma at the scratch copy and runs `prisma migrate status` (must report the schema is up to date, so the
   `_prisma_migrations` history travelled with the data).
8. Runs the API tenant-isolation suite against the scratch copy (`packages/api/src/__tests__/tenant-isolation.test.ts`).
   This suite truncates every table in the database it targets before seeding its two-org fixture, which is why the
   script only ever points it at the scratch copy. `--skip-tests` stops after step 7.
9. Drops the scratch database (`--keep` leaves it for inspection) and prints the duration of each phase.

Nothing writes to the source database. The script fails fast on any error and still drops the scratch database.

## Prerequisites

- `psql`, `pg_dump`, `pg_restore` 16 on `PATH`, matching the server major version.
- The role in `DATABASE_URL` may `CREATE DATABASE` on that server (the drill uses the same server as the source; for
  staging point `DATABASE_URL` at a replica or the staging instance outside business hours).
- Workspace packages built (`scripts/dev-bootstrap.sh <db>` does this) so Prisma and vitest can run.
- No other process writing to the source between the snapshot and the dump, or the row-count comparison fails on
  purpose (rerun when quiet).

## Run

```bash
cd bolar-platform
scripts/restore-drill.sh            # full drill
scripts/restore-drill.sh --keep     # keep the scratch database to point a local API at it
scripts/restore-drill.sh --skip-tests
```

Record the final `[restore-drill] OK ...` line, the phase durations and the dump size in the launch checklist row
"Backup restore proof" with the date and who ran it.

## Evidence: local drill on 2026-11-09

Database `bolar_agent4` (demo seed after a full smoke run), PostgreSQL 16.15, same host. Output verbatim:

```
[restore-drill] source   postgresql://bolar@localhost:5432/bolar_agent4
[restore-drill] scratch  postgresql://bolar@localhost:5432/bolar_restore_20261109080858
[restore-drill] server   16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
[restore-drill] source has 63 tables and 296 rows
[restore-drill] pg_dump (custom format): start
[restore-drill] pg_dump (custom format): done in 1s
[restore-drill] dump size 160K
[restore-drill] create scratch database: start
[restore-drill] create scratch database: done in 0s
[restore-drill] pg_restore into scratch: start
[restore-drill] pg_restore into scratch: done in 0s
[restore-drill] row counts match on all 63 tables (296 rows)
[restore-drill] prisma migrate status (scratch): start
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "bolar_restore_20261109080858", schema "public" at "localhost:5432"
3 migrations found in prisma/migrations
Database schema is up to date!
[restore-drill] prisma migrate status (scratch): done in 1s
[restore-drill] tenant-isolation suite (scratch): start
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  2.13s (transform 807ms, setup 37ms, import 1.34s, tests 659ms, environment 0ms)
[restore-drill] tenant-isolation suite (scratch): done in 3s
[restore-drill] OK source=bolar_agent4 scratch=bolar_restore_20261109080858 tables=63 rows=296 dump=160K
[restore-drill] scratch database bolar_restore_20261109080858 dropped
[restore-drill] total duration 5s, exit 0
```

Interpretation: dump 1 s, restore under 1 s, migration history intact (3 migrations), isolation suite 6 of 6 on the
restored copy, total 5 s for a 160 KB demo database. A pilot database with a few thousand leases is expected to stay
under two minutes end to end on the same hardware class; the staging drill records the real number.

## Staging and production variant

1. Take the input from the real backup path, not from a live dump: either the weekly `pg_dump` object in the
   storage bucket under `backups/` (download it, then run `pg_restore` with the same flags into a scratch database
   created with `createdb`) or a managed snapshot restored by the provider into a new instance.
2. For the snapshot route set `DATABASE_URL` to the restored instance and run `scripts/restore-drill.sh --skip-tests`
   against it to get the row-count comparison and migration status, then run the tenant-isolation suite against a
   second scratch copy if required (never against the restored instance you intend to keep).
3. Measure the two numbers the launch gate wants: recovery time (first byte of the restore command to migration status
   clean) and recovery point (age of the backup used). Targets for the pilot: RTO 60 minutes, RPO 24 hours (daily
   snapshots) with the weekly dump as the independent copy.
4. Point a local API at the scratch copy (`DATABASE_URL=<scratch> pnpm dev:api` on a spare port) and sign in as a
   demo persona to confirm the application reads the restored data.
5. Drop the scratch database and delete the downloaded dump.

## When the drill fails

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `pg_dump` version mismatch error | client older than server | install the matching PostgreSQL client tools |
| `CREATE DATABASE` permission denied | role lacks `CREATEDB` | run with an admin role or on a scratch server |
| Row counts differ | writes happened during the dump, or a restore error was swallowed | rerun when quiet; inspect the diff printed by the script |
| `migrate status` reports pending migrations | the dump predates a migration | restore then run `prisma migrate deploy` before using the copy; note the gap in the incident |
| Tenant-isolation suite fails | application or data problem on the restored copy | treat as a defect; do not sign the gate row |

## Related

- [backup-restore.md](backup-restore.md) for the backup schedule and object storage.
- [incident-response.md](incident-response.md) for using a restored copy during an outage.
- [../launch-checklist.md](../launch-checklist.md) task L-10 (staging drill) and L-14 (launch-day verification).
