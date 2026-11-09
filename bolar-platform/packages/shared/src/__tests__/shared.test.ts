import { describe, it, expect } from 'vitest';
import { redactFields, isGated, permissionsForRoles, ROLE_PERMISSIONS, ROLES, encodeCursor, decodeCursor, toPage, StateMachine, redactText, EventBus, makeEvent } from '../index.js';

describe('classification', () => {
  it('gates confidential and restricted', () => {
    expect(isGated('public')).toBe(false);
    expect(isGated('internal')).toBe(false);
    expect(isGated('confidential')).toBe(true);
    expect(isGated('restricted')).toBe(true);
  });
  it('redacts fields above clearance', () => {
    const r = redactFields({ name: 'A', ssn: '123', email: 'x' }, { ssn: 'restricted', email: 'confidential' }, 'internal');
    expect(r.ssn).toBeNull();
    expect(r.email).toBeNull();
    expect(r.name).toBe('A');
    expect(r.redactedFields.sort()).toEqual(['email', 'ssn']);
  });
});

describe('rbac', () => {
  it('every role has a permission list', () => {
    for (const r of ROLES) expect(Array.isArray(ROLE_PERMISSIONS[r])).toBe(true);
  });
  it('tenant cannot administer users', () => {
    const p = permissionsForRoles(['tenant']);
    expect(p.has('user:invite')).toBe(false);
    expect(p.has('maintenance:request')).toBe(true);
  });
  it('vendor is limited to work orders and media', () => {
    const p = permissionsForRoles(['vendor']);
    expect(p.has('finance:read')).toBe(false);
    expect(p.has('tenant_profile:read')).toBe(false);
    expect(p.has('work_order:vendor_update')).toBe(true);
  });
});

describe('pagination', () => {
  it('roundtrips cursors and pages', () => {
    const c = encodeCursor({ id: 'abc', createdAt: 5 });
    expect(decodeCursor(c)).toEqual({ id: 'abc', createdAt: 5 });
    expect(decodeCursor('!!!')).toBeNull();
    const rows = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const page = toPage(rows, 2);
    expect(page.items).toHaveLength(2);
    expect(decodeCursor(page.nextCursor!)).toEqual({ id: '2' });
    expect(toPage(rows, 5).nextCursor).toBeNull();
  });
});

describe('state machine', () => {
  const sm = new StateMachine<'a' | 'b' | 'c', 'x' | 'y'>([
    { from: 'a', to: 'b', allowed: (r) => r.includes('x') },
    { from: ['a', 'b'], to: 'c', allowed: () => true, guard: (ctx) => ((ctx as { ok: boolean })?.ok ? null : 'missing artifact') },
  ]);
  it('enforces roles, guards and transitions', () => {
    expect(sm.canTransition('a', 'b', ['x']).ok).toBe(true);
    expect(sm.canTransition('a', 'b', ['y']).ok).toBe(false);
    expect(sm.canTransition('b', 'a', ['x']).ok).toBe(false);
    expect(sm.canTransition('b', 'c', ['y'], { ok: false }).ok).toBe(false);
    expect(sm.canTransition('b', 'c', ['y'], { ok: true }).ok).toBe(true);
    expect(sm.nextStates('a').sort()).toEqual(['b', 'c']);
    expect(() => sm.assertTransition('a', 'b', ['y'])).toThrowError(/access/);
  });
});

describe('redaction', () => {
  it('removes PII from text', () => {
    const s = redactText('mail bob@example.com ssn 123-45-6789 phone (555) 123-4567 Bearer abc.def');
    expect(s).not.toContain('bob@example.com');
    expect(s).not.toContain('123-45-6789');
    expect(s).not.toContain('abc.def');
  });
});

describe('event bus', () => {
  it('delivers and isolates handler failures', async () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('x', () => { throw new Error('boom'); });
    bus.on('x', (e) => { seen.push(e.name); });
    bus.on('*', (e) => { seen.push('*' + e.name); });
    await bus.emit(makeEvent('x', { requestId: 'r', tenantOrgId: 't', actor: null }, { a: 1 }));
    expect(seen).toEqual(['x', '*x']);
  });
});
