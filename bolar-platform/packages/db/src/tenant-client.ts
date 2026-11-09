import { Prisma, type PrismaClient } from '@prisma/client';
import { errors } from '@bolar/shared';

/** Models that carry tenantOrgId, derived from the DMMF so new models are covered automatically. */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'tenantOrgId'))
    .map((m) => m.name),
);

type AnyArgs = { where?: Record<string, unknown>; data?: unknown; create?: unknown } & Record<string, unknown>;

function withTenantWhere(args: AnyArgs, tenantOrgId: string): AnyArgs {
  return { ...args, where: { ...(args.where ?? {}), tenantOrgId } };
}

function withTenantData(args: AnyArgs, tenantOrgId: string): AnyArgs {
  const data = args.data;
  if (Array.isArray(data)) return { ...args, data: data.map((d) => ({ ...(d as object), tenantOrgId })) };
  if (data && typeof data === 'object') return { ...args, data: { ...(data as object), tenantOrgId } };
  return args;
}

/**
 * Tenant-scoped Prisma client (blueprint Day 8 "tenant-scoped query helper").
 * Every read is filtered by tenantOrgId, every create stamps it, and unique
 * lookups/updates/deletes for another tenant's row behave as not-found.
 */
export function forTenant(client: PrismaClient, tenantOrgId: string) {
  if (!tenantOrgId) throw errors.forbidden('Tenant context missing');
  return client.$extends({
    name: `tenant:${tenantOrgId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) return query(args);
          const a = (args ?? {}) as AnyArgs;
          switch (operation) {
            case 'findMany':
            case 'findFirst':
            case 'findFirstOrThrow':
            case 'count':
            case 'aggregate':
            case 'groupBy':
            case 'updateMany':
            case 'deleteMany':
              return query(withTenantWhere(a, tenantOrgId) as never);
            case 'create':
            case 'createMany':
            case 'createManyAndReturn':
              return query(withTenantData(a, tenantOrgId) as never);
            case 'findUnique':
            case 'findUniqueOrThrow': {
              const row = (await query(args)) as { tenantOrgId?: string } | null;
              if (row && row.tenantOrgId !== tenantOrgId) {
                if (operation === 'findUniqueOrThrow') throw errors.notFound();
                return null;
              }
              return row;
            }
            case 'update':
            case 'delete': {
              // Pre-check ownership without leaking existence.
              const delegate = (client as unknown as Record<string, { findFirst: (x: unknown) => Promise<unknown> }>)[
                model.charAt(0).toLowerCase() + model.slice(1)
              ];
              const exists = delegate ? await delegate.findFirst({ where: { ...(a.where ?? {}), tenantOrgId }, select: { id: true } }) : null;
              if (!exists) throw errors.notFound();
              return query(args);
            }
            case 'upsert': {
              const create = a.create && typeof a.create === 'object' ? { ...(a.create as object), tenantOrgId } : a.create;
              const delegate = (client as unknown as Record<string, { findFirst: (x: unknown) => Promise<unknown> }>)[
                model.charAt(0).toLowerCase() + model.slice(1)
              ];
              const existing = delegate ? await delegate.findFirst({ where: a.where, select: { id: true, tenantOrgId: true } }) : null;
              if (existing && (existing as { tenantOrgId: string }).tenantOrgId !== tenantOrgId) throw errors.notFound();
              return query({ ...a, create } as never);
            }
            default:
              return query(args);
          }
        },
      },
    },
  });
}

export type TenantPrisma = ReturnType<typeof forTenant>;
