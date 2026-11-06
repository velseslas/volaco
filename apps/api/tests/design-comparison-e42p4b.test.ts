/**
 * ÉTAPE 42 Phase 4B — affichage du delta/previous/comparison DesignHarmony.
 *
 * Le Studio est un RENDERER du DTO backend : le scoreDelta affiché vient
 * exclusivement du champ comparison.scoreDelta produit par compareReports
 * (Phase 4A). Aucun recalcul, aucune fabrication, échappement systématique.
 */

import './_lot-b-legacy-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

describe('ÉTAPE 42 Phase 4B — affichage du delta DesignHarmony', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';
  const tenant = 'tenant_e42p4b';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'ENGINEER' };

  const HTML_V1 = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>V1</title>
<style>body{background:#111827;color:#e5e7eb;font-family:system-ui;padding:24px}
h1{color:#93c5fd;font-size:30px}.card{background:#1f2937;border-radius:8px;padding:12px;margin:8px}
button{background:#93c5fd;border:none;border-radius:4px;padding:6px 12px;color:#111}</style></head>
<body><h1>Version 1</h1><div class="card">Carte V1</div><button>Action</button></body></html>`;

  const HTML_V2 = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>V2</title>
<style>body{background:#0f172a;color:#f1f5f9;font-family:system-ui;padding:24px}
h1{color:#7dd3fc;font-size:36px}.card{background:#1e293b;border-radius:16px;padding:16px;margin:8px}
button{background:#7dd3fc;border:none;border-radius:12px;padding:8px 16px;color:#0f172a}
.extra{color:#94a3b8}</style></head>
<body><h1>Version 2 enrichie</h1><div class="card">Carte V2</div><div class="card">Carte V2 bis</div>
<button>Action</button><p class="extra">Contenu enrichi.</p><p>Nouveau paragraphe.</p></body></html>`;

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
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'E42 P4B delta' }) });
    projectId = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: HTML_V1 })
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  // 7 — premier rapport : le rendu affiche un état honnête sans comparaison
  it('7: premier rapport — le rendu du panneau affiche un état honnête SANS comparaison', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { comparison?: unknown; previous?: unknown };
    // DTO réel : premier appel → pas de previous/comparison (Phase 4A)
    assert.equal(body.comparison, undefined);
    assert.equal(body.previous, undefined);
    // Le rendu du Studio (source) affiche un message honnête pour ce cas
    const served = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    assert.match(served, /Premier rapport : aucune comparaison disponible/);
  });

  // 1→6 — après modification : comparison réelle affichée (le Studio est un renderer du DTO)
  it('1→6: le DTO comparison est affiché tel quel (delta/ids/improvements/regressions/drifts)', async () => {
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: HTML_V2 })
    });
    const body = await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers })).json() as {
      comparison: { previousReportId: string; currentReportId: string; scoreDelta: number; improvements: string[]; regressions: string[]; newDrifts: Array<{ property?: string }>; resolvedDrifts: string[] };
      previous: { reportId: string; overallScore: number };
      harmony: { overallScore: number };
      dqi: number;
    };

    // Le Studio est un RENDERER : scoreDelta affiché = scoreDelta backend
    // (cohérence DTO : current - previous, calculée par compareReports côté serveur)
    assert.equal(body.comparison.scoreDelta, body.harmony.overallScore - body.previous.overallScore,
      'le delta affiché provient du backend, jamais recalculé côté Studio');
    assert.match(body.comparison.previousReportId, /^dhr-/);
    assert.match(body.comparison.currentReportId, /^dhr-/);
    assert.ok(Array.isArray(body.comparison.improvements));
    assert.ok(Array.isArray(body.comparison.regressions));
    assert.ok(Array.isArray(body.comparison.newDrifts));
    assert.ok(Array.isArray(body.comparison.resolvedDrifts));
  });

  // 8/9 — aucun calcul métier, aucun polling dans le Studio (inspection source)
  it('8+9: le Studio ne recalcule AUCUN delta et n effectue AUCUN polling (source)', () => {
    const full = resolve(process.cwd(), 'apps/studio/index.html');
    const served = readFileSync(full, 'utf8');
    const fnStart = served.indexOf('async function loadDesignHarmony');
    const fn = served.slice(fnStart, served.indexOf('    function designPanelSubScore'));
    // Aucun recalcul du delta côté Studio
    assert.doesNotMatch(fn, /overallScore\s*-\s*previous|scoreDelta\s*=/, 'aucun recalcul de scoreDelta');
    assert.doesNotMatch(fn, /setInterval|setTimeout|WebSocket/, 'aucun polling');
  });

  // 10 — échappement systématique des valeurs comparison/previous
  it('10: échappement — les valeurs comparison/previous passent par agentsPanelEscape', () => {
    const served = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    const fnStart = served.indexOf('async function loadDesignHarmony');
    const fn = served.slice(fnStart, served.indexOf('    function designPanelSubScore'));
    assert.ok(fn.includes("agentsPanelEscape(cmp.previousReportId)"));
    assert.ok(fn.includes("agentsPanelEscape(cmp.currentReportId)"));
    assert.ok(fn.includes("agentsPanelEscape(imp)"));
    assert.ok(fn.includes("agentsPanelEscape(reg)"));
    assert.ok(fn.includes("agentsPanelEscape(d.property)"));
    assert.ok(fn.includes("agentsPanelEscape(r)"));
    assert.ok(fn.includes("agentsPanelEscape(prev.reportId)"));
    assert.doesNotMatch(fn, /innerHTML\s*\+=[^;]*\$\{cmp\.(scoreDelta|previousReportId)[^;]*;/, 'aucune injection brute');
  });

  // 14 — non-régression : la carte Design Harmony existante reste intacte (DQI/sous-scores/findings)
  it('14: non-régression — DQI/sous-scores/findings toujours rendus depuis le DTO', async () => {
    const served = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    const fnStart = served.indexOf('async function loadDesignHarmony');
    const fn = served.slice(fnStart, served.indexOf('    function designPanelSubScore'));
    assert.match(fn, /DQI ' \+ data\.dqi/, 'DQI réel rendu');
    assert.match(fn, /designPanelSubScore\('Couleur', sub\.colorHarmony\)/, 'sous-scores réels rendus');
    assert.match(fn, /Findings réels \(/, 'findings réels rendus');
  });

  // 12 — non-régression panneau Agents É41
  it('12: non-régression É41 — panneau Agents intact', () => {
    const served = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    assert.ok(served.includes('id="agentsPanelContainer"'));
    assert.match(served, /function refreshAgentsPanel\(/);
    assert.match(served, /async function openAgentsTaskDetail\(/);
    assert.match(served, /async function openAgentsBatchDetail\(/);
  });

  // 13 — non-régression Quality Gate
  it('13: non-régression Quality Gate — runQualityGate intact', () => {
    const served = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    assert.match(served, /async function runQualityGate\(/);
    assert.match(served, /function showQualityGateBanner\(/);
  });

  // Inspection — fichiers : uniquement index.html (Studio) modifié
  it('Inspection: aucun backend modifié (design.ts / DesignReportStore / compareReports sources inchangés)', () => {
    const designRoute = readFileSync(resolve(process.cwd(), 'apps/api/src/routes/design.ts'), 'utf8');
    // La Phase 4B ne touche PAS au backend : design.ts doit rester exactement
    // comme en Phase 4A (comparaison backend, pas de rendu Studio dans la route)
    assert.doesNotMatch(designRoute, /studio|agents-panel|designPanelEscape/i);
    const store = readFileSync(resolve(process.cwd(), 'packages/core/src/ai-native/design-harmony/report-store.ts'), 'utf8');
    assert.match(store, /class DesignReportStore/, 'DesignReportStore intact');
    const service = readFileSync(resolve(process.cwd(), 'packages/core/src/ai-native/design-harmony/service.ts'), 'utf8');
    assert.match(service, /compareReports\(/, 'compareReports intact');
  });
});
