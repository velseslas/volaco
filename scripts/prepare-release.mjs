import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, process.argv[2] ?? '../volaco-release');

const protectedRuntime = [
  'dist',
  'apps',
  'packages',
  'scripts',
  'patch',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'RELEASE-POLICY.md',
];

const excluded = new Set([
  'node_modules', '.git', '.volaco_data', '.volaco-data', '.volaco_test_data',
  '.env', '.env.local', '.env.development', '.env.production',
  'BACKUP-STABLE-20260925', 'BACKUP-ETAT-STABLE-20260925-014926',
  'scratch', 'tmp', 'coverage', 'playwright-report', 'test-results'
]);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const entries = await (await import('node:fs/promises')).readdir(root, { withFileTypes: true });
for (const entry of entries) {
  if (excluded.has(entry.name)) continue;
  await cp(path.join(root, entry.name), path.join(output, entry.name), {
    recursive: entry.isDirectory(),
    force: true,
    errorOnExist: false,
  });
}

console.log(`Release prepared: ${output}`);
console.log('Protected runtime directory copied as-is: dist/');
console.log('Excluded local/runtime artifacts: node_modules, .env*, .volaco_*, backups, scratch, coverage, test reports.');
