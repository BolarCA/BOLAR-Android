# Counsel review map (Day 3)

Where a human with legal accountability must review before behaviour reaches tenants or regulators.

## Review checklist by artefact

### Compliance rules (policy-as-code)
- [ ] Each rule has a source URL to the statute/regulation and an effective date.
- [ ] Jurisdiction code is correct and specific (state vs city ordinance).
- [ ] Action level (warn/block/review) matches legal risk; blocks are reserved for clear statutory limits.
- [ ] Version activation recorded with approver; old version retired; evidence includes rule version.
- [ ] Pilot jurisdictions enumerated; rules for other areas stay draft.

### Notices and templates
- [ ] High-risk templates (late rent, entry, termination, pre/final adverse action, privacy confirmation) approved by counsel before first use.
- [ ] Required disclosures present (FCRA Summary of Rights, provider contact, dispute window).
- [ ] Lead times and cure periods match jurisdiction rules; variables validated (no blanks).
- [ ] Fair housing / SOI guard results reviewed; any hit documented with disposition.

### Screening
- [ ] Permissible purpose and consent language reviewed; consent captured before order (enforced in code).
- [ ] Criteria do not use protected-class proxies; criteria text passed through the guard.
- [ ] Adverse action timeline (pre-adverse, waiting period, final, dispute) matches policy; waiting period default 5 business days confirmed.
- [ ] Report access limited to roles with `screening:read_report` plus sensitive gate; retention schedule confirmed.

### Retention and deletion
- [ ] Retention periods per record class confirmed per state (defaults in seed are placeholders).
- [ ] Deletion exceptions (legal hold, retention, audit integrity, third parties) reviewed per request.
- [ ] Anonymisation approach for tenant profiles acceptable; audit logs retained.

### Legal hold and government requests
- [ ] Hold scope minimal and documented; release requires a second lawyer.
- [ ] Agency/law-enforcement requests: legal basis verified, minimisation notes written, approver recorded, export manifest reviewed before release.

### Payments and finance
- [ ] Deposit handling (trust accounts, interest where required) confirmed per state before real payments.
- [ ] Fee schedules (late fees, NSF) within legal caps; adjustments require second approver.

## Approval points implemented in code
See `human-approval-map.md`. Each row there maps to a permission and an `approver != requester` check.
