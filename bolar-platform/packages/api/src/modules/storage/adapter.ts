import { createStorageAdapter, LocalStorageAdapter, type StorageAdapter } from '@bolar/integrations';
import { errors } from '@bolar/shared';
import { config } from '../../config.js';

let cached: StorageAdapter | null = null;

/** Process-wide object storage adapter (Day 26). Local filesystem in dev/tests, S3/MinIO otherwise. */
export function storage(): StorageAdapter {
  if (cached) return cached;
  const cfg = config();
  cached = createStorageAdapter({
    ...process.env,
    STORAGE_DRIVER: cfg.STORAGE_DRIVER,
    STORAGE_BUCKET: cfg.STORAGE_BUCKET,
    STORAGE_LOCAL_ROOT: cfg.STORAGE_LOCAL_ROOT,
    AUTH_JWT_SECRET: cfg.AUTH_JWT_SECRET,
    API_BASE_URL: cfg.API_BASE_URL,
    STORAGE_ENDPOINT: cfg.STORAGE_ENDPOINT,
    STORAGE_REGION: cfg.STORAGE_REGION,
    STORAGE_ACCESS_KEY: cfg.STORAGE_ACCESS_KEY,
    STORAGE_SECRET_KEY: cfg.STORAGE_SECRET_KEY,
  });
  return cached;
}

/** Only the local driver serves /storage/object; S3 signed URLs point at the bucket directly. */
export function localStorage(): LocalStorageAdapter | null {
  const s = storage();
  return s instanceof LocalStorageAdapter ? s : null;
}

export function resetStorageForTests(): void {
  cached = null;
}

export function signedUrlTtlSeconds(): number {
  return config().STORAGE_SIGNED_URL_TTL_SECONDS;
}

/** Storage policy: every key lives under the owning org prefix so cross-tenant object access is impossible by construction. */
export function orgPrefix(tenantOrgId: string): string {
  return `org/${tenantOrgId}/`;
}

export function assertOrgKey(tenantOrgId: string, key: string): void {
  if (!key.startsWith(orgPrefix(tenantOrgId))) throw errors.forbidden('Storage key outside tenant prefix');
}

/** Normalize a user supplied file name into a storage-safe segment (no separators, no control chars). */
export function safeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 120);
  return cleaned || 'file';
}
