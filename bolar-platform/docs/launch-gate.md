# Staging launch gate (Day 60) and final MVP acceptance (p301)

Go/no-go is signed by the founder and the release manager; counsel signs the compliance row.
Each item needs evidence (link to CI run, screenshot, log excerpt) in the release issue.

## 1. Cross-portal demo
- [ ] Admin, subaccount, manager, owner, tenant, vendor, finance, compliance, legal and gov portals load with seed data.
- [ ] Role-fixture route matrix passes (`pnpm e2e -- --grep role`).
- [ ] Mobile tenant home verified at phone width.

## 2. Data integrity
- [ ] `pnpm prisma:migrate:status` clean on staging; `db:migrate:test` green in CI.
- [ ] Tenant isolation suites green (db + api); no cross-tenant rows in evidence exports.
- [ ] `GET /ledger/proof` balanced; invoices reconcile to payments and journals.
- [ ] Lease occupancy consistent with unit status (lease QA doc).

## 3. Compliance active
- [ ] Rule engine evaluates seeded fixtures; queue shows hits; counsel-reviewed rules are the only active ones.
- [ ] Notice drafts cannot be sent without approval; adverse action waiting period enforced.
- [ ] Privacy intake, legal hold exclusions and export approval chain exercised end to end.

## 4. CI/CD green
- [ ] `ci.yml` and `security.yml` green on the release commit.
- [ ] `deploy-staging.yml` succeeded; previous tag recorded; rollback rehearsed once (docs/runbooks/deploy-rollback.md).

## 5. Observability and resilience
- [ ] `/health` ok; structured logs flowing with redaction; request ids traceable from UI error to log.
- [ ] Sentry DSN configured and a test error captured; alert routed.
- [ ] Backup taken and restore proven on a scratch database (docs/runbooks/backup-restore.md).
- [ ] Queue workers processing; failed-job alerting in place.

## 6. Security and privacy
- [ ] No secrets in repo (security workflow), production modes refused outside production.
- [ ] MFA enabled for all staff accounts on staging; session revocation tested.
- [ ] Access token moved to httpOnly cookie or risk accepted in writing (ADR 0002).

## 7. Human approvals recorded
- [ ] Legal: templates, rules, retention defaults approved for pilot jurisdictions.
- [ ] Finance: no real payment credentials present; adapters in sandbox.
- [ ] Founder: unresolved blockers classified (accept / fix) in the risk register.

Decision: GO / NO-GO - date - signatures.
