/**
 * PostgreSQL row-level security helpers (ADR 0005, blueprint Days 91-104 "defense in depth").
 *
 * The migration `rls_policies` enables RLS on every table that carries `tenantOrgId` and adds a policy
 *   USING ("tenantOrgId" = current_setting('app.tenant_id', true))
 * (tables whose tenantOrgId is nullable also admit NULL rows: global templates, platform flags, platform defaults).
 * The owner/migration role keeps a permissive policy and, being the table owner, bypasses RLS anyway; enforcement
 * only bites when the API connects as a non-owner role such as `bolar_app`.
 *
 * `withTenantRls` runs a callback inside a transaction after setting the transaction-local `app.tenant_id`.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

export const RLS_TENANT_SETTING = 'app.tenant_id';
export const RLS_APP_ROLE = 'bolar_app';
export const RLS_POLICY_TENANT = 'tenant_isolation';
export const RLS_POLICY_OWNER = 'owner_bypass';

/** Client that can run the callback: a `$transaction` client or a full PrismaClient (both expose the model delegates). */
export type RlsTx = Prisma.TransactionClient;

export interface RlsTableInfo { model: string; table: string; nullableTenant: boolean }

/** Tables that carry tenantOrgId, from the DMMF (same source as `TENANT_SCOPED_MODELS`). */
export function rlsTables(): RlsTableInfo[] {
  return Prisma.dmmf.datamodel.models
    .map((m) => ({ m, f: m.fields.find((f) => f.name === 'tenantOrgId') }))
    .filter((x): x is { m: (typeof Prisma.dmmf.datamodel.models)[number]; f: NonNullable<typeof x.f> } => !!x.f)
    .map(({ m, f }) => ({ model: m.name, table: m.dbName ?? m.name, nullableTenant: !f.isRequired }));
}

/** Predicate used by the tenant policy for a table. */
export function rlsPredicate(t: RlsTableInfo): string {
  const eq = `"tenantOrgId" = current_setting('${RLS_TENANT_SETTING}', true)`;
  return t.nullableTenant ? `("tenantOrgId" IS NULL OR ${eq})` : eq;
}

/**
 * Idempotent SQL for the `rls_policies` migration. Kept here so a test can diff the committed migration against
 * the schema: adding a tenant-scoped model without extending the policies fails `pnpm --filter @bolar/db test`.
 */
export function rlsPolicySql(tables: RlsTableInfo[] = rlsTables()): string {
  const lines: string[] = [
    '-- Row-level security as defense in depth (ADR 0005). Generated from the Prisma schema by packages/db/src/rls.ts.',
    `-- Application role: NOLOGIN by default. Staging/prod create a LOGIN member, e.g.`,
    `--   CREATE ROLE bolar_app_login LOGIN PASSWORD '<secret>' IN ROLE ${RLS_APP_ROLE};`,
    `-- and point DATABASE_URL at it with DB_RLS_ENFORCE=1.`,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RLS_APP_ROLE}') THEN CREATE ROLE ${RLS_APP_ROLE} NOLOGIN; END IF; END $$;`,
    `GRANT USAGE ON SCHEMA public TO ${RLS_APP_ROLE};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RLS_APP_ROLE};`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${RLS_APP_ROLE};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${RLS_APP_ROLE};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${RLS_APP_ROLE};`,
    '',
  ];
  for (const t of tables) {
    const p = rlsPredicate(t);
    lines.push(`-- ${t.model}${t.nullableTenant ? ' (nullable tenantOrgId: NULL rows are global)' : ''}`);
    lines.push(`ALTER TABLE "${t.table}" ENABLE ROW LEVEL SECURITY;`);
    lines.push(`DROP POLICY IF EXISTS ${RLS_POLICY_TENANT} ON "${t.table}";`);
    lines.push(`CREATE POLICY ${RLS_POLICY_TENANT} ON "${t.table}" FOR ALL TO ${RLS_APP_ROLE} USING (${p}) WITH CHECK (${p});`);
    lines.push(`DROP POLICY IF EXISTS ${RLS_POLICY_OWNER} ON "${t.table}";`);
    lines.push(`DO $$ BEGIN EXECUTE format('CREATE POLICY ${RLS_POLICY_OWNER} ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', '${t.table}', current_user); END $$;`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Run `fn` with `app.tenant_id` set for the transaction (SET LOCAL semantics via set_config(..., true)).
 * Works with any client; enforcement requires the connection role to be subject to RLS (non-owner, non-superuser).
 */
export async function withTenantRls<T>(client: PrismaClient, tenantOrgId: string, fn: (tx: RlsTx) => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
  if (!tenantOrgId) throw new Error('withTenantRls: tenantOrgId is required');
  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config(${RLS_TENANT_SETTING}, ${tenantOrgId}, true)`;
      return fn(tx);
    },
    { timeout: opts.timeoutMs ?? 15_000 },
  );
}

/** Current tenant setting on this connection (diagnostics/tests). */
export async function currentTenantSetting(client: RlsTx | PrismaClient): Promise<string | null> {
  const rows = await client.$queryRaw<Array<{ v: string | null }>>`SELECT current_setting(${RLS_TENANT_SETTING}, true) AS v`;
  const v = rows[0]?.v ?? null;
  return v === '' ? null : v;
}
