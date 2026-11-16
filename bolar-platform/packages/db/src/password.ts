import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

function scrypt(password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}
const N = 16384, r = 8, p = 1, KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, n, rr, pp, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !n || !rr || !pp || !saltB64 || !keyB64) return false;
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(keyB64, 'base64url');
  const key = await scrypt(password, salt, expected.length, { N: Number(n), r: Number(rr), p: Number(pp) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
