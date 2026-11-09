import { Router } from 'express';
import { z } from '@bolar/contracts';
import { defineRoute, mount } from '../../shared/route.js';
import { prisma } from '../../shared/db.js';

const healthResponse = z.object({ status: z.enum(['ok', 'degraded']), checks: z.record(z.string(), z.enum(['ok', 'fail'])), version: z.string(), requestId: z.string() }).openapi('Health');

export const healthRoutes = [
  defineRoute({
    method: 'get', path: '/health', operationId: 'getHealth', summary: 'Liveness and dependency health', tags: ['health'], auth: 'public',
    responses: { 200: healthResponse },
    handler: async ({ ctx }) => {
      const checks: Record<string, 'ok' | 'fail'> = {};
      try { await prisma.$queryRaw`SELECT 1`; checks.database = 'ok'; } catch { checks.database = 'fail'; }
      const status = Object.values(checks).every((c) => c === 'ok') ? 'ok' : 'degraded';
      return { status: status === 'ok' ? 200 : 503, body: { status, checks, version: process.env.npm_package_version ?? '0.1.0', requestId: ctx.requestId } };
    },
  }),
];

export const healthRouter: Router = Router();
mount(healthRouter, healthRoutes);
