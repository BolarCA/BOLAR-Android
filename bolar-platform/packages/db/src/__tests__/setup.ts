import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
for (const c of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) if (existsSync(c)) loadEnv({ path: c, quiet: true });
