## Summary

<!-- Which blueprint day/page does this implement? What changed and why. -->

## Blueprint references

- Pages followed (schema / API / UI): 
- Day: 

## Commands run locally (paste pass/fail)

```
pnpm lint
pnpm typecheck
pnpm test
pnpm openapi:check
pnpm e2e:smoke   # if UI touched
```

## Evidence

- [ ] Screenshots / Playwright trace attached (UI days)
- [ ] `pnpm prisma:migrate:status` output and rollback note (schema days)
- [ ] OpenAPI lint + contract tests green (API days)
- [ ] Tenant isolation / denied-path tests added or updated
- [ ] Audit events for create/update/delete/review

## Human approval

- [ ] Not required (no legal / financial / compliance / screening / deletion / law-enforcement policy change)
- [ ] Required - approval issue linked: #

## Rollback

<!-- How to revert safely (migration down path, feature flag, config). -->

## Next dependency unlocked / blocked

