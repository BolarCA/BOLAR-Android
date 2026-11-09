# Risk register (Day 3)

Severity: critical / high / medium. Launch blocker = must be closed or formally accepted before pilot go-live.

| # | Area | Risk | Severity | Owner | Mitigation in code | Launch blocker |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | FCRA | Screening ordered without consent or permissible purpose | critical | Compliance lead + counsel | `ScreeningOrder` requires `consentAt`; rule `us.fcra.consent_before_screening` blocks; provider adapters refuse without consent | yes |
| R2 | FCRA | Adverse action without pre-adverse notice / waiting period, or decision made by automation | critical | Counsel | `AdverseAction` stages with waiting period; decision endpoints require `adverse_action:manage` human; no AI path | yes |
| R3 | Fair housing | Protected-class language in listings, criteria or notices | critical | Compliance lead | `screenText` guard routes to human review; evidence logged with source link | yes |
| R4 | Source of income | Blanket refusal of vouchers in jurisdictions that prohibit SOI discrimination | high | Counsel | SOI guard rule `us.soi.voucher_refusal`; jurisdiction-specific rules per pilot area | yes |
| R5 | Privacy | Tenant PII leaked across orgs or to unauthorised roles | critical | Security | `tenantDb` guard, isolation tests, classification + sensitive gate, redaction in logs | yes |
| R6 | Privacy | Deletion request executed against records under legal hold or retention | high | Counsel | `isHeld` checks, exception review stage, approver != requester | yes |
| R7 | Law enforcement | Data produced to an agency without legal basis or minimisation | critical | Counsel | Agency request workflow with legal review, approval chain, export manifest with redaction | yes |
| R8 | Payments | Moving real money before controls (PCI scope, trust accounting, refunds) are ready | high | Finance lead | Adapters in mock/sandbox; `*_MODE=production` refused outside production; double-entry proof; approval gate for adjustments | yes |
| R9 | Payments | Duplicate charges from retries or webhook replays | high | Finance lead | Idempotency keys on payments; `WebhookEvent` uniqueness; tests for duplicate delivery | yes |
| R10 | Security | Credential stuffing / account takeover | high | Security | Generic auth errors, lockout, refresh rotation, MFA-level routes, session revocation on suspension | yes |
| R11 | Security | Secrets in repo, prompts or screenshots | high | All | `.env` ignored, env:check refuses live keys, security workflow secret scan | yes |
| R12 | Legal | Notices sent with wrong jurisdiction clause or lead time | high | Counsel | Jurisdiction resolver, rule `us.notice.entry_24h`, approval before send | yes |
| R13 | Data | Irreversible migrations or seed data in production | medium | Data reviewer | `db:migrate:test` on scratch DB, rollback note in PR template, seeds guarded to non-production | no |
| R14 | Ops | Staging outage without rollback or backup proof | medium | Eng lead | docs/runbooks/deploy-rollback.md and backup-restore.md exercised at Day 60 | yes |
| R15 | Accessibility | Portals unusable with keyboard/screen reader | medium | Frontend | axe smoke in CI, focus-visible styles, labelled fields | no |
| R16 | AI (V1) | Prompt injection or PII leakage through the assistant | high | Eng lead | Deferred to Days 61-74 with scoped retrieval, redaction, denied-tool-call tests | n/a for MVP |

Review cadence: weekly during build; every item with "yes" is re-checked in the launch gate (docs/launch-gate.md).
