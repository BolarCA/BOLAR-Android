import { LocalStorageAdapter } from './local.js';
import { S3StorageAdapter } from './s3.js';
import type { StorageAdapter } from './types.js';
export * from './types.js';
export { LocalStorageAdapter, S3StorageAdapter };

export function createStorageAdapter(env: NodeJS.ProcessEnv = process.env): StorageAdapter {
  if ((env.STORAGE_DRIVER ?? 'local') === 's3') return new S3StorageAdapter(env.STORAGE_BUCKET ?? 'bolar', env);
  return new LocalStorageAdapter(env.STORAGE_LOCAL_ROOT ?? '.storage', env.AUTH_JWT_SECRET ?? 'local-storage-secret', env.API_BASE_URL ?? 'http://localhost:4000');
}
