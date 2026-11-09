import 'dotenv/config';
process.env.NODE_ENV = 'test';
process.env.QUEUE_DRIVER = 'memory';
process.env.AUTH_JWT_SECRET ??= 'test_secret_test_secret_test_secret_test_secret_0000';
process.env.DATABASE_URL ??= 'postgresql://bolar@localhost:5432/bolar?schema=public';
process.env.LOG_LEVEL = 'silent';
