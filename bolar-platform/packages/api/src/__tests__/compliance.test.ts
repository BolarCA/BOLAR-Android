import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser, createProperty } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';
import { evaluate, validateConditions, matchTerms } from '../modules/compliance/engine.js';
import { applyOverride, expandJurisdiction, jurisdictionChain, selectRules } from '../modules/compliance/jurisdiction.js';
import { screenTextWithRules } from '../modules/compliance/fair-housing.js';
import { RULE_KEYS, STARTER_RULES, ensureStarterRules } from '../modules/compliance/starter-rules.js';

const byKey = (key: string) => STARTER_RULES.find((r) => r.key === key)!;
const hitKeys = (out: ReturnType<typeof evaluate>) => out.hits.map((h) => h.ruleKey);

describe('rule engine fixtures (Day 41): deterministic, explainable hits for every seeded rule', () => {
  it('consent gate: null consent blocks, present consent allows', () => {
    const rules = [byKey(RULE_KEYS.consentBeforeScreening)];
    const blocked = evaluate(rules, { consentAt: null });
    expect(blocked.result).toBe('block');
    expect(blocked.hits[0]!.evidence.conditionsMatched).toEqual(['consentAt is_null (consentAt=null)']);
    expect(blocked.hits[0]!.evidence.sourceUrl).toContain('ftc.gov');
    expect(evaluate(rules, { consentAt: '2026-01-01T00:00:00Z' }).result).toBe('allow');
    expect(evaluate(rules, {}).result).toBe('block'); // missing fact == null for is_null
  });
  it('adverse action waiting period: < 5 business days blocks, >= 5 allows', () => {
    const rules = [byKey(RULE_KEYS.adverseWaitingPeriod)];
    expect(evaluate(rules, { daysSincePreAdverse: 2 }).result).toBe('block');
    expect(evaluate(rules, { daysSincePreAdverse: 5 }).result).toBe('allow');
    expect(evaluate(rules, {}).result).toBe('allow'); // unknown facts never match numeric comparisons
  });
  it('CA deposit cap: gt_field compares two facts and records both in evidence', () => {
    const rules = [byKey(RULE_KEYS.caDepositCap)];
    const out = evaluate(rules, { rentCents: 180000, depositCents: 360000 });
    expect(out.result).toBe('block');
    expect(out.hits[0]!.evidence.facts).toEqual({ depositCents: 360000, rentCents: 180000 });
    expect(out.hits[0]!.evidence.conditionsMatched[0]).toContain('depositCents gt_field "rentCents"');
    expect(evaluate(rules, { rentCents: 180000, depositCents: 180000 }).result).toBe('allow');
  });
  it('CA late fee warn, TX deposit return warn (all conditions must hold), entry notice block', () => {
    expect(evaluate([byKey(RULE_KEYS.caLateFee)], { lateFeePercent: 7.5 }).result).toBe('warn');
    expect(evaluate([byKey(RULE_KEYS.caLateFee)], { lateFeePercent: 5 }).result).toBe('allow');
    expect(evaluate([byKey(RULE_KEYS.txDepositReturn)], { daysSinceMoveOut: 45, depositReturned: false }).result).toBe('warn');
    expect(evaluate([byKey(RULE_KEYS.txDepositReturn)], { daysSinceMoveOut: 45, depositReturned: true }).result).toBe('allow');
    expect(evaluate([byKey(RULE_KEYS.entryNotice)], { entryLeadHours: 12, emergency: false }).result).toBe('block');
    expect(evaluate([byKey(RULE_KEYS.entryNotice)], { entryLeadHours: 12, emergency: true }).result).toBe('allow');
    expect(evaluate([byKey(RULE_KEYS.entryNotice)], { entryLeadHours: 48, emergency: false }).result).toBe('allow');
  });
  it('fair housing and SOI guards: matches_any is case-insensitive, word-bounded and lists matched terms', () => {
    const guards = [byKey(RULE_KEYS.fairHousing), byKey(RULE_KEYS.soi)];
    const out = screenTextWithRules('Great unit. NO Section 8, adults only please.', guards);
    expect(out.flagged).toBe(true);
    expect(out.hits.map((h) => `${h.ruleKey}:${h.term}`).sort()).toEqual(['us.fair_housing.protected_class_language:adults only', 'us.soi.voucher_refusal:no section 8']);
    expect(screenTextWithRules('Caucasian oak floors, blackout curtains, kids welcome.', guards).flagged).toBe(false); // "asian"/"black" need word boundaries
    expect(matchTerms('wheelchair-accessible entrance', ['wheelchair'])).toEqual(['wheelchair']);
    expect(matchTerms('text', ['/no\\s+pets/'])).toEqual([]);
    expect(matchTerms('No   pets allowed', ['/no\\s+pets/'])).toEqual(['/no\\s+pets/']);
  });
  it('result is the most severe action and hits are ordered block > review > warn', () => {
    const out = evaluate(STARTER_RULES, { rentCents: 100000, depositCents: 250000, lateFeePercent: 9, text: 'no vouchers', consentAt: 'x', entryLeadHours: 48, emergency: false });
    expect(out.result).toBe('block');
    expect(hitKeys(out)).toEqual([RULE_KEYS.caDepositCap, RULE_KEYS.soi, RULE_KEYS.caLateFee]);
    expect(out.rulesConsidered).toBe(STARTER_RULES.length);
    // Deterministic: same facts, same output
    expect(evaluate(STARTER_RULES, { rentCents: 100000, depositCents: 250000, lateFeePercent: 9, text: 'no vouchers', consentAt: 'x', entryLeadHours: 48, emergency: false })).toEqual(out);
  });
  it('condition DSL validation rejects malformed trees and supports not/in/contains', () => {
    expect(validateConditions({ all: [{ field: 'x', op: 'bogus' }] })[0]!.message).toContain('op must be one of');
    expect(validateConditions({ foo: 1 })[0]!.message).toContain('group needs');
    expect(validateConditions({ all: [] })[0]!.message).toContain('non-empty');
    expect(validateConditions({ any: [{ field: 'state', op: 'in', value: 'CA' }] })[0]!.path).toBe('conditions.any[0].value');
    expect(validateConditions({ all: [{ field: 'a', op: 'gt_field', value: 'b' }], not: { field: 'c', op: 'is_null' } })).toEqual([]);
    const rule = { key: 'x', version: 1, jurisdiction: 'US', domain: 'rent', title: 't', description: 'd', severity: 'low', action: 'warn', conditions: { all: [{ field: 'state', op: 'in', value: ['CA', 'OR'] }, { field: 'tags', op: 'contains', value: 'rent_control' }], not: { field: 'exempt', op: 'eq', value: true } } };
    expect(evaluate([rule], { state: 'ca', tags: ['rent_control'], exempt: false }).result).toBe('warn');
    expect(evaluate([rule], { state: 'ca', tags: ['rent_control'], exempt: true }).result).toBe('allow');
    expect(evaluate([{ ...rule, conditions: { all: [{ field: 'x', op: 'nope' }] } }], { x: 1 }).result).toBe('allow'); // malformed never hits
  });
});

describe('jurisdiction resolver fixtures (Day 42)', () => {
  it('builds the chain from address parts and normalizes names', () => {
    expect(jurisdictionChain({ state: 'ca', county: 'Los Angeles', city: 'West Hollywood' })).toEqual(['US', 'US-CA', 'US-CA-LOS_ANGELES', 'US-CA-WEST_HOLLYWOOD']);
    expect(jurisdictionChain({ state: 'CA', county: 'Los Angeles', city: 'Los Angeles' })).toEqual(['US', 'US-CA', 'US-CA-LOS_ANGELES']);
    expect(jurisdictionChain({ state: 'TX', city: 'Austin' })).toEqual(['US', 'US-TX', 'US-TX-AUSTIN']);
    expect(expandJurisdiction('US-OR-PORTLAND')).toEqual(['US', 'US-OR', 'US-OR-PORTLAND']);
  });
  it('city override replaces the most specific level and keeps parents', () => {
    const base = jurisdictionChain({ state: 'CA', county: 'Los Angeles', city: 'Los Angeles' });
    expect(applyOverride(base, 'US-CA-WEST_HOLLYWOOD')).toEqual(['US', 'US-CA', 'US-CA-WEST_HOLLYWOOD']);
    expect(applyOverride(base, null)).toEqual(base);
  });
  it('selects active rules in the chain, effective at asOf, highest version per key (stale version excluded)', () => {
    const v1 = { ...byKey(RULE_KEYS.caDepositCap), id: 'r1', effectiveFrom: new Date('2024-07-01'), effectiveTo: new Date('2025-01-01') as Date | null, status: 'active' };
    const v2 = { ...v1, id: 'r2', version: 2, effectiveFrom: new Date('2025-01-01'), effectiveTo: null };
    const retired = { ...v1, id: 'r3', version: 3, status: 'retired', effectiveFrom: new Date('2025-06-01'), effectiveTo: null };
    const tx = { ...byKey(RULE_KEYS.txDepositReturn), id: 'r4', status: 'active' };
    const caChain = ['US', 'US-CA', 'US-CA-LOS_ANGELES'];
    const now = selectRules([v1, v2, retired, tx], caChain, new Date('2026-01-15'));
    expect(now.map((r) => `${r.key}@${r.version}`)).toEqual(['us-ca.deposit.max_one_month@2']);
    const past = selectRules([v1, v2, retired, tx], caChain, new Date('2024-09-01'));
    expect(past.map((r) => r.id)).toEqual(['r1']);
    expect(selectRules([v1, v2, retired, tx], caChain, new Date('2024-01-01'))).toEqual([]); // before AB 12 effective date
    expect(selectRules([v1, v2, retired, tx], ['US', 'US-TX'], new Date('2026-01-15')).map((r) => r.id)).toEqual(['r4']);
    expect(selectRules([v1, v2, tx], caChain, new Date('2026-01-15'), ['rent'])).toEqual([]);
  });
});

describe('compliance API (Days 41-45): catalog, evaluate, queue, overrides, guard', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let officerA: Awaited<ReturnType<typeof createUser>>;
  let officerB: Awaited<ReturnType<typeof createUser>>;
  let lawyerA: Awaited<ReturnType<typeof createUser>>;
  let caProp: Awaited<ReturnType<typeof createProperty>>;
  beforeAll(async () => {
    fx = await twoTenantFixture();
    await ensureStarterRules(fx.admins.a.id);
    officerA = await createUser(fx.a, 'compliance_officer');
    officerB = await createUser(fx.b, 'compliance_officer');
    lawyerA = await createUser(fx.a, 'lawyer');
    caProp = await createProperty(fx.a, { name: 'Sunset Bungalows', city: 'Los Angeles', state: 'CA' });
    await prisma.property.update({ where: { id: caProp.id }, data: { county: 'Los Angeles' } });
  });

  it('lists the platform catalog with filters; vendor is denied', async () => {
    const o = await asUser(officerA);
    const all = await o.get('/rules');
    expect(all.status).toBe(200);
    expect(all.body.items).toHaveLength(STARTER_RULES.length);
    const ca = await o.get('/rules?jurisdiction=us-ca&domain=deposit');
    expect(ca.body.items.map((r: { key: string }) => r.key)).toEqual([RULE_KEYS.caDepositCap]);
    const vendor = await createUser(fx.a, 'vendor');
    const denied = await (await asUser(vendor)).get('/rules');
    expect(denied.status).toBe(403);
  });

  it('evaluate for a CA property persists a deposit block in the queue; TX property does not hit the CA rule', async () => {
    const m = await asUser(fx.managers.a);
    const res = await m.post('/rules/evaluate').send({ domain: 'deposit', resourceType: 'lease', resourceId: 'lease_fixture_1', facts: { rentCents: 180000, depositCents: 360000 }, propertyId: caProp.id });
    expect(res.status).toBe(201);
    expect(res.body.result).toBe('block');
    expect(res.body.jurisdictionChain).toEqual(['US', 'US-CA', 'US-CA-LOS_ANGELES']);
    expect(res.body.hits[0]).toMatchObject({ ruleKey: RULE_KEYS.caDepositCap, action: 'block', severity: 'high' });
    expect(res.body.evaluationIds).toHaveLength(1);
    const tx = await m.post('/rules/evaluate').send({ domain: 'deposit', resourceType: 'lease', resourceId: 'lease_fixture_2', facts: { rentCents: 180000, depositCents: 360000 }, propertyId: fx.propA.id });
    expect(tx.body.result).toBe('allow');
    expect(tx.body.evaluationIds).toEqual([]);
    const queued = await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, action: 'compliance.evaluate', resourceId: 'lease_fixture_1' } });
    expect(queued?.outcome).toBe('deny');
    const evt = await prisma.auditLog.count({ where: { tenantOrgId: fx.a.id, action: 'compliance.evaluate' } });
    expect(evt).toBeGreaterThanOrEqual(2);
  });

  it('queue: list unresolved, filters, due dates; resolve with note; override requires approver; tenant isolation', async () => {
    const o = await asUser(officerA);
    const q = await o.get('/rules/evaluations?reviewed=false');
    expect(q.status).toBe(200);
    const item = q.body.items.find((e: { resourceId: string }) => e.resourceId === 'lease_fixture_1');
    expect(item).toMatchObject({ ruleKey: RULE_KEYS.caDepositCap, result: 'block', severity: 'high', domain: 'deposit', jurisdiction: 'US-CA' });
    expect(new Date(item.dueAt).getTime() - new Date(item.createdAt).getTime()).toBe(7 * 86_400_000);
    expect((await o.get('/rules/evaluations?severity=low')).body.items).toHaveLength(0);
    expect((await o.get(`/rules/evaluations?resourceType=lease&resourceId=lease_fixture_1`)).body.items).toHaveLength(1);
    // other tenant sees nothing and cannot resolve
    const b = await asUser(officerB);
    expect((await b.get('/rules/evaluations')).body.items).toHaveLength(0);
    expect((await b.post(`/rules/evaluations/${item.id}/resolve`).send({ resolution: 'accepted' })).status).toBe(404);
    // manager (compliance:write, no approve) cannot override -> 403 + access.denied audit
    const m = await asUser(fx.managers.a);
    const noOverride = await m.post(`/rules/evaluations/${item.id}/resolve`).send({ resolution: 'overridden', note: 'exempt landlord, documented' });
    expect(noOverride.status).toBe(403);
    expect(await prisma.auditLog.findFirst({ where: { action: 'access.denied', resourceType: 'rule_evaluation', resourceId: item.id, actorId: fx.managers.a.id } })).not.toBeNull();
    // officer override needs a note
    expect((await o.post(`/rules/evaluations/${item.id}/resolve`).send({ resolution: 'overridden' })).status).toBe(400);
    const resolved = await o.post(`/rules/evaluations/${item.id}/resolve`).send({ resolution: 'overridden', note: 'Owner qualifies for the small-landlord exemption; evidence attached.' });
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({ resolution: 'overridden', reviewedBy: officerA.id });
    expect((await o.post(`/rules/evaluations/${item.id}/resolve`).send({ resolution: 'accepted' })).status).toBe(409);
    expect((await o.get('/rules/evaluations?reviewed=false')).body.items.find((e: { id: string }) => e.id === item.id)).toBeUndefined();
    const auditRow = await prisma.auditLog.findFirst({ where: { action: 'compliance.evaluation.resolve', resourceId: item.id } });
    expect(auditRow?.policyVersion).toBe(`${RULE_KEYS.caDepositCap}@v1`);
  });

  it('rule lifecycle: create draft -> author cannot activate -> another approver activates -> new version retires previous', async () => {
    const o = await asUser(officerA);
    const bad = await o.post('/rules').send({ key: 'us-ca.rent.cap_test', jurisdiction: 'US-CA', domain: 'rent', title: 'Test cap', description: 'fixture', conditions: { all: [{ field: 'increasePercent', op: 'bogus' }] } });
    expect(bad.status).toBe(400);
    const created = await o.post('/rules').send({ key: 'us-ca.rent.cap_test', jurisdiction: 'US-CA', domain: 'rent', title: 'Test cap', description: 'fixture', action: 'warn', conditions: { all: [{ field: 'increasePercent', op: 'gt', value: 10 }] }, sourceUrl: 'https://example.test/ab1482' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ version: 1, status: 'draft' });
    expect((await o.post('/rules').send({ key: 'us-ca.rent.cap_test', jurisdiction: 'US-CA', domain: 'rent', title: 'dup', description: 'dup', conditions: { all: [{ field: 'x', op: 'is_null' }] } })).status).toBe(409);
    const self = await o.post(`/rules/${created.body.id}/activate`);
    expect(self.status).toBe(403);
    const l = await asUser(lawyerA);
    const active = await l.post(`/rules/${created.body.id}/activate`);
    expect(active.status).toBe(200);
    expect(active.body).toMatchObject({ status: 'active', approvedBy: lawyerA.id });
    // draft rules are not evaluated; active ones are
    const m = await asUser(fx.managers.a);
    const hit = await m.post('/rules/evaluate').send({ domain: 'rent', resourceType: 'lease', resourceId: 'lease_fixture_3', facts: { increasePercent: 12 }, propertyId: caProp.id });
    expect(hit.body.hits.map((h: { ruleKey: string }) => h.ruleKey)).toEqual(['us-ca.rent.cap_test']);
    const v2 = await l.post(`/rules/${created.body.id}/new-version`).send({ conditions: { all: [{ field: 'increasePercent', op: 'gt', value: 5 }] } });
    expect(v2.status).toBe(201);
    expect(v2.body).toMatchObject({ version: 2, status: 'draft', key: 'us-ca.rent.cap_test' });
    expect((await l.post(`/rules/${v2.body.id}/activate`)).status).toBe(403); // lawyer authored v2
    expect((await o.post(`/rules/${v2.body.id}/activate`)).status).toBe(200);
    const v1 = await o.get(`/rules/${created.body.id}`);
    expect(v1.body.status).toBe('retired');
    const retire = await o.post(`/rules/${v2.body.id}/retire`);
    expect(retire.body.status).toBe('retired');
    expect((await m.post('/rules/evaluate').send({ domain: 'rent', resourceType: 'lease', resourceId: 'lease_fixture_4', facts: { increasePercent: 12 }, propertyId: caProp.id })).body.result).toBe('allow');
  });

  it('jurisdiction resolve + override (approver only, audited); other tenant property is 404', async () => {
    const o = await asUser(officerA);
    const before = await o.get(`/jurisdiction/resolve?propertyId=${caProp.id}`);
    expect(before.status).toBe(200);
    expect(before.body.chain).toEqual(['US', 'US-CA', 'US-CA-LOS_ANGELES']);
    expect(before.body.activeRules.map((r: { key: string }) => r.key)).toContain(RULE_KEYS.caDepositCap);
    const m = await asUser(fx.managers.a);
    expect((await m.post('/jurisdiction/overrides').send({ propertyId: caProp.id, jurisdiction: 'US-CA-WEST_HOLLYWOOD', reason: 'Parcel sits inside West Hollywood city limits.' })).status).toBe(403);
    const ov = await o.post('/jurisdiction/overrides').send({ propertyId: caProp.id, jurisdiction: 'US-CA-WEST_HOLLYWOOD', reason: 'Parcel sits inside West Hollywood city limits.' });
    expect(ov.status).toBe(201);
    const after = await o.get(`/jurisdiction/resolve?propertyId=${caProp.id}`);
    expect(after.body.chain).toEqual(['US', 'US-CA', 'US-CA-WEST_HOLLYWOOD']);
    expect(after.body.override.jurisdiction).toBe('US-CA-WEST_HOLLYWOOD');
    expect(await prisma.auditLog.findFirst({ where: { action: 'compliance.jurisdiction.override', resourceId: caProp.id } })).not.toBeNull();
    expect((await o.get(`/jurisdiction/resolve?propertyId=${fx.propB.id}`)).status).toBe(404);
    expect((await (await asUser(officerB)).get('/jurisdiction/overrides')).body.items).toHaveLength(0);
  });

  it('screen-text guard flags SOI/protected-class language, persists review items when a resource is given', async () => {
    const m = await asUser(fx.managers.a);
    const clean = await m.post('/compliance/screen-text').send({ text: 'Quiet building, pets welcome, income 3x rent.' });
    expect(clean.body).toEqual({ flagged: false, hits: [], evaluationIds: [] });
    const flagged = await m.post('/compliance/screen-text').send({ text: 'No Section 8 and no children.', resourceType: 'listing', resourceId: 'listing_1' });
    expect(flagged.status).toBe(201);
    expect(flagged.body.flagged).toBe(true);
    expect(flagged.body.hits.map((h: { term: string }) => h.term).sort()).toEqual(['no children', 'no section 8']);
    expect(flagged.body.evaluationIds).toHaveLength(2);
    const o = await asUser(officerA);
    const q = await o.get('/rules/evaluations?resourceType=listing&resourceId=listing_1&result=review');
    expect(q.body.items).toHaveLength(2);
    expect(q.body.items[0].evidenceJson.matchedTerms).toBeDefined();
    expect(await prisma.auditLog.findFirst({ where: { action: 'compliance.guard.fired', resourceId: 'listing_1' } })).not.toBeNull();
  });
});
