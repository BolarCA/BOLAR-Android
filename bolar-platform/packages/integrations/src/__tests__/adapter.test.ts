import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modeFromEnv, withRetry, AdapterCallError, verifyHmacSignature, LocalStorageAdapter, SinkEmailAdapter, TwilioSmsAdapter, SendGridEmailAdapter } from '../index.js';

describe('adapter contract', () => {
  it('refuses production mode outside production', () => {
    expect(modeFromEnv('X_MODE', { X_MODE: 'mock' })).toBe('mock');
    expect(() => modeFromEnv('X_MODE', { X_MODE: 'production', NODE_ENV: 'test' })).toThrow(/production/);
    expect(() => modeFromEnv('X_MODE', { X_MODE: 'weird' })).toThrow(/invalid/);
  });
  it('retries only retryable failures', async () => {
    let n = 0;
    const ok = await withRetry(async () => { if (++n < 3) throw new AdapterCallError('t', 'flaky', true); return 'done'; }, { baseMs: 1 });
    expect(ok).toBe('done');
    expect(n).toBe(3);
    n = 0;
    await expect(withRetry(async () => { n++; throw new AdapterCallError('t', 'bad request', false); }, { baseMs: 1 })).rejects.toThrow(/bad request/);
    expect(n).toBe(1);
  });
  it('verifies HMAC webhook signatures in constant time', async () => {
    const { createHmac } = await import('node:crypto');
    const sig = createHmac('sha256', 's3cret').update('{"a":1}').digest('hex');
    expect(await verifyHmacSignature('s3cret', '{"a":1}', `sha256=${sig}`)).toBe(true);
    expect(await verifyHmacSignature('s3cret', '{"a":2}', sig)).toBe(false);
  });
  it('mock adapters validate without credentials and record calls', async () => {
    const sg = new SendGridEmailAdapter({ SENDGRID_MODE: 'mock' });
    await sg.validateConfig();
    const r = await sg.execute({ to: 'a@b.test', subject: 's', text: 't' }, { requestId: 'r', tenantOrgId: 't', actorId: null });
    expect(r.accepted).toBe(true);
    expect(sg.log.calls).toHaveLength(1);
    const tw = new TwilioSmsAdapter({ TWILIO_MODE: 'sandbox' });
    await expect(tw.validateConfig()).rejects.toThrow(/missing configuration/);
    const sink = new SinkEmailAdapter();
    await sink.execute({ to: 'x@y.test', subject: 's', text: 't' }, { requestId: 'r', tenantOrgId: null, actorId: null });
    expect(sink.log.calls[0]!.input.to).toBe('x@y.test');
  });
});

describe('local storage adapter', () => {
  it('stores, hashes, signs and rejects path traversal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bolar-storage-'));
    const s = new LocalStorageAdapter(root, 'secret', 'http://api');
    const put = await s.putObject({ key: 'org1/docs/a.txt', body: Buffer.from('hello'), contentType: 'text/plain' });
    expect(put.sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect((await s.getObject('org1/docs/a.txt'))!.body.toString()).toBe('hello');
    expect((await s.headObject('org1/docs/a.txt'))!.sizeBytes).toBe(5);
    const url = await s.signedUrl('org1/docs/a.txt', 'GET', 60);
    const u = new URL(url.url);
    expect(s.verify('org1/docs/a.txt', 'GET', Number(u.searchParams.get('exp')), u.searchParams.get('sig')!)).toBe(true);
    expect(s.verify('org1/docs/a.txt', 'PUT', Number(u.searchParams.get('exp')), u.searchParams.get('sig')!)).toBe(false);
    expect(s.verify('org1/docs/a.txt', 'GET', Math.floor(Date.now() / 1000) - 10, u.searchParams.get('sig')!)).toBe(false);
    await expect(s.putObject({ key: '../../etc/passwd', body: Buffer.from('x'), contentType: 'text/plain' })).rejects.toThrow(/invalid/);
    await s.deleteObject('org1/docs/a.txt');
    expect(await s.getObject('org1/docs/a.txt')).toBeNull();
  });
});
