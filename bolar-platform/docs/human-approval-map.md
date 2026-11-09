# Human approval map (blueprint p300)

| Outcome | AI / automation may | Human must approve | Permission | Enforced in |
| --- | --- | --- | --- | --- |
| Lease approval, denial, modification | summarise terms, flag rule hits | approve/reject transition | `lease:approve` (approver != creator) | `modules/lease` state machine |
| Tenant screening decision | order with consent, store report, summarise | decide application; advance adverse action | `adverse_action:manage` | `modules/screening` |
| Adverse action notices | draft from approved template | approve and send | `notice:approve` (approver != creator) | `modules/notice` |
| Financial adjustments, refunds, write-offs | prepare journal draft, flag anomalies | approve posting | `finance:approve_adjustment` (approver != creator) | `modules/finance` |
| Privacy deletion exceptions | discover records, list exceptions | decide and fulfil | `privacy_request:approve` | `modules/privacy` |
| Legal hold scope and release | propose scope from case | create; release by second lawyer | `legal_hold:write`, `legal_hold:release` | `modules/legal-hold` |
| Law-enforcement / agency data production | assemble packet, redact | legal review, approve, release export | `agency_request:approve`, `export:approve` | `modules/legal`, `modules/packet-export` |
| Compliance rule changes, jurisdiction overrides | draft new version, test against fixtures | activate | `compliance:approve` | `modules/compliance` |
| Sensitive data access | request with purpose | approve time-boxed grant | `sensitive_access:approve` (approver != requester) | `modules/sensitive-access` |
| Production deployment go/no-go | run checks, produce evidence | sign the launch gate | release manager + founder | `docs/launch-gate.md` |

Automation never flips a status in the right-hand column without a logged human actor; every approval writes an
audit row with `metadata.note`.
