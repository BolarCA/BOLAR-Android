import { Prisma, type PrismaClient } from '@prisma/client';
import { errors } from '@bolar/shared';
import { RLS_TENANT_SETTING, withTenantRls } from './rls.js';

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
export interface ForTenantOptions {
  /**
   * Run every operation on this transaction client instead of the base client, so tenant-scoped reads and writes
   * inside `prisma.$transaction(async (tx) => ...)` see the transaction's own uncommitted rows. With `rls` the
   * `app.tenant_id` setting is applied to the transaction once (SET LOCAL semantics) rather than opening a nested one.
   */
  tx?: Prisma.TransactionClient;
  /**
   * Opt-in row-level security (ADR 0005, DB_RLS_ENFORCE=1): reads (findMany/findFirst/findFirstOrThrow/count/
   * aggregate/groupBy) run inside a transaction that sets `app.tenant_id`, so PostgreSQL policies filter rows
   * even if the where-clause injection were bypassed. Writes keep the application-level stamping; the DB policy's
   * WITH CHECK still rejects cross-tenant rows when the connection role is subject to RLS.
   */
  rls?: boolean;
}

const RLS_READ_OPERATIONS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy']);

type Delegate = Record<string, (x: unknown) => Promise<unknown>> & { findFirst: (x: unknown) => Promise<unknown> };

/** Model delegate (`client.property`, `tx.lease`, ...) for a DMMF model name. */
function delegateFor(client: unknown, model: string): Delegate {
  const d = (client as Record<string, Delegate | undefined>)[model.charAt(0).toLowerCase() + model.slice(1)];
  if (!d) throw new Error(`forTenant: no delegate for model ${model}`);
  return d;
}

/** Transactions on which `app.tenant_id` has already been set (one SET LOCAL per transaction). */
const rlsConfigured = new WeakSet<object>();

export function forTenant(client: PrismaClient, tenantOrgId: string, options: ForTenantOptions = {}) {
  if (!tenantOrgId) throw errors.forbidden('Tenant context missing');
  const rls = options.rls === true;
  const tx = options.tx ?? null;
  return client.$extends({
    name: `tenant:${tenantOrgId}${rls ? ':rls' : ''}${tx ? ':tx' : ''}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) return query(args);
          const a = (args ?? {}) as AnyArgs;
          // Where the statement runs: the caller's transaction when given, else the base client via `query`.
          const run = async (scoped: unknown): Promise<unknown> => (tx ? delegateFor(tx, model)[operation]!(scoped) : query(scoped as never));
          const lookup = tx ?? client;
          if (rls && RLS_READ_OPERATIONS.has(operation)) {
            // Defense in depth: same tenant where-clause, executed under SET LOCAL app.tenant_id.
            const scoped = withTenantWhere(a, tenantOrgId);
            if (tx) {
              if (!rlsConfigured.has(tx)) {
                await tx.$executeRaw`SELECT set_config(${RLS_TENANT_SETTING}, ${tenantOrgId}, true)`;
                rlsConfigured.add(tx);
              }
              return run(scoped);
            }
            return withTenantRls(client, tenantOrgId, async (t) => delegateFor(t, model)[operation]!(scoped));
          }
          switch (operation) {
            case 'findMany':
            case 'findFirst':
            case 'findFirstOrThrow':
            case 'count':
            case 'aggregate':
            case 'groupBy':
            case 'updateMany':
            case 'updateManyAndReturn':
            case 'deleteMany':
              return run(withTenantWhere(a, tenantOrgId));
            case 'create':
            case 'createMany':
            case 'createManyAndReturn':
              return run(withTenantData(a, tenantOrgId));
            case 'findUnique':
            case 'findUniqueOrThrow': {
              const row = (await run(args)) as { tenantOrgId?: string } | null;
              if (row && row.tenantOrgId !== tenantOrgId) {
                if (operation === 'findUniqueOrThrow') throw errors.notFound();
                return null;
              }
              return row;
            }
            case 'update':
            case 'delete': {
              // Pre-check ownership without leaking existence.
              const exists = await delegateFor(lookup, model).findFirst({ where: { ...(a.where ?? {}), tenantOrgId }, select: { id: true } });
              if (!exists) throw errors.notFound();
              return run(args);
            }
            case 'upsert': {
              const create = a.create && typeof a.create === 'object' ? { ...(a.create as object), tenantOrgId } : a.create;
              const existing = await delegateFor(lookup, model).findFirst({ where: a.where, select: { id: true, tenantOrgId: true } });
              if (existing && (existing as { tenantOrgId: string }).tenantOrgId !== tenantOrgId) throw errors.notFound();
              return run({ ...a, create });
            }
            default:
              // Every model operation Prisma exposes is listed above; refuse anything new rather than run it unscoped.
              throw new Error(`forTenant: operation ${model}.${operation} is not tenant-scoped; add it to tenant-client.ts`);
          }
        },
      },
    },
  });
}

export type TenantPrisma = ReturnType<typeof forTenant>;
