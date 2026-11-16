/**
 * Day 8/14 "migration test": apply all migrations to a scratch database, confirm status is clean,
 * then drop it. Exercises forward migrations end to end without touching the dev database.
 */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { Client } from 'pg';

const base = process.env.DATABASE_URL ?? 'postgresql://bolar:local_only@localhost:5432/bolar';
const u = new URL(base);
const scratch = `bolar_migrate_test_${Date.now()}`;
const admin = new Client({ connectionString: base });
await admin.connect();
await admin.query(`CREATE DATABASE "${scratch}"`);
await admin.end();
u.pathname = `/${scratch}`;
const url = u.toString();
try {
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
  execSync('npx prisma migrate status', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
  console.info(`[migrate-test] OK on ${scratch}`);
} finally {
  const drop = new Client({ connectionString: base });
  await drop.connect();
  await drop.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`);
  await drop.end();
}
