# Staging deployment

Single deployment target: a container host (any Docker-capable VM or ECS task set) running
`docker-compose.staging.yml` with managed PostgreSQL 16 (RDS/Cloud SQL/Neon) and S3-compatible storage.

## Host prerequisites
- Docker Engine + compose plugin; `ghcr.io` pull access for the deploy user.
- `/etc/bolar/staging.env` with: `DATABASE_URL`, `AUTH_JWT_SECRET` (>= 32 chars, from the secret manager),
  `REDIS_URL=redis://redis:6379`, `STORAGE_DRIVER=s3`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`,
  `STORAGE_SECRET_KEY`, `EMAIL_DRIVER=sendgrid`, `SENDGRID_MODE=sandbox`, `SENDGRID_API_KEY`, `STRIPE_MODE=sandbox`
  (test keys only), `SENTRY_DSN`, `WEB_BASE_URL`, `API_BASE_URL`, `CORS_ORIGINS`.
- Daily PostgreSQL snapshot (managed) plus weekly `pg_dump` to the storage bucket (docs/runbooks/backup-restore.md).

## Deploy flow (automated by `.github/workflows/deploy-staging.yml`)
1. CI must be green on the commit.
2. Build and push `bolar-api`, `bolar-workers`, `bolar-web` images tagged with the commit SHA.
3. SSH to the host: `IMAGE_TAG=<sha> docker compose --profile migrate run --rm migrate` (forward-only migrations).
4. `IMAGE_TAG=<sha> docker compose up -d api workers web`.
5. Smoke: `GET /health` returns `ok`; Playwright smoke against the staging URL; check Sentry has no new issues.
6. Record the previous tag in `/etc/bolar/previous_tag` for rollback.

## Rollback
`IMAGE_TAG=$(cat /etc/bolar/previous_tag) docker compose up -d api workers web`. Migrations are additive; a schema
rollback requires the down-migration noted in the PR (docs/runbooks/deploy-rollback.md).
