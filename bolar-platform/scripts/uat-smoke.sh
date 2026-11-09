#!/usr/bin/env bash
# UAT smoke harness (blueprint p298 "UAT scripts" / launch checklist). Migrates and seeds the database named by
# DATABASE_URL, runs the Playwright `@smoke` set on API_PORT/WEB_PORT and writes docs/uat/last-run.md with the summary
# that the UAT lead pastes into the go/no-go record.
#
#   API_PORT=4124 WEB_PORT=3124 scripts/uat-smoke.sh
#
# Environment: DATABASE_URL (or bolar-platform/.env), API_PORT (default 4000), WEB_PORT (default 3000),
# QUEUE_DRIVER (default memory), UAT_GREP (default "@smoke"). Exit code is non-zero when any test fails; the report
# is written either way. Running two Playwright invocations against one database at once is unsupported.
set -uo pipefail
cd "$(dirname "$0")/.."
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export API_PORT="${API_PORT:-4000}"
export WEB_PORT="${WEB_PORT:-3000}"
export QUEUE_DRIVER="${QUEUE_DRIVER:-memory}"
GREP="${UAT_GREP:-@smoke}"
OUT="docs/uat/last-run.md"
WORK="$(mktemp -d)"
JSON="${WORK}/results.json"
STEPS="${WORK}/steps.tsv"
T0=$(date +%s)
trap 'rm -rf "$WORK"' EXIT

if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | tail -1 | cut -d= -f2-)"
fi
DB_NAME="$(echo "${DATABASE_URL:-unknown}" | sed -E 's#\?.*##; s#.*/##')"

step() { # step <name> <command...>: records name, pass/fail and seconds for the report
  local name=$1; shift
  local start; start=$(date +%s)
  echo "[uat-smoke] ${name}: start"
  if "$@"; then local result=pass; else local result=fail; fi
  echo -e "${name}\t${result}\t$(( $(date +%s) - start ))" >> "$STEPS"
  echo "[uat-smoke] ${name}: ${result}"
  [ "$result" = pass ]
}

SETUP_OK=1
step "pnpm db:migrate" pnpm db:migrate || SETUP_OK=0
if [ "$SETUP_OK" -eq 1 ]; then step "pnpm db:seed" pnpm db:seed || SETUP_OK=0; fi
if [ "$SETUP_OK" -eq 1 ]; then step "pnpm db:seed:demo" pnpm db:seed:demo || SETUP_OK=0; fi

E2E_EXIT=1
if [ "$SETUP_OK" -eq 1 ]; then
  echo "[uat-smoke] playwright --grep \"${GREP}\" on api :${API_PORT} web :${WEB_PORT}"
  PLAYWRIGHT_JSON_OUTPUT_NAME="$JSON" pnpm exec playwright test --config tests/playwright.config.ts --trace off --grep "$GREP" --reporter=list,json
  E2E_EXIT=$?
  echo -e "playwright ${GREP}\t$([ "$E2E_EXIT" -eq 0 ] && echo pass || echo fail)\t$(( $(date +%s) - T0 ))" >> "$STEPS"
else
  echo "[uat-smoke] setup failed; Playwright not run"
fi

COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
PW_VERSION="$(pnpm exec playwright --version 2>/dev/null | sed -E 's/^Version //')"

node - "$JSON" "$STEPS" "$OUT" "$COMMIT" "$BRANCH" "$DB_NAME" "$API_PORT" "$WEB_PORT" "$QUEUE_DRIVER" "$GREP" "$PW_VERSION" "$E2E_EXIT" <<'JS'
const fs = require('node:fs');
const [json, stepsFile, out, commit, branch, db, apiPort, webPort, queue, grep, pwVersion, e2eExit] = process.argv.slice(2);

// Which UAT scripts each spec backs (docs/uat/<persona>.md).
const SPEC_PERSONAS = {
  'access.spec.ts': ['org-admin', 'tenant'],
  'compliance.spec.ts': ['property-manager', 'compliance-officer', 'vendor'],
  'documents.spec.ts': ['property-manager', 'tenant', 'lawyer', 'vendor'],
  'finance.spec.ts': ['bookkeeper', 'tenant', 'vendor'],
  'governance.spec.ts': ['lawyer', 'government', 'tenant'],
  'lease.spec.ts': ['property-manager', 'landlord', 'tenant'],
  'maintenance.spec.ts': ['tenant', 'property-manager', 'vendor'],
  'manager-ops.spec.ts': ['property-manager', 'platform-admin', 'tenant'],
  'portal-matrix.spec.ts': ['platform-admin', 'org-admin', 'corporate-admin', 'occupant'],
  'portals-tenant-owner.spec.ts': ['tenant', 'landlord'],
  'property.spec.ts': ['property-manager', 'landlord', 'tenant'],
};

const steps = fs.existsSync(stepsFile)
  ? fs.readFileSync(stepsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => { const [name, result, seconds] = l.split('\t'); return { name, result, seconds: Number(seconds) }; })
  : [];

const perSpec = new Map();
const failures = [];
let stats = { expected: 0, unexpected: 0, flaky: 0, skipped: 0, duration: 0 };
let ran = false;
if (fs.existsSync(json)) {
  ran = true;
  const report = JSON.parse(fs.readFileSync(json, 'utf8'));
  stats = { ...stats, ...(report.stats ?? {}) };
  const walk = (suite, file) => {
    const f = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      const base = (spec.file ?? f ?? 'unknown').split('/').pop();
      const row = perSpec.get(base) ?? { tests: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, ms: 0 };
      for (const t of spec.tests ?? []) {
        row.tests += 1;
        if (t.status === 'expected') row.passed += 1;
        else if (t.status === 'flaky') row.flaky += 1;
        else if (t.status === 'skipped') row.skipped += 1;
        else row.failed += 1;
        for (const r of t.results ?? []) row.ms += r.duration ?? 0;
        if (t.status === 'unexpected') {
          const last = (t.results ?? []).at(-1);
          const msg = (last?.error?.message ?? 'no error message').split('\n')[0].replace(/\u001b\[[0-9;]*m/g, '');
          failures.push({ spec: base, project: t.projectName, title: spec.title, msg });
        }
      }
      perSpec.set(base, row);
    }
    for (const child of suite.suites ?? []) walk(child, f);
  };
  for (const s of report.suites ?? []) walk(s, s.file);
}

const total = stats.expected + stats.unexpected + stats.flaky + stats.skipped;
const green = ran && Number(e2eExit) === 0 && stats.unexpected === 0 && steps.every((s) => s.result === 'pass');
const fmt = (ms) => `${Math.round(ms / 1000)}s`;
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const personaLinks = (spec) => (SPEC_PERSONAS[spec] ?? []).map((p) => `[${p}](${p}.md)`).join(', ') || 'route matrix only';

const lines = [];
lines.push('# UAT smoke run (generated by scripts/uat-smoke.sh)');
lines.push('');
lines.push('Do not edit by hand; re-run `scripts/uat-smoke.sh` and commit the result. Interpreting this file: [README](README.md).');
lines.push('');
lines.push(`- Run date: ${now}`);
lines.push(`- Commit: \`${commit}\` on \`${branch}\``);
lines.push(`- Database: \`${db}\`; API port ${apiPort}; web port ${webPort}; QUEUE_DRIVER=${queue}; Playwright ${pwVersion || 'unknown'}; grep \`${grep}\``);
lines.push(`- Verdict: **${green ? 'GREEN' : 'RED'}** - ${green ? 'smoke set passed; UAT sessions may proceed on this build' : 'at least one step or test failed; fix or triage before UAT sessions (see docs/uat/defect-triage.md)'}`);
lines.push('');
lines.push('## Setup steps');
lines.push('');
lines.push('| Step | Result | Duration |');
lines.push('| --- | --- | --- |');
for (const s of steps) lines.push(`| \`${s.name}\` | ${s.result} | ${s.seconds}s |`);
lines.push('');
lines.push('## Totals');
lines.push('');
lines.push('| Tests | Passed | Failed | Flaky | Skipped | Wall time |');
lines.push('| --- | --- | --- | --- | --- | --- |');
lines.push(ran ? `| ${total} | ${stats.expected} | ${stats.unexpected} | ${stats.flaky} | ${stats.skipped} | ${fmt(stats.duration)} |` : '| 0 | 0 | 0 | 0 | 0 | not run |');
lines.push('');
lines.push('Skipped tests are expected: the desktop project skips mobile-only journeys (`@mobile`) by design.');
lines.push('');
lines.push('## Per spec');
lines.push('');
lines.push('| Spec | Backs UAT scripts | Tests | Passed | Failed | Skipped | Test time |');
lines.push('| --- | --- | --- | --- | --- | --- | --- |');
for (const [spec, r] of [...perSpec.entries()].sort()) lines.push(`| \`tests/e2e/${spec}\` | ${personaLinks(spec)} | ${r.tests} | ${r.passed + r.flaky} | ${r.failed} | ${r.skipped} | ${fmt(r.ms)} |`);
if (perSpec.size === 0) lines.push('| none | setup failed before Playwright ran | 0 | 0 | 0 | 0 | 0s |');
lines.push('');
lines.push('## Failures');
lines.push('');
if (failures.length === 0) lines.push(ran ? 'None.' : 'Playwright did not run because a setup step failed; see the setup table.');
for (const f of failures) lines.push(`- \`${f.spec}\` [${f.project}] ${f.title}: ${f.msg}`);
lines.push('');
fs.mkdirSync(require('node:path').dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n'));
console.log(`[uat-smoke] wrote ${out}: ${green ? 'GREEN' : 'RED'} (${stats.expected} passed, ${stats.unexpected} failed, ${stats.skipped} skipped)`);
JS

echo "[uat-smoke] total duration $(( $(date +%s) - T0 ))s"
[ "$SETUP_OK" -eq 1 ] && [ "$E2E_EXIT" -eq 0 ]
