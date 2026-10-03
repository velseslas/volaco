#!/usr/bin/env node
/**
 * Lanceur de tests (ÉTAPE 3 + P0).
 *
 * 1. Isolation de la persistance : chaque exécution de `npm test` reçoit un
 *    VOLACO_DATA_DIR neuf (répertoire temporaire + base SQLite vierge). Sans
 *    cela, l'audit/usage désormais PERSISTANTS s'accumuleraient entre les
 *    exécutions et casseraient les assertions de comptage.
 *
 * 2. P0 — FRAÎCHEUR : les tests tournent sur dist (compilé). Si une source
 *    (.ts) est plus récente que dist, on RECOMPILE d'abord — un dist périmé
 *    faisait tester du code obsolète silencieusement.
 *
 * La production (npm start) ne définit pas VOLACO_DATA_DIR et utilise donc
 * la vraie base durable dans .volaco-data/.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'volaco-tests-'));
process.env.VOLACO_DATA_DIR = dataDir;

/** Plus récent mtime récursif d'un dossier (fichiers .ts/.json/.mjs). */
function newestMtime(dir) {
  let newest = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
      const full = join(d, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.mtimeMs > newest) newest = st.mtimeMs;
    }
  };
  if (existsSync(dir)) walk(dir);
  return newest;
}

// P0 — dist périmé ? (la plus récente source .ts vs le canary compilé)
const srcNewest = Math.max(
  newestMtime('packages'),
  newestMtime('apps/api')
);
const canary = 'dist/packages/core/src/config.js';
const distTime = existsSync(canary) ? statSync(canary).mtimeMs : 0;
if (srcNewest > distTime) {
  console.log('[run-tests] dist périmé — recompilation (tsc)…');
  rmSync('dist', { recursive: true, force: true });
  const build = spawnSync('npx', ['tsc'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (build.status !== 0) {
    console.error('[run-tests] échec de la recompilation — tests annulés.');
    process.exit(1);
  }
}

const args = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['dist/**/*.test.js'];
const result = spawnSync('node', ['--test', ...args], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32'
});

process.exit(result.status ?? 1);
