export interface PutObjectInput { key: string; body: Buffer; contentType: string; metadata?: Record<string, string> }
export interface SignedUrl { url: string; expiresAt: string; method: 'GET' | 'PUT' }

/** Object storage boundary (Day 26). Local filesystem for dev/tests, S3/MinIO for staging. */
export interface StorageAdapter {
  readonly driver: 'local' | 's3';
  putObject(input: PutObjectInput): Promise<{ key: string; sha256: string; sizeBytes: number }>;
  getObject(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  deleteObject(key: string): Promise<void>;
  headObject(key: string): Promise<{ sizeBytes: number; contentType: string } | null>;
  /** Signed URL honoring TTL; local driver returns a token URL served by the API. */
  signedUrl(key: string, method: 'GET' | 'PUT', ttlSeconds: number): Promise<SignedUrl>;
}
