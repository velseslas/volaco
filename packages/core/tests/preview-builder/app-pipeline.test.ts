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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acquireProjectLock,
  buildApp,
  ensureWorkspace,
  listAppFiles,
  purgeOrphanWorkspaces,
  readAppFile,
  removeWorkspace,
  setProjectFormat,
  getProjectFormat,
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

  it('4b. marqueur de format : le DERNIER format généré gagne (fix régression)', () => {
    setProjectFormat(TEST_PROJECT, 'react-vite');
    assert.equal(getProjectFormat(TEST_PROJECT), 'react-vite');
    setProjectFormat(TEST_PROJECT, 'html');
    assert.equal(getProjectFormat(TEST_PROJECT), 'html', 'une génération HTML après une génération React bascule le format');
  });

  it('5. réinitialisation : ensureWorkspace(reset) rend le site frais', () => {
    writeAppFile(TEST_PROJECT, 'src/components/Temporaire.tsx', 'x');
    ensureWorkspace(TEST_PROJECT, true);
    assert.equal(existsSync(join(workspaceDir(TEST_PROJECT), 'src', 'components', 'Temporaire.tsx')), false, 'fichier temporaire parti');
  });

  it('6. P1-masse : verrou par projet — sections critiques sérialisées, projets distincts parallèles', async () => {
    const order: string[] = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const r1 = await acquireProjectLock('test-lock-01');
    const p1 = (async () => { order.push('a-in'); await sleep(80); order.push('a-out'); r1(); })();
    // Deuxième acquisition (même projet) : DOIT attendre la libération.
    const r2promise = acquireProjectLock('test-lock-01', { timeoutMs: 5000 });
    await sleep(20);
    let r2done = false;
    const p2 = r2promise.then((r2) => { r2done = true; order.push('b-in'); r2(); });
    await sleep(30);
    assert.equal(r2done, false, 'le 2e acquéreur attend (pas de passage en force)');
    await Promise.all([p1, p2]);
    assert.deepEqual(order, ['a-in', 'a-out', 'b-in'], 'ordre FIFO respecté');
    // Projet distinct : aucune attente.
    const r3 = await acquireProjectLock('test-lock-autre', { timeoutMs: 500 });
    r3();
  });

  it('7. P1-masse : timeout du verrou → 503 PROJECT_BUSY, file intacte derrière', async () => {
    const r1 = await acquireProjectLock('test-lock-02');
    await assert.rejects(
      acquireProjectLock('test-lock-02', { timeoutMs: 60 }),
      (err: unknown) => err instanceof Error && (err as { statusCode?: number }).statusCode === 503,
      'attente trop longue → 503, pas d’attente infinie'
    );
    r1();
    // La file coule après libération (le timeout n’a rien cassé).
    const r2 = await acquireProjectLock('test-lock-02', { timeoutMs: 1000 });
    r2();
  });

  it('8. P1-masse : build raté ne vide PLUS le preview (bascule atomique)', async () => {
    // État sain : build OK puis snapshot du bundle servi.
    ensureWorkspace(TEST_PROJECT, true);
    writeAppFile(TEST_PROJECT, 'src/App.tsx', 'export default function App() { return <div>Atomic OK</div>; }');
    const good = await buildApp(TEST_PROJECT);
    assert.equal(good.ok, true, 'préparation : ' + good.errors.join(' | '));
    const ws = workspaceDir(TEST_PROJECT);
    const before = readFileSync(join(ws, 'dist', 'index.html'), 'utf8');
    assert.ok(before.includes('Atomic OK'));
    // On casse une source puis on rebuild : échec SANS toucher au dist servi.
    writeAppFile(TEST_PROJECT, 'src/App.tsx', 'ceci n’est pas du TSX ((((');
    const bad = await buildApp(TEST_PROJECT);
    assert.equal(bad.ok, false, 'le build cassé échoue honnêtement');
    const after = readFileSync(join(ws, 'dist', 'index.html'), 'utf8');
    assert.equal(after, before, 'l’ancien bundle reste servi tel quel (pas de 404)');
    const leftovers = readdirSync(ws).filter((n: string) => n.startsWith('dist-next-') || n === 'dist-prev');
    assert.deepEqual(leftovers, [], 'aucun répertoire temporaire résiduel');
    // Remise en état pour les prochaines exécutions.
    ensureWorkspace(TEST_PROJECT, true);
  });

  it('9. MÉNAGE : purge des workspaces orphelins (bac à sable isolé, jamais le réel)', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join: joinPath } = await import('node:path');
    const root = mkdtempSync(joinPath(tmpdir(), 'volaco-purge-'));
    mkdirSync(joinPath(root, 'proj_garde'));
    mkdirSync(joinPath(root, 'proj_orphelin'));
    mkdirSync(joinPath(root, 'test-tiret_ok'));
    writeFileSync(joinPath(root, 'proj_garde.format.json'), '{}');
    writeFileSync(joinPath(root, 'proj_orphelin.format.json'), '{}');
    writeFileSync(joinPath(root, 'weird.name'), 'x'); // nom non sûr : jamais touché
    const out = purgeOrphanWorkspaces(new Set(['proj_garde']), root);
    assert.deepEqual(out.removedDirs.sort(), ['proj_orphelin', 'test-tiret_ok'], 'tout inconnu au nom sûr part');
    assert.deepEqual(out.removedMarkers, ['proj_orphelin.format.json']);
    assert.ok(existsSync(joinPath(root, 'proj_garde')), 'le connu survit');
    assert.ok(existsSync(joinPath(root, 'proj_garde.format.json')), 'son marqueur survit');
    assert.ok(existsSync(joinPath(root, 'weird.name')), 'nom non sûr intouché');
  });

  it('10. MÉNAGE : removeWorkspace supprime dossier + marqueur (best effort)', () => {
    ensureWorkspace('test-menage-ws-01', true);
    mkdirSync(join(workspaceDir('test-menage-ws-01'), 'dist'), { recursive: true });
    writeFileSync(join(workspaceDir('test-menage-ws-01'), 'dist', 'x.txt'), 'x');
    assert.equal(removeWorkspace('test-menage-ws-01'), true);
    assert.equal(existsSync(workspaceDir('test-menage-ws-01')), false);
    assert.equal(removeWorkspace('test-menage-ws-01'), true, 're-suppression : toujours true, jamais d’erreur');
    assert.equal(removeWorkspace('../evil'), false, 'traversée refusée');
  });
});
