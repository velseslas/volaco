/**
 * P1/P2 — PIPELINE D'APPLICATIONS REACT RÉELLES (app-pipeline).
 *
 * Le standard premium : la génération produit un VRAI projet Vite+React+TS
 * multi-fichiers, construit côté serveur, assemblé en bundle AUTONOME
 * (scripts + styles inlinés) exécutable dans l'iframe sandboxée du preview
 * (origine opaque, aucun fetch réseau requis).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildApp,
  ensureWorkspace,
  listAppFiles,
  readAppFile,
  workspaceDir,
  writeAppFile
} from '../../src/app-pipeline.js';

const TEST_PROJECT = 'test-app-pipeline-01';

describe('P1/P2 : pipeline d applications React réelles', () => {
  it('1. ensureWorkspace copie le template (package.json, index.html, src/)', () => {
    const ws = ensureWorkspace(TEST_PROJECT, true);
    assert.ok(existsSync(join(ws, 'package.json')), 'package.json épinglé');
    assert.ok(existsSync(join(ws, 'index.html')), 'index.html');
    assert.ok(existsSync(join(ws, 'src', 'main.tsx')), 'main.tsx');
    assert.ok(existsSync(join(ws, 'src', 'App.tsx')), 'App.tsx');
    assert.ok(readFileSync(join(ws, 'src', 'index.css'), 'utf8').includes('@import "tailwindcss"'), 'Tailwind branché');
  });

  it('2. writeAppFile : écrit sous src/, refuse le reste', () => {
    assert.equal(writeAppFile(TEST_PROJECT, 'src/components/Header.tsx', '<div/>').ok, true);
    assert.equal(writeAppFile(TEST_PROJECT, '../evasion.ts', 'x').ok, false, 'path traversal refusé');
    assert.equal(writeAppFile(TEST_PROJECT, 'README.md', 'x').ok, false, 'racine non autorisée');
    assert.equal(readAppFile(TEST_PROJECT, 'src/components/Header.tsx'), '<div/>');
  });

  it('3. buildApp : build Vite réussi + bundle AUTONOME (scripts et styles inlinés)', async () => {
    const result = await buildApp(TEST_PROJECT);
    assert.equal(result.ok, true, 'build sans erreur : ' + result.errors.join(' | '));
    const html = readFileSync(join(workspaceDir(TEST_PROJECT), 'dist', 'index.html'), 'utf8');
    assert.ok(html.includes('<script type="module">'), 'JS inliné (pas de src externe)');
    assert.ok(html.includes('<style>'), 'CSS inliné');
    assert.ok(!html.includes('src="./assets/'), 'plus aucune référence réseau');
    assert.ok(!/<link[^>]*rel="stylesheet"/.test(html), 'plus de link stylesheet (le texte peut exister dans le runtime React inliné)');
    // le bundle embarque React (runtime présent dans le JS inliné)
    assert.ok(html.length > 100000, 'le bundle embarque le runtime React');
  });

  it('4. listAppFiles : les sources créées sont listées, node_modules/dist exclus', () => {
    const files = listAppFiles(TEST_PROJECT);
    const paths = files.map((f: { path: string }) => f.path);
    assert.ok(paths.includes('src/components/Header.tsx'), 'source créée listée');
    assert.ok(!paths.some((p: string) => p.startsWith('dist/')), 'dist exclu');
    assert.ok(!paths.some((p: string) => p.startsWith('node_modules/')), 'node_modules exclu');
  });

  it('5. réinitialisation : ensureWorkspace(reset) rend le site frais', () => {
    writeAppFile(TEST_PROJECT, 'src/components/Temporaire.tsx', 'x');
    ensureWorkspace(TEST_PROJECT, true);
    assert.equal(existsSync(join(workspaceDir(TEST_PROJECT), 'src', 'components', 'Temporaire.tsx')), false, 'fichier temporaire parti');
  });
});
