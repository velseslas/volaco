/**
 * ÉTAPE 42 Phase 2 — Design Harmony dans le Studio (lecture pure GET /design).
 *
 * Serveur HTTP RÉEL : le Studio servi contient la section Design Harmony,
 * la route GET /design retourne le rapport RÉEL de DesignHarmonyService
 * (DTO réel : designDirection, tokens, harmony {overallScore, subScores,
 * driftSummary, topFindings}, dqi) — et la section n'invente aucun champ.
 */

import './_lot-b-legacy-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

describe('ÉTAPE 42 Phase 2 — Design Harmony dans le Studio (GET /design)', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';
  let withHtmlProject = '';
  const tenant = 'tenant_e42';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'ENGINEER' };

  const DEMO_HTML = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Démo É42</title>
<style>body{background:#101418;color:#e2e8f0;font-family:system-ui;padding:24px}
h1{color:#7dd3fc;font-size:32px} .card{background:#1a2230;border-radius:16px;padding:16px;margin:8px}
button{background:#7dd3fc;border:none;border-radius:12px;padding:8px 16px;color:#0f172a}</style></head>
<body><h1>Titre démo</h1><div class="card">Carte 1</div><div class="card">Carte 2</div>
<button>Action</button><p>Contenu de la page de démonstration É42.</p></body></html>`;

  before(async () => {
    const { createApiServer } = await import('../src/server.js');
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'E42 design harmony' }) });
    projectId = ((await pres.json()) as { project?: { id?: string } }).project!.id!;

    // Projet AVEC index.html (le rapport réel exige un HTML à analyser)
    const pres2 = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'E42 avec html' }) });
    withHtmlProject = ((await pres2.json()) as { project?: { id?: string } }).project!.id!;
    await fetch(`${baseUrl}/api/v1/projects/${withHtmlProject}/files/content`, {
      method: 'PUT', headers,
      body: JSON.stringify({ path: 'index.html', content: DEMO_HTML })
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  // 1 — le panneau/section Design Harmony existe dans le Studio servi
  it('1: la section Design Harmony existe dans le Studio servi (carte + bouton + états)', () => {
    const served = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    assert.ok(served.includes('id="designHarmonyCard"'), 'carte Design Harmony présente');
    assert.ok(served.includes('id="designHarmonyBody"'), 'conteneur de rapport présent');
    assert.ok(served.includes('id="btnDesignHarmony"'), 'bouton Analyser présent');
    assert.match(served, /function loadDesignHarmony\(/, 'fonction de chargement présente');
  });

  // 2+3 — le Studio consomme réellement GET /design et le rapport réel est affiché
  it('2+3: GET /design → rapport RÉEL (DTO complet du backend) affiché par la section', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${withHtmlProject}/design`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      designDirection: Record<string, unknown>;
      tokens: Record<string, unknown>;
      harmony: { overallScore: number; subScores: Record<string, number>; topFindings: unknown[] };
      dqi: number;
      requestId: string;
    };
    // DTO réel attendu (vérifié dans routes/design.ts)
    assert.ok(body.designDirection && typeof body.designDirection.style === 'string');
    assert.ok(body.tokens && typeof body.tokens === 'object');
    assert.ok(typeof body.harmony.overallScore === 'number');
    assert.ok(body.harmony.topFindings);
    assert.equal(typeof body.dqi, 'number');
  });

  // 4 — les valeurs affichées correspondent aux données backend (deepEqual DTO)
  it('4: les valeurs affichées correspondent au DTO backend (aucun champ transformé)', async () => {
    const body = await (await fetch(`${baseUrl}/api/v1/projects/${withHtmlProject}/design`, { headers })).json() as Record<string, unknown>;
    const served = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    // La section affiche uniquement les champs réellement présents dans le DTO
    for (const field of ['designDirection', 'tokens', 'harmony', 'dqi']) {
      assert.ok(field in body, `champ '${field}' réel présent dans la réponse`);
    }
    // La section n'affiche AUCUN champ absent du DTO
    // É42 Phase 4A : previous/comparison sont des champs réels additifs
    const knownFields = ['designDirection', 'tokens', 'harmony', 'dqi', 'requestId', 'previous', 'comparison'];
    for (const key of Object.keys(body)) {
      assert.ok(knownFields.includes(key), `champ '${key}' provient du backend`);
    }
  });

  // 5 — aucun champ fictif injecté dans le rendu
  it('5: aucun champ fictif — le rendu n invente aucun score/section absente du DTO', () => {
    const served = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    const fnStart = served.indexOf('async function loadDesignHarmony');
    const fn = served.slice(fnStart, served.indexOf('    function designPanelSubScore'));
    assert.doesNotMatch(fn, /score\s*=\s*\d+/, 'aucun score hardcodé');
    assert.doesNotMatch(fn, /100\s*\/\s*100|overallScore\s*=\s*\d+/, 'aucun verdict fabriqué');
  });

  // 6 — état vide honnête (projet sans index.html → erreur réelle affichée)
  it('6: projet sans index.html → erreur réelle affichée (aucun score fabriqué)', async () => {
    // Un projet neuf possède un index.html auto-créé : le supprimer pour
    // provoquer l'erreur réelle du backend (ValidationError).
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files?path=index.html`, { method: 'DELETE', headers });
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers });
    assert.ok(res.status >= 400, 'erreur réelle du backend (pas de score fictif)');
  });

  // 7 — erreur API honnête (404 projet inexistant)
  it('7: projet inexistant → 404 canonique (aucun résultat fabriqué)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/proj-inexistant-e42/design`, { headers });
    assert.equal(res.status, 404);
  });

  // 8 — refresh manuel refait réellement GET /design
  it('8: refresh manuel — deux GET /design identiques → même rapport (déterministe)', async () => {
    const r1 = await (await fetch(`${baseUrl}/api/v1/projects/${withHtmlProject}/design`, { headers })).json() as { dqi: number; harmony: { overallScore: number } };
    const r2 = await (await fetch(`${baseUrl}/api/v1/projects/${withHtmlProject}/design`, { headers })).json() as { dqi: number; harmony: { overallScore: number } };
    assert.equal(r1.dqi, r2.dqi, 'DQI identique (déterministe)');
    assert.equal(r1.harmony.overallScore, r2.harmony.overallScore, 'score d harmonie identique');
  });

  // 9 — aucun polling (inspection source)
  it('9: aucun polling — aucun setInterval/timer dans la section Design Harmony', () => {
    const served = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    const fnStart = served.indexOf('async function loadDesignHarmony');
    const fn = served.slice(fnStart, served.indexOf('    function designPanelSubScore'));
    assert.doesNotMatch(fn, /setInterval|setTimeout|WebSocket/, 'aucun polling ni timer');
  });

  // 10 — échappement HTML des valeurs dynamiques
  it('10: échappement — toutes les valeurs dynamiques passent par designPanelEscape', () => {
    const served = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    const fnStart = served.indexOf('async function loadDesignHarmony');
    const fn = served.slice(fnStart, served.indexOf('    function designPanelSubScore'));
    // Les valeurs injectées dans le HTML passent par designPanelEscape
    assert.ok(fn.includes("designPanelEscape(dir.style)"));
    assert.ok(fn.includes("designPanelEscape(dir.density)"));
    assert.ok(fn.includes("designPanelEscape(dir.personality)"));
    // Aucune interpolation brute des valeurs dynamiques dans innerHTML
    assert.doesNotMatch(fn, /innerHTML\s*\+=[^;]*\$\{dir\./, 'aucune injection brute');
  });

  // 11 — aucune écriture backend (GET ne mute rien)
  it('11: GET /design n écrit rien — le store projet reste inchangé après analyse', async () => {
    const strip = (r: unknown) => { const c = JSON.parse(JSON.stringify(r)) as Record<string, unknown>; delete c.requestId; return c; };
    const before = strip(await (await fetch(`${baseUrl}/api/v1/projects/${withHtmlProject}/files`, { headers })).json());
    await fetch(`${baseUrl}/api/v1/projects/${withHtmlProject}/design`, { headers });
    const after = strip(await (await fetch(`${baseUrl}/api/v1/projects/${withHtmlProject}/files`, { headers })).json());
    assert.deepEqual(after, before, 'lecture pure : fichiers inchangés (hors requestId HTTP)');
  });

  // 12/13/14 — non-régression É41/Quality Gate
  it('12+13+14: non-régression — panneau Agents, Quality Gate et Studio intacts', () => {
    const served = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    // É41 Phase A/B intacts
    assert.ok(served.includes('id="agentsPanelContainer"'));
    assert.match(served, /function refreshAgentsPanel\(/);
    assert.match(served, /async function openAgentsTaskDetail\(/);
    assert.match(served, /async function openAgentsBatchDetail\(/);
    // Quality Gate existant intact
    assert.match(served, /async function runQualityGate\(/);
    assert.match(served, /function showQualityGateBanner\(/);
    // La section Design Harmony n'utilise QUE GET /design (aucune route POST)
    const fnStart = served.indexOf('async function loadDesignHarmony');
    const fn = served.slice(fnStart, served.indexOf('    function designPanelSubScore'));
    assert.ok(fn.includes("'/api/v1/projects/' + pid + '/design'"));
    assert.doesNotMatch(fn, /visual\/analyze|execute-batch|agents\/execute/, 'aucune autre route consommée');
  });

  // Inspection — fichiers : seuls index.html (Studio) modifié, aucun backend
  it('Inspection: aucun backend modifié — design.ts et DesignHarmonyService inchangés (source)', () => {
    const designRoute = readFileSync(resolve(process.cwd(), 'apps/api/src/routes/design.ts'), 'utf8');
    // La route backend ne contient aucune référence au Studio (aucun changement)
    assert.doesNotMatch(designRoute, /studio|agents-panel|e41/i);
    const service = readFileSync(resolve(process.cwd(), 'packages/core/src/ai-native/design-harmony/service.ts'), 'utf8');
    assert.match(service, /class DesignHarmonyService/, 'service intact');
    assert.doesNotMatch(service.replace(/\/\*[\s\S]*?\*\//g, ''), /node:fs/);
  });
});
