# UAT defect triage

Every deviation found during a UAT session is filed with the `UAT defect` issue form
(`.github/ISSUE_TEMPLATE/uat-defect.yml`), labelled `uat` and the severity below, and reviewed in the daily triage
(UAT lead, engineering lead, product owner; counsel joins when the `compliance` label is set). Triage confirms the
severity, assigns an owner and sets the fix target. Nothing is closed without the tester re-running the failed step
on the build that carries the fix.

## Severity definitions

| Severity | Definition | Examples from this product |
| --- | --- | --- |
| S1 Critical | Data exposed across tenants or to a role that must not see it; money moved or recorded wrongly; a regulated step can be bypassed; the portal cannot be used at all | A tenant sees another tenant's profile; a screening order succeeds without consent; a notice sends without approval; `/health` returns `degraded` in staging; login fails for every persona |
| S2 High | A journey in a UAT script cannot be completed and there is no workaround inside the product; wrong business result that a human would act on | Lease cannot move from `review` to `approved`; invoice generation double-posts; vendor cannot start an assigned job; trial balance shows unbalanced |
| S3 Medium | Journey completes with a workaround, a visible defect in a non-critical path, misleading copy or state, accessibility violation of serious impact on a secondary screen | Filter does not reset with "Clear filters"; a badge shows the wrong tone; a nav link leads to a not-found page; a drawer loses focus on close |
| S4 Low | Cosmetic, wording, alignment, minor inconsistency; suggestions | Label capitalisation, spacing, an empty state that could say more |

When in doubt pick the higher severity and let triage lower it with a written reason.

## Fix SLA (from triage confirmation)

| Severity | Fix target | Verification | Release handling |
| --- | --- | --- | --- |
| S1 | Same day; environment frozen until fixed or the feature is disabled with a feature flag | Tester re-runs the step plus `scripts/uat-smoke.sh` GREEN; a regression test is added | Blocks launch; go/no-go cannot be signed with an open S1 |
| S2 | Within 2 business days | Tester re-runs the step; the Playwright spec that covers the journey is extended when a gap allowed it through | Blocks launch unless the founder accepts the risk in writing in the risk register |
| S3 | Before launch or scheduled in the first two weeks after launch | Tester or UAT lead re-checks on the next GREEN build | Does not block launch when an owner and a date exist |
| S4 | Backlog | Spot check | Never blocks |

## Launch-blocking criteria

Go/no-go is NO-GO while any of the following is true:

- An S1 or S2 defect is open, or was closed without tester verification on the release candidate.
- A defect touches a row of [../human-approval-map.md](../human-approval-map.md) (an approval can be skipped, or the
  approver can be the requester), regardless of severity.
- A defect reproduces cross-tenant data access, regardless of severity.
- The last `scripts/uat-smoke.sh` run on the release candidate is RED, or more than 48 hours old.
- A script was never executed by a real user of that persona.

## Triage workflow

1. Tester files the issue during the session: persona, script step, expected versus observed, build commit (from
   [last-run.md](last-run.md)), request id from the error toast when there was one, screenshot with seed data only.
2. Engineering on-call confirms reproduction within four business hours for S1/S2 and labels the issue with the
   module (`iam`, `lease`, `finance`, `compliance`, `governance`, `maintenance`, `documents`, `portals`).
3. Daily triage sets the final severity, owner, fix target and whether counsel review is needed
   (`counsel-review.yml` issue linked when a template, rule, notice or retention default changes).
4. Fix lands with a test; the PR links the defect; CI is green; the UAT lead reruns the smoke harness.
5. Tester verifies on the new build and closes the issue with "verified on <commit>".
6. The launch checklist row `UAT defects` is updated with open counts by severity.

## Duplicate and known-limit handling

- Before filing, search open `uat` issues by step number and persona.
- The known limits listed in [README.md](README.md) are not defects; reference the launch task instead.
- A failing expectation caused by test data drift (someone changed seeded rows) is labelled `environment`, the data
  is reseeded and the step is rerun; it does not count against the build.
