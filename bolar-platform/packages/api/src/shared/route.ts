import type { Request, Response, Router, NextFunction } from 'express';
import type { ZodTypeAny, z } from 'zod';
import './zod.js';
import { createHash } from 'node:crypto';
import { errors, type Permission, type RequestContext } from '@bolar/shared';
import { requireAuth } from './context.js';
import { requirePermission } from './access.js';
import { prisma } from './db.js';

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface RouteDef<P extends ZodTypeAny = ZodTypeAny, Q extends ZodTypeAny = ZodTypeAny, B extends ZodTypeAny = ZodTypeAny, R extends ZodTypeAny = ZodTypeAny> {
  method: Method;
  /** Express path, e.g. /properties/:id */
  path: string;
  operationId: string;
  summary: string;
  tags: string[];
  /** public: no actor needed; session: actor required; mfa: actor with MFA verified (if enabled). */
  auth: 'public' | 'session' | 'mfa';
  /** Coarse permission gate; fine-grained scoped/relationship checks happen in the handler via requireAccess. */
  permission?: Permission;
  /** Requires Idempotency-Key header; responses are replayed for identical payloads (p23). */
  idempotent?: boolean;
  request?: { params?: P; query?: Q; body?: B };
  responses: Record<number, R | null>;
  handler: (input: { params: z.infer<P>; query: z.infer<Q>; body: z.infer<B>; ctx: RequestContext; req: Request; res: Response }) => Promise<{ status?: number; body?: unknown } | void>;
}

/** Global registry consumed by scripts/generate-openapi.ts and contract tests. */
export const routeRegistry: RouteDef[] = [];

export function defineRoute<P extends ZodTypeAny, Q extends ZodTypeAny, B extends ZodTypeAny, R extends ZodTypeAny>(def: RouteDef<P, Q, B, R>): RouteDef {
  if (routeRegistry.some((r) => r.operationId === def.operationId)) throw new Error(`duplicate operationId ${def.operationId}`);
  const erased = def as unknown as RouteDef;
  routeRegistry.push(erased);
  return erased;
}

function parse<T extends ZodTypeAny>(schema: T | undefined, value: unknown, where: 'params' | 'query' | 'body'): z.infer<T> {
  if (!schema) return value as z.infer<T>;
  const r = schema.safeParse(value ?? {});
  if (!r.success) {
    throw errors.validation(r.error.issues.map((i) => ({ path: [where, ...i.path].join('.'), message: i.message })));
  }
  return r.data;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export function mount(router: Router, defs: RouteDef[]): void {
  for (const def of defs) {
    router[def.method](def.path, async (req: Request, res: Response, next: NextFunction) => {
      try {
        const ctx = req.ctx;
        if (def.auth !== 'public') requireAuth(ctx, def.auth);
        if (def.permission) requirePermission(ctx, def.permission);
        const params = parse(def.request?.params, req.params, 'params');
        const query = parse(def.request?.query, req.query, 'query');
        const body = parse(def.request?.body, req.body, 'body');

        let idemKey: string | null = null;
        let requestHash = '';
        if (def.idempotent) {
          idemKey = req.header('idempotency-key') ?? null;
          if (!idemKey || idemKey.length < 8 || idemKey.length > 128) throw errors.validation([{ path: 'headers.Idempotency-Key', message: 'Idempotency-Key header (8-128 chars) is required' }]);
          requestHash = createHash('sha256').update(JSON.stringify({ params, query, body })).digest('hex');
          const existing = await prisma.idempotencyKey.findUnique({ where: { scope_tenantOrgId_key: { scope: def.operationId, tenantOrgId: ctx.tenantOrgId ?? '', key: idemKey } } });
          if (existing && existing.expiresAt > new Date()) {
            if (existing.requestHash !== requestHash) throw errors.idempotencyConflict();
            if (existing.responseCode) {
              res.setHeader('Idempotent-Replayed', 'true');
              res.status(existing.responseCode).json(existing.responseBody);
              return;
            }
          }
        }

        const result = (await def.handler({ params, query, body, ctx, req, res })) ?? {};
        const status = result.status ?? (def.method === 'post' ? 201 : 200);
        if (idemKey) {
          await prisma.idempotencyKey.upsert({
            where: { scope_tenantOrgId_key: { scope: def.operationId, tenantOrgId: ctx.tenantOrgId ?? '', key: idemKey } },
            update: { responseCode: status, responseBody: (result.body ?? null) as never, requestHash, expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS) },
            create: { scope: def.operationId, tenantOrgId: ctx.tenantOrgId ?? '', key: idemKey, requestHash, responseCode: status, responseBody: (result.body ?? null) as never, expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS) },
          });
        }
        if (result.body === undefined) res.status(status === 201 ? 204 : status).end();
        else res.status(status).json(result.body);
      } catch (err) {
        next(err);
      }
    });
  }
}

/** Serialize Prisma rows: Date -> ISO string, Decimal -> number, drop secrets. */
export function toDto<T>(row: T, omit: string[] = []): T {
  if (row === null || row === undefined) return row;
  if (row instanceof Date) return row.toISOString() as unknown as T;
  if (Array.isArray(row)) return row.map((r) => toDto(r, omit)) as unknown as T;
  if (typeof row === 'object') {
    const anyRow = row as Record<string, unknown>;
    if (typeof (anyRow as { toNumber?: unknown }).toNumber === 'function') return Number((anyRow as { toNumber: () => number }).toNumber()) as unknown as T;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(anyRow)) {
      if (omit.includes(k) || k === 'passwordHash' || k === 'mfaSecret' || k === 'refreshTokenHash' || k === 'tokenHash') continue;
      out[k] = toDto(v, omit);
    }
    return out as T;
  }
  return row;
}
