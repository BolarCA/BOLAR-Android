import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageAdapter, PutObjectInput, SignedUrl } from './types.js';
import { requireEnv } from '../adapter.js';

/** S3-compatible storage (AWS S3 or MinIO). */
export class S3StorageAdapter implements StorageAdapter {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  constructor(private readonly bucket: string, env: NodeJS.ProcessEnv = process.env) {
    requireEnv('s3', env, ['STORAGE_REGION', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY']);
    this.client = new S3Client({
      region: env.STORAGE_REGION,
      endpoint: env.STORAGE_ENDPOINT || undefined,
      forcePathStyle: Boolean(env.STORAGE_ENDPOINT),
      credentials: { accessKeyId: env.STORAGE_ACCESS_KEY!, secretAccessKey: env.STORAGE_SECRET_KEY! },
    });
  }
  async putObject(input: PutObjectInput) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: input.key, Body: input.body, ContentType: input.contentType, Metadata: input.metadata, ServerSideEncryption: 'AES256' }));
    return { key: input.key, sha256: createHash('sha256').update(input.body).digest('hex'), sizeBytes: input.body.length };
  }
  async getObject(key: string) {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = Buffer.from(await out.Body!.transformToByteArray());
      return { body, contentType: out.ContentType ?? 'application/octet-stream' };
    } catch { return null; }
  }
  async deleteObject(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
  async headObject(key: string) {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: out.ContentLength ?? 0, contentType: out.ContentType ?? 'application/octet-stream' };
    } catch { return null; }
  }
  async signedUrl(key: string, method: 'GET' | 'PUT', ttlSeconds: number): Promise<SignedUrl> {
    const cmd = method === 'GET' ? new GetObjectCommand({ Bucket: this.bucket, Key: key }) : new PutObjectCommand({ Bucket: this.bucket, Key: key });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds });
    return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(), method };
  }
}
