# ADR 0002: Auth provider and session model (Day 7)

- Status: accepted
- Date: 2026-11-09

## Options compared

| Option | Pros | Cons |
| --- | --- | --- |
| Clerk | Fast UI, MFA, orgs built in | Vendor lock-in for tenant model; orgs/roles semantics differ from BOLAR scopes; per-MAU cost |
| Auth0 | Mature, enterprise SSO | Cost at scale; rules/actions complexity; still need our RBAC/ReBAC |
| Supabase Auth | Cheap, Postgres native | Couples auth to Supabase stack; RLS-first model differs from app-level tenant guard |
| Custom (chosen for MVP) | Full control of session/tenant/MFA semantics, no PII leaves our DB, testable offline | We own password hashing, lockout, MFA, refresh rotation |

## Decision
Custom local provider behind an `AUTH_PROVIDER` seam: scrypt password hashes, short-lived HS256 access tokens
(15 min) carrying `sub/org/sid/mfa/plat`, opaque rotating refresh tokens hashed in `Session`, TOTP MFA with
`mfaVerified` per session, generic login errors, lockout after 5 failures for 15 minutes, failed logins audited
without email. Platform actors may act on another org only with `X-Tenant-Org` plus an active `SupportSession`
or `platform_admin`, audited as `support.cross_tenant_access`.

An external IdP (Clerk/Auth0/Okta SSO) can be added later as an `AccountLink` provider without changing the
session/tenant context contract.

## Consequences
- Web keeps the access token in memory and the refresh token in localStorage; move to httpOnly cookies before
  public launch (tracked in docs/launch-gate.md).
- MFA-level routes (`auth: 'mfa'`) refuse unverified sessions when the user has MFA enabled.
