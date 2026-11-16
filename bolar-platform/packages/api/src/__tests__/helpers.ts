import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { TEST_PASSWORD, type UserFixture } from '@bolar/testing';

export { TEST_PASSWORD };
let app: Express | null = null;
export function testApp(): Express {
  app ??= createApp();
  return app;
}

export async function loginAs(user: UserFixture, orgSlug?: string) {
  const res = await request(testApp()).post('/auth/login').send({ email: user.email, password: TEST_PASSWORD, ...(orgSlug ? { orgSlug } : {}) });
  if (res.status !== 200) throw new Error(`login failed for ${user.email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { accessToken: string; refreshToken: string; mfaRequired: boolean };
}

export function authed(token: string, extra: Record<string, string> = {}) {
  const agent = request(testApp());
  const wrap = (m: 'get' | 'post' | 'patch' | 'delete' | 'put') => (url: string) => {
    let r = agent[m](url).set('Authorization', `Bearer ${token}`);
    for (const [k, v] of Object.entries(extra)) r = r.set(k, v);
    return r;
  };
  return { get: wrap('get'), post: wrap('post'), patch: wrap('patch'), delete: wrap('delete'), put: wrap('put') };
}

export async function asUser(user: UserFixture, extra: Record<string, string> = {}) {
  const { accessToken } = await loginAs(user);
  return authed(accessToken, extra);
}
