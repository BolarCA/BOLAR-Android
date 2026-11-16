import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import type { StorageAdapter, PutObjectInput, SignedUrl } from './types.js';

function safeKey(key: string): string {
  if (!key || key.startsWith('/') || key.startsWith('\\') || key.split(/[\\/]/).some((seg) => seg === '..' || seg === '') || key.includes('\0')) {
    throw new Error('invalid storage key');
  }
  return normalize(key);
}

/** Filesystem storage for local dev and tests. Signed URLs are HMAC tokens validated by the API's /storage route. */
export class LocalStorageAdapter implements StorageAdapter {
  readonly driver = 'local' as const;
  constructor(private readonly root: string, private readonly secret: string, private readonly baseUrl: string) {}

  private path(key: string) { return join(this.root, safeKey(key)); }

  async putObject(input: PutObjectInput) {
    const p = this.path(input.key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, input.body);
    await writeFile(`${p}.meta.json`, JSON.stringify({ contentType: input.contentType, metadata: input.metadata ?? {} }));
    return { key: input.key, sha256: createHash('sha256').update(input.body).digest('hex'), sizeBytes: input.body.length };
  }
  async getObject(key: string) {
    try {
      const body = await readFile(this.path(key));
      const meta = JSON.parse(await readFile(`${this.path(key)}.meta.json`, 'utf8')) as { contentType: string };
      return { body, contentType: meta.contentType };
    } catch { return null; }
  }
  async deleteObject(key: string) {
    await rm(this.path(key), { force: true });
    await rm(`${this.path(key)}.meta.json`, { force: true });
  }
  async headObject(key: string) {
    try {
      const s = await stat(this.path(key));
      const meta = JSON.parse(await readFile(`${this.path(key)}.meta.json`, 'utf8')) as { contentType: string };
      return { sizeBytes: s.size, contentType: meta.contentType };
    } catch { return null; }
  }
  async signedUrl(key: string, method: 'GET' | 'PUT', ttlSeconds: number): Promise<SignedUrl> {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign(key, method, exp);
    return { url: `${this.baseUrl}/storage/object?key=${encodeURIComponent(key)}&method=${method}&exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000).toISOString(), method };
  }
  sign(key: string, method: string, exp: number): string {
    return createHmac('sha256', this.secret).update(`${method}:${key}:${exp}`).digest('hex');
  }
  verify(key: string, method: string, exp: number, sig: string): boolean {
    if (exp < Math.floor(Date.now() / 1000)) return false;
    return this.sign(key, method, exp) === sig;
  }
}
