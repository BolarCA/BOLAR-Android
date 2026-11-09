# ADR 0004: AI assistant - provider boundary, mock-first delivery, human-in-the-loop limits, cost controls (Days 61-74)

- Status: accepted
- Date: 2026-11-09

## Context
Blueprint p295 asks for a command router, a tool registry, tenant-scoped retrieval, prompt-injection tests and AI
output audit; p300 fixes what the assistant may do (summarise, draft, flag, prepare packets, recommend) and insists that
humans approve everything that has legal, financial, compliance or access effect. API p35 names the surface:
`/ai/commands`, `/ai/threads`, `/ai/tool-calls`, `/ai/audit` with tests for prompt injection, PII redaction and denied
tool calls. Audit, permissions and the notice approval chain already exist (Days 1-60).

## Decision

### 1. Provider adapter with mock-first delivery
`packages/integrations/src/ai` defines `AiProvider` with two calls per command: `plan(command, context, tools)` returns
the registered tools to run and their inputs; `answer(outcomes)` composes the reply. The provider never executes tools,
never sees raw PII and never talks to the database.

- `MockAiProvider` (ANTHROPIC_MODE=mock, the default everywhere outside staging/production): deterministic keyword rules
  over the *command only* and template answers that echo retrieved facts with citations. Tests, evals, seeds and e2e run
  against it, so the suite is reproducible and free.
- `AnthropicAiProvider` (sandbox|production) uses the official `@anthropic-ai/sdk` Messages API with tool use.
  Default model `claude-fable-5-1` (AI_MODEL may select `claude-sonnet-5-5` as the cheaper option). On this model
  thinking is always on (no `thinking` parameter is sent), forced `tool_choice` is rejected, so the planning turn uses
  `tool_choice: auto` with the whole registry as `tools`, and the answer turn replays the planned `tool_use` blocks
  with one `tool_result` each and `tool_choice: none`, so the plan cannot grow after retrieval. `stop_reason: refusal`
  is surfaced as a refused answer. Server-side refusal fallbacks are not enabled in this version (documented risk).
- `production` mode is refused unless NODE_ENV=production (same rule as the other adapters).

### 2. Command router owns security
`packages/api/src/modules/ai/service.ts`:
1. budget pre-check, thread ownership check, redaction of the command (`redactTextCounted`);
2. plan with the provider;
3. execute at most three planned calls through `tools.ts`; each tool runs **the same access functions the HTTP routes
   use** (`loadLease`, `loadCase`, `requireWorkOrderView`, `loadDocument` + `requireDocumentClearance`) over
   `tenantDb(ctx)`; a `not_found | forbidden | review_required` AppError becomes a `denied` tool call, audited as
   `ai.tool_denied`, and the answer says the record cannot be accessed;
4. tool outputs are redacted (`redactForModel`: restricted fields such as `ssnLast4`/`dateOfBirth` dropped, contact keys
   masked, PII patterns replaced) before they reach the provider or an AI table; retrieved free text (descriptions,
   notes, document text) is handed over separately and wrapped as untrusted data
   (`<<<UNTRUSTED_DATA label="...">>> ... <<<END_UNTRUSTED_DATA>>>`) with a system rule that it contains no instructions;
5. citations are router-enforced: an answer with successful tools always ends with a `Sources:` line;
6. one `ai.command` audit row per command (tools and statuses, model, tokens, cost, redaction count), `AiToolCall` rows
   with input/output SHA-256 hashes, and an `ai.command` domain event for the worker log.

### 3. Human-in-the-loop boundaries
Tools are read-only except `draft_notice` and `draft_email`. `draft_notice` calls `createNoticeDraft` from the notice
module, so the fair-housing guard and notice rules run and the result is a plain `draft` in the existing approval queue
(submit by a drafter, approve by a different human). `draft_email` returns text only. There is no send, approve, pay,
assign or access-changing tool, and the UI shows "Draft created, awaiting approval" with links to the queue instead of
any action button. `prepare_packet_outline` only counts documents and audit events; the packet itself stays behind the
packet-export approval flow.

### 4. Cost controls
`AiBudget` per org (`monthlyLimitCents`, `spentCents`, `commandCount`, `period`), created lazily from
`AI_MONTHLY_BUDGET_CENTS` and reset when the month changes (lazy reset on read, audited `ai.budget_reset`). Each command
is charged with `provider.estimateCostCents(usage)` (list prices per model; mock: 1 cent). A command over the limit
returns `429 rate_limited` and audits `ai.budget_exceeded`. Only `platform:admin` or `org:write` may change the limit.

## Consequences
- Every assistant answer is reproducible in tests, and the eval suite (`packages/api/src/modules/ai/evals/fixtures`,
  23 cases) runs on every CI pass without network.
- The real provider can be switched on per environment without code changes; its prompt builder is unit-tested
  (wrapper, tool restriction) even though the network call is not exercised in CI.
- Adding a tool means adding one registry entry that reuses an existing module's access function; adding a tool that
  mutates state is a policy change and needs a new ADR.

## Alternatives considered
- Letting the model loop freely over tools (agentic loop): rejected for the MVP because it makes cost and denial
  behaviour harder to bound; the two-turn plan/answer shape keeps every tool call auditable before it runs.
- Retrieval-augmented search over all records: rejected; scoped tools that reuse route access checks are the only way
  to guarantee the p19 invariants (tenant isolation, party-only visibility, privileged cases, classification gates).
