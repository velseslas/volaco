#!/usr/bin/env node
/**
 * Lanceur de tests (ÉTAPE 3).
 *
 * Isole la persistance des tests : chaque exécution de `npm test` reçoit un
 * VOLACO_DATA_DIR neuf (répertoire temporaire + base SQLite vierge). Sans
 * cela, l'audit/usage désormais PERSISTANTS s'accumuleraient entre les
 * exécutions et casseraient les assertions de comptage.
 *
 * La production (npm start) ne définit pas VOLACO_DATA_DIR et utilise donc
 * la vraie base durable dans .volaco-data/.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'volaco-tests-'));
process.env.VOLACO_DATA_DIR = dataDir;

const args = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['dist/**/*.test.js'];
const result = spawnSync('node', ['--test', ...args], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32'
});

process.exit(result.status ?? 1);
