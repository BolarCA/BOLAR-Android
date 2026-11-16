import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const idx = ALPHABET.indexOf(c); if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}
export function totpCode(secretB32: string, time = Date.now(), step = 30, digits = 6): string {
  const counter = Math.floor(time / 1000 / step);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const offset = h[h.length - 1]! & 0xf;
  const code = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(code % 10 ** digits).padStart(digits, '0');
}
/** Time step (30 s counter) that `code` matches within the window, or null. Constant-time comparison per candidate. */
export function matchTotp(secretB32: string, code: string, window = 1, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const given = Buffer.from(code);
  let matched: number | null = null;
  for (let i = -window; i <= window; i++) {
    const at = now + i * 30_000;
    const expected = Buffer.from(totpCode(secretB32, at));
    if (expected.length === given.length && timingSafeEqual(expected, given)) matched = Math.floor(at / 1000 / 30);
  }
  return matched;
}
export function verifyTotp(secretB32: string, code: string, window = 1): boolean {
  return matchTotp(secretB32, code, window) !== null;
}
export function otpauthUrl(secret: string, email: string, issuer = 'BOLAR'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}
