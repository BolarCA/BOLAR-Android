import { execSync } from 'node:child_process';

export default async function globalSetup() {
  const root = process.cwd();
  const env = { ...process.env };
  execSync('pnpm db:migrate', { cwd: root, stdio: 'inherit', env });
  execSync('pnpm db:seed', { cwd: root, stdio: 'inherit', env });
  execSync('pnpm db:seed:demo', { cwd: root, stdio: 'inherit', env });
}
