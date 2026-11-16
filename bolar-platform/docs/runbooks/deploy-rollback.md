# Runbook: deploy and rollback

## Deploy
1. Confirm CI green on the commit; run `deploy-staging` with the SHA.
2. The workflow builds images, runs `prisma migrate deploy`, rolls out api/workers/web, waits for `/health`.
3. Verify: `/health` ok, login as a demo persona, run `pnpm e2e:smoke` with `WEB_BASE_URL` pointing at staging.

## Rollback (application)
1. On the host: `IMAGE_TAG=$(cat /etc/bolar/previous_tag) docker compose -f docker-compose.staging.yml up -d api workers web`.
2. Verify `/health` and one portal login. Record the incident and root cause in the release issue.

## Rollback (schema)
Migrations are forward-only and additive by convention. If a migration must be reverted:
1. Stop api and workers.
2. Apply the down SQL noted in the PR that introduced the migration (every schema PR carries a rollback note).
3. `prisma migrate resolve --rolled-back <migration>`; redeploy the previous image.

## Config change rollback
Environment variables live in `/etc/bolar/staging.env` (secret manager export). Keep the previous file as
`staging.env.prev`; restore it and `docker compose up -d` to revert a config change.
