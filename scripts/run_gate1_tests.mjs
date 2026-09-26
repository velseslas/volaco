import { spawnSync } from 'node:child_process';

// Always validate a freshly compiled tree; never trust stale dist artifacts.
const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
if (build.status !== 0) {
  console.error('\n❌ Échec du clean build avant la Quality Gate 1 !');
  process.exit(build.status ?? 1);
}

const gate1Files = [
  'dist/packages/core/tests/bootstrap.test.js',
  'dist/apps/api/tests/api.test.js',
  'dist/packages/core/tests/core.test.js',
  'dist/packages/core/tests/identity.test.js',
  'dist/apps/api/tests/tenancy.test.js',
  'dist/packages/core/tests/model.test.js',
  'dist/apps/api/tests/revisions.test.js',
  'dist/packages/core/tests/observability.test.js',
  'dist/apps/api/tests/observability-api.test.js'
];

console.log('==================================================');
console.log('🛡️  EXÉCUTION DE LA QUALITY GATE 1 (NON-RÉGRESSION)');
console.log('    Phase 1 : 9 suites de tests historiques (31 tests)');
console.log('==================================================');

const res = spawnSync(process.execPath, ['--test', ...gate1Files], { stdio: 'inherit' });
if (res.status !== 0) {
  console.error('\n❌ Échec de la Quality Gate 1 !');
  process.exit(res.status ?? 1);
}

console.log('\n✅ QUALITY GATE 1 VALIDÉE AVEC SUCCÈS (31/31 PASS) !');
process.exit(0);
