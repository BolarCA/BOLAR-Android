/** `pnpm docs:lint` - every markdown doc has a title, no TODO placeholders, and local links resolve. */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const files: string[] = [];
function walk(d: string) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (f === 'node_modules' || f.startsWith('.')) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.md')) files.push(p);
  }
}
walk(join(root, 'docs'));
files.push(join(root, 'README.md'));
let failed = false;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  if (!/^# .+/m.test(text)) { console.error(`[docs:lint] ${f}: missing H1 title`); failed = true; }
  if (/\bTBD\b|\bTODO\b|lorem ipsum/i.test(text)) { console.error(`[docs:lint] ${f}: placeholder text found`); failed = true; }
  for (const m of text.matchAll(/\]\((?!https?:|mailto:|#)([^)#]+)(#[^)]*)?\)/g)) {
    const target = resolve(dirname(f), m[1]!);
    if (!existsSync(target)) { console.error(`[docs:lint] ${f}: broken link ${m[1]}`); failed = true; }
  }
}
if (failed) process.exit(1);
console.info(`[docs:lint] OK (${files.length} files)`);
