/**
 * PATCH-R3-A — la porte d'images ferme le pipeline MCP de publication.
 *
 * Chaîne corrigée : http /api/v1/mcp/call → project.fs_write (insp. avant
 * écriture) → project.app_build (insp. du workspace réel avant build) →
 * /preview-bundle (dist). Trois niveaux de preuve :
 *   1. UNIT — les gardes exportées (contracte de refus, aucun faux refus).
 *   2. OUTILS — processus stdio réel (spawn du serveur compilé du snapshot).
 *   3. E2E HTTP — la route réelle /api/v1/mcp/call + /preview-bundle.
 *
 * Politique undetermined (documentée) : seules les VIOLATIONS bloquent —
 * identique à génération/édition/rollback ; jamais déclaré conforme.
 */

import './_lot-b-secret-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

// MCP-TEST-ISOLATION-001 — Lot A : DOIT rester le PREMIER import de la
// suite (base SQLite isolée, jamais .volaco-data ; serveur importé
// dynamiquement après la fixation de AUTH_SECRET).
import { isolatedVolacoDataDir } from './mcp-remote-isolated-env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpStdioClient } from '../../../packages/core/src/mcp/client.js';
import {
  collectMcpInspectSources,
  mcpGuardInspectCandidate,
  mcpGuardInspectWorkspace
} from '../../../packages/core/src/mcp/project-server.js';
import { writeAppFile } from '../../../packages/core/src/app-pipeline.js';
import { signToken } from '../../../packages/core/src/identity/user-store.js';

/** Clé HMAC JWT : fixée AVANT le premier usage (Lot A — identité individuelle). */
process.env.AUTH_SECRET = 'volaco-test-lota-' + 'jwt-secret-'.repeat(4);

// Racine du dépôt de test (snapshot) : out/apps/api/tests → up^4 = racine snapshot.
const hereTests = dirname(fileURLToPath(import.meta.url));
const snapRoot = resolve(hereTests, '..', '..', '..', '..');
// Lot A — serveur MCP compilé FRAIS du snapshot (out/) prioritaire : le
// repli historique dist/ reste valable hors snapshot (comportement original,
// m résolution utilisée par routes/mcp.ts).
const mcpOutServer = join(snapRoot, 'out', 'packages', 'core', 'src', 'mcp', 'project-server.js');
const mcpServerPath = existsSync(mcpOutServer)
  ? mcpOutServer
  : join(snapRoot, 'dist', 'packages', 'core', 'src', 'mcp', 'project-server.js');
const wsRoot = join(snapRoot, 'workspace');

const CONFORM_TSX = 'export default function App() {\n'
  + '  return (\n'
  + '    <main className="mx-auto max-w-3xl p-8">\n'
  + '      <h1 className="mcpok text-2xl">R3A-conforme</h1>\n'
  + '      <img src="https://picsum.photos/seed/r3agate/800/500" alt="neutre" />\n'
  + '    </main>\n'
  + '  );\n'
  + '}\n';

const POISON_QUOTED = 'export default function App() {\n'
  + '  return (\n'
  + '    <main><img src="https://forbidden.invalid/r3a.jpg" alt="poison" /></main>\n'
  + '  );\n'
  + '}\n';

const POISON_SVG = 'export default function App() {\n'
  + '  return (\n'
  + '    <svg viewBox="0 0 10 10"><image href="https://forbidden.invalid/r3a.svg" /></svg>\n'
  + '  );\n'
  + '}\n';

const POISON_SPREAD = 'const p = {};\n'
  + 'export default function App() {\n'
  + '  return (<main><img {...p} /></main>);\n'
  + '}\n';

const POISON_CSS_INTERP = 'const thumb = "https://picsum.photos/seed/x/16/16";\n'
  + 'export const bg = { backgroundImage: `url(${thumb})` };\n';

const UNDETERMINED_TSX = 'export default function App() {\n'
  + '  const heroImage = Math.random() > 0.5 ? "a" : "b";\n'
  + '  return (<main><img src={heroImage} alt="indeterminee" /></main>);\n'
  + '}\n';

// ============================================================================
// 1. UNIT — les gardes du serveur MCP
// ============================================================================

describe('PATCH-R3-A unit : gardes MCP (fs_write / app_build)', () => {
  it('U1. contenu interdit : refus explicite, jamais interprété comme validation', () => {
    const refusal = mcpGuardInspectCandidate('src/App.tsx', POISON_QUOTED);
    assert.ok(refusal !== null, 'le poison doit être refusé');
    assert.ok(refusal.includes('forbidden.invalid'), 'la référence exacte est citée : ' + refusal);
    assert.ok(refusal.includes('aucune écriture effectuée'));
    assert.ok(refusal.length <= 400, 'borne du message HTTP respectée');
  });

  it('U2. contenu conforme : aucune entrave', () => {
    assert.equal(mcpGuardInspectCandidate('src/App.tsx', CONFORM_TSX), null);
    assert.equal(mcpGuardInspectCandidate('src/main.tsx', 'import React from "react";\n'), null);
  });

  it('U3. formes PATCH-1 : quoté / SVG image / spread / url() interpolé via MCP', () => {
    assert.ok(mcpGuardInspectCandidate('src/App.tsx', POISON_SVG)!.includes('forbidden.invalid'));
    const spread = mcpGuardInspectCandidate('src/App.tsx', POISON_SPREAD);
    const interp = mcpGuardInspectCandidate('src/lib.ts', POISON_CSS_INTERP);
    assert.ok(spread !== null && spread.length > 0, 'spread refusé');
    assert.ok(interp !== null && interp.length > 0, 'url() interpolé refusé');
  });

  it('U4. contenu volumineux sain : aucun crash de la garde', () => {
    assert.equal(mcpGuardInspectCandidate('src/big.ts', 'x'.repeat(50_000)), null);
  });

  it('U5. workspace absent : aucun faux refus (0 fichier inspecté)', () => {
    assert.equal(mcpGuardInspectWorkspace('proj_mcp_absent_r3a_' + Date.now()), null);
  });

  it('U6. collecte exhaustif : les sources du workspace sont toutes lues', () => {
    const pid = 'mcp_collect_r3a';
    rmSync(join(wsRoot, pid), { recursive: true, force: true });
    try {
      writeAppFile(pid, 'src/A1.tsx', CONFORM_TSX);
      writeAppFile(pid, 'src/A2.tsx', POISON_QUOTED);
      const sources = collectMcpInspectSources(pid);
      assert.ok(sources.some((s) => s.path === 'src/A1.tsx'));
      assert.ok(sources.some((s) => s.path === 'src/A2.tsx' && s.content.includes('forbidden.invalid')));
      const refusal = mcpGuardInspectWorkspace(pid);
      assert.ok(refusal !== null && refusal.includes('forbidden.invalid'),
        'la garde du build voit le poison déposé par un fichier non-MCP');
    } finally {
      rmSync(join(wsRoot, pid), { recursive: true, force: true });
      rmSync(join(wsRoot, pid + '.format.json'), { force: true });
    }
  });
});

// ============================================================================
// 2. OUTILS — serveur MCP stdio réel (spawn du build du snapshot)
// ============================================================================

describe('PATCH-R3-A outils : serveur MCP réel (stdio)', () => {
  const TENANT = 'tenant_mcp_r3a_tools';
  const PID = 'mcp_r3a_gates';

  function newClient(projectId: string = PID, timeoutMs = 15000): McpStdioClient {
    return new McpStdioClient({
      command: process.execPath,
      args: [mcpServerPath, TENANT, projectId],
      timeoutMs
    });
  }

  after(() => {
    const ws = join(wsRoot, PID);
    if (existsSync(ws)) rmSync(ws, { recursive: true, force: true });
    const marker = join(wsRoot, PID + '.format.json');
    if (existsSync(marker)) rmSync(marker, { force: true });
  });

  it('T1. fs_write poison : refus et AUCUNE écriture (workspace + FileStore)', async () => {
    const client = newClient();
    try {
      await client.connect();
      await assert.rejects(
        () => client.callTool('fs_write', { path: 'src/components/Evil.tsx', content: POISON_QUOTED }, 15000),
        (err: Error) => err.message.includes('forbidden.invalid') && err.message.includes('aucune écriture effectuée'),
        'le refus cite la violation'
      );
      // PREUVE : le fichier n'existe pas (aucune écriture).
      await assert.rejects(
        () => client.callTool('fs_read', { path: 'src/components/Evil.tsx' }, 15000),
        /introuvable/,
        'fs_read prouve l absence de fichier'
      );
    } finally {
      client.close();
    }
  });

  it('T2. fs_write conforme : écriture normale préservée', async () => {
    const client = newClient();
    try {
      await client.connect();
      const out = await client.callTool('fs_write', { path: 'src/components/Ok.tsx', content: CONFORM_TSX }, 15000);
      assert.match(out, /écrit et persisté/);
      const read = await client.callTool('fs_read', { path: 'src/components/Ok.tsx' }, 15000);
      assert.equal(read, CONFORM_TSX);
    } finally {
      client.close();
    }
  });

  it('T3. app_build : violation déjà dans le workspace → refus AVANT build', async () => {
    // Poison déposé HORS MCP (écriture directe — exact le scénario de l audit).
    const w = writeAppFile(PID, 'src/App.tsx', POISON_QUOTED);
    assert.equal(w.ok, true);
    const client = newClient(PID, 60000);
    try {
      await client.connect();
      await assert.rejects(
        () => client.callTool('app_build', {}, 60000),
        (err: Error) => err.message.includes('BUILD REFUSÉ') && err.message.includes('forbidden.invalid')
          && err.message.includes('bundle précédent inchangé'),
        'le build est refusé, les violations citées'
      );
      assert.ok(!existsSync(join(wsRoot, PID, 'dist')), 'aucune materialisation dist');
    } finally {
      client.close();
    }
  });

  it('T4. sources conformes : build normal (dernier bundle valide publié)', async () => {
    const w = writeAppFile(PID, 'src/App.tsx', CONFORM_TSX);
    assert.equal(w.ok, true);
    const client = newClient(PID, 90000);
    try {
      await client.connect();
      const out = await client.callTool('app_build', {}, 90000);
      assert.match(out, /Build réussi/);
      const distHtml = readFileSync(join(wsRoot, PID, 'dist', 'index.html'), 'utf8');
      assert.ok(distHtml.includes('R3A-conforme'), 'bundle conforme produit');
      assert.ok(!distHtml.includes('forbidden.invalid'));
    } finally {
      client.close();
    }
  });

  it('T5. échec d inspection : refus FERMÉ, injection réelle (workspace obstrué)', async () => {
    // Un FICHIER remplace le dossier workspace → toute collecte lève ENOTDIR.
    const obstructed = 'mcpgatefail_r3a';
    writeFileSync(join(wsRoot, obstructed), 'obstruction volontaire', 'utf8');
    const client = newClient(obstructed, 30000);
    try {
      await client.connect();
      await assert.rejects(
        () => client.callTool('app_build', {}, 30000),
        (err: Error) => err.message.includes('inspection des images en échec')
          && err.message.includes('build refusé par précaution'),
        'échec de collecte → refus fail-closed'
      );
    } finally {
      client.close();
      unlinkSync(join(wsRoot, obstructed));
    }
  });

  it('T6. undetermined (src={expression}) : écrit, jamais déclaré conforme', async () => {
    const client = newClient();
    try {
      await client.connect();
      const out = await client.callTool(
        'fs_write',
        { path: 'src/components/Undet.tsx', content: UNDETERMINED_TSX },
        15000
      );
      assert.match(out, /écrit et persisté/);
    } finally {
      client.close();
    }
  });
});

// ============================================================================
// 3. E2E HTTP — /api/v1/mcp/call + /preview-bundle (contrat réel)
// ============================================================================

describe('PATCH-R3-A E2E HTTP : /api/v1/mcp/call → /preview-bundle', () => {
  let server: Server;
  let baseUrl = '';
  const tenant = 'tenant_mcp_r3a_http';
  const USR_R3A = 'usr_r3a_lota';
  // Lot A : identité individuelle fiable (JWT signé) pour TOUTE la chaîne
  // MCP (le repli dev n'est plus suffisant pour préparer/exécuter).
  const H = {
    'Content-Type': 'application/json',
    authorization: `Bearer ${signToken({ id: USR_R3A, tenantId: tenant, role: 'OWNER', email: 'r3a@lota.test' }, 3600)}`
  };
  const projectIds: string[] = [];

  async function createProject(name: string): Promise<string> {
    const r = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers: H, body: JSON.stringify({ name })
    });
    assert.equal(r.status, 201);
    const pid = ((await r.json()) as { project: { id: string } }).project.id;
    projectIds.push(pid);
    return pid;
  }

  /**
   * Lot A — contrat gouverné : PRÉPARATION (confirmation 201) puis exécution
   * avec confirmation consommée. Le CONTRAT EXÉCUTION est conservé : 200
   * toujours, result|error — c'est ce que les garde-fous PATCH-R3-A vérifient
   * via le champ error (refus « REFUSÉ par la politique des images », etc.).
   */
  async function mcpCall(tool: string, projectId: string, args: Record<string, unknown> = {}, timeoutMs = 60000): Promise<{ error?: string; result?: string }> {
    const payload = { server: 'project', tool, projectId, args, timeoutMs };
    const prep = await fetch(`${baseUrl}/api/v1/mcp/prepare`, {
      method: 'POST', headers: H, body: JSON.stringify(payload)
    });
    assert.equal(prep.status, 201, 'préparation confirmée (gouvernance Lot A)');
    const confirmation = ((await prep.json()) as { confirmation: { confirmationId: string } }).confirmation;
    const r = await fetch(`${baseUrl}/api/v1/mcp/call`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ ...payload, confirmationId: confirmation.confirmationId })
    });
    assert.equal(r.status, 200, 'la route MCP répond toujours 200 (contrat exécution, existant)');
    return (await r.json()) as { error?: string; result?: string };
  }

  async function fetchBundle(projectId: string): Promise<{ status: number; text: string }> {
    const r = await fetch(`${baseUrl}/preview-bundle/${projectId}/`);
    return { status: r.status, text: r.status === 200 ? await r.text() : '' };
  }

  before(async () => {
    // Hygiène : les builds tournent dans l ENFANT spawné, mais on neutralise
    // tout héritage NODE_ENV potentiel (leçon des suites P1-B).
    delete process.env.NODE_ENV;
    // Lot A : import dynamique APRÈS la fixation de AUTH_SECRET (isolation).
    const mod = (await import('../src/server.js')) as unknown as {
      createApiServer: (options: { port: number }) => { server: Server };
    };
    const instance = mod.createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((res) => {
      server.listen(0, () => {
        baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
        res();
      });
    });
  });

  after(async () => {
    for (const pid of projectIds) {
      await fetch(`${baseUrl}/api/v1/projects/${pid}`, { method: 'DELETE', headers: H });
    }
    await new Promise<void>((res) => server.close(() => res()));
    try {
      rmSync(isolatedVolacoDataDir, { recursive: true, force: true });
    } catch {
      // Windows : SQLite encore ouvert — répertoire temporaire OS (motif C34).
    }
  });

  it('H1. fs_write poison via HTTP : refus 200 + error, AUCUNE écriture', async () => {
    const pid = await createProject('R3A H1');
    const res = await mcpCall('fs_write', pid, { path: 'src/components/Evil.tsx', content: POISON_QUOTED });
    assert.ok(res.error, 'le refus traverse le contrat HTTP (champ error)');
    assert.ok(res.error.includes('forbidden.invalid'));
    assert.ok(res.error.includes('aucune écriture effectuée'));
    assert.equal(res.result, undefined, 'PAS de résultat de succès');
    // PREUVE : aucun fichier écrit.
    const read = await mcpCall('fs_read', pid, { path: 'src/components/Evil.tsx' });
    assert.ok(read.error, 'fs_read échoue : fichier inexistant');
    assert.ok(read.error.includes('introuvable'));
  });

  it('H2. fs_write conforme via HTTP : écriture et relecture exactes', async () => {
    const pid = await createProject('R3A H2');
    const res = await mcpCall('fs_write', pid, { path: 'src/components/Ok.tsx', content: CONFORM_TSX });
    assert.equal(res.error, undefined);
    assert.ok(res.result?.includes('écrit et persisté'));
    const read = await mcpCall('fs_read', pid, { path: 'src/components/Ok.tsx' });
    assert.equal(read.result, CONFORM_TSX);
  });

  it('H3. app_build : poison PRÉ-EXISTANT au workspace → refus, aucun bundle', async () => {
    const pid = await createProject('R3A H3');
    const w = writeAppFile(pid, 'src/App.tsx', POISON_QUOTED);
    assert.equal(w.ok, true, 'poison déposé hors MCP (scénario audit)');
    const res = await mcpCall('app_build', pid, {}, 90000);
    assert.ok(res.error, 'refus requis');
    assert.ok(res.error.includes('BUILD REFUSÉ') && res.error.includes('forbidden.invalid'));
    assert.equal(res.result, undefined, 'aucun faux succès');
    assert.ok(!existsSync(join(wsRoot, pid, 'dist')), 'aucune materialisation dist');
    const bundle = await fetchBundle(pid);
    assert.equal(bundle.status, 404, 'aucun bundle publié');
  });

  it('H4. sources conformes : build et republication NORMAUX via MCP', async () => {
    const pid = await createProject('R3A H4');
    const res = await mcpCall('fs_write', pid, { path: 'src/App.tsx', content: CONFORM_TSX });
    assert.equal(res.error, undefined);
    const build = await mcpCall('app_build', pid, {}, 90000);
    assert.equal(build.error, undefined, build.error ?? '');
    assert.ok(build.result?.includes('Build réussi'));
    const bundle = await fetchBundle(pid);
    assert.equal(bundle.status, 200, 'le bundle conforme est servi');
    assert.ok(bundle.text.includes('R3A-conforme'));
    assert.ok(!bundle.text.includes('forbidden.invalid'));
  });

  it('H5. refus conclude au dernier bundle VALIDE : publication inchangée', async () => {
    // État H1 (aucun bundle) ; on construit la version conforme puis on
    // tente le poison : le bundle valide DOIT rester servi, à l'octet.
    const pid = await createProject('R3A H5');
    await mcpCall('fs_write', pid, { path: 'src/App.tsx', content: CONFORM_TSX });
    const build = await mcpCall('app_build', pid, {}, 90000);
    assert.equal(build.error, undefined);
    const before = await fetchBundle(pid);
    assert.equal(before.status, 200);
    // Poison déposé hors MCP PUIS tentative de republish.
    const w = writeAppFile(pid, 'src/App.tsx', POISON_QUOTED);
    assert.equal(w.ok, true);
    const refused = await mcpCall('app_build', pid, {}, 90000);
    assert.ok(refused.error?.includes('BUILD REFUSÉ'));
    assert.equal(refused.result, undefined);
    // PREUVE : le dernier bundle valide est ENCORE servi, inchangé.
    const bundle = await fetchBundle(pid);
    assert.equal(bundle.status, 200);
    assert.equal(bundle.text, before.text, 'octet pour octet inchangé');
    assert.ok(bundle.text.includes('R3A-conforme'));
    assert.ok(!bundle.text.includes('forbidden.invalid'), 'aucun poison publié');
  });

  it('H6. undetermined via MCP : écrit et PAS bloqué (politique documentée)', async () => {
    const pid = await createProject('R3A H6');
    const res = await mcpCall('fs_write', pid, { path: 'src/App.tsx', content: UNDETERMINED_TSX });
    assert.equal(res.error, undefined, 'les indéterminées ne sont pas des violations');
    assert.ok(res.result?.includes('écrit et persisté'));
  });

  it('H7. formes PATCH-1 via MCP : toutes refusées, aucune écrite', async () => {
    const pid = await createProject('R3A H7');
    const cases: Array<{ path: string; content: string; token?: string }> = [
      { path: 'src/P1Quoted.tsx', content: POISON_QUOTED, token: 'forbidden.invalid' },
      { path: 'src/P1Svg.tsx', content: POISON_SVG, token: 'forbidden.invalid' },
      { path: 'src/P1Spread.tsx', content: POISON_SPREAD },
      { path: 'src/P1Interp.ts', content: POISON_CSS_INTERP }
    ];
    for (const c of cases) {
      const res = await mcpCall('fs_write', pid, c);
      assert.ok(res.error, 'refus requis pour ' + c.path);
      assert.ok(res.error.includes('REFUSÉ par la politique des images'));
      if (c.token) assert.ok(res.error.includes(c.token));
      assert.equal(res.result, undefined);
      const read = await mcpCall('fs_read', pid, { path: c.path });
      assert.ok(read.error, 'aucun fichier écrit pour ' + c.path);
    }
  });
});
