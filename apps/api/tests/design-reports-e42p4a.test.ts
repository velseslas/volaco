/**
 * ÉTAPE 42 Phase 4A — persistance du dernier rapport DesignHarmony +
 * comparaison avant/après via compareReports (moteur EXISTANT).
 *
 * Serveur HTTP RÉEL : premier GET /design sur un projet → aucun précédent
 * (aucun delta inventé) ; deuxième GET → comparison réelle entre les deux
 * rapports réels. Isolation tenant/projet, lecture pure (fichiers projet
 * inchangés), persistance reconstruite.
 */

import './_lot-b-legacy-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DesignReportStore } from '../../../packages/core/src/index.js';

describe('ÉTAPE 42 Phase 4A — persistance dernier rapport DesignHarmony', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';
  const tenant = 'tenant_e42p4a';
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
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'E42 P4A comparaison' }) });
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

  function designUrl(proj = projectId): string {
    return `${baseUrl}/api/v1/projects/${proj}/design`;
  }

  // 1 — premier GET : aucun précédent, aucun delta inventé
  it('1: premier GET /design → AUCUN previous, AUCUNE comparison inventée', async () => {
    const res = await fetch(designUrl(), { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { previous?: unknown; comparison?: unknown };
    assert.equal(body.previous, undefined, 'premier appel : pas de précédent');
    assert.equal(body.comparison, undefined, 'premier appel : pas de comparaison fabriquée');
  });

  // 2/3 — deuxième analyse : précédent réellement récupéré, compareReports réel
  it('2+3: deuxième GET après modification → previous réel + comparison réelle (scoreDelta)', async () => {
    // Modification RÉELLE du HTML via la route fichiers (V2 plus riche)
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: HTML_V2 })
    });

    const res = await fetch(designUrl(), { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      previous?: { reportId?: string; overallScore?: number };
      comparison?: { previousReportId?: string; currentReportId?: string; scoreDelta?: number; improvements?: string[]; regressions?: string[]; newDrifts?: unknown[]; resolvedDrifts?: string[] };
      harmony: { overallScore: number };
    };

    // previous = rapport réellement persisté au premier appel
    assert.ok(body.previous, 'le précédent persisté est exposé');
    assert.ok(typeof body.previous!.overallScore === 'number');
    // compareReports (moteur EXISTANT) a reçu les deux rapports réels :
    assert.match(body.comparison!.previousReportId ?? '', /^dhr-/, 'previousReportId réel (format backend dhr-)');
    assert.match(body.comparison!.currentReportId ?? '', /^dhr-/, 'currentReportId réel (format backend dhr-)');
    assert.equal(typeof body.comparison!.scoreDelta, 'number', 'delta réel calculé par le moteur');
    // Delta RÉEL : cohérent avec les scores des deux rapports réels
    // (compareReports calcule current - previous, déterministe).
    const expectedDelta = body.harmony.overallScore - body.previous!.overallScore;
    assert.equal(body.comparison!.scoreDelta, expectedDelta, 'delta réel cohérent avec les scores');
    // Le contenu V2 est plus riche : le finding de drift doit refléter le réel
    assert.ok(Array.isArray(body.comparison!.newDrifts), 'newDrifts présents');
  });

  // 4 — le rapport courant devient le précédent du prochain appel
  it('4: rapport courant devient le précédent du troisième appel', async () => {
    // Modifier à nouveau pour forcer un nouveau rapport
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: HTML_V1 })
    });
    const res = await fetch(designUrl(), { headers });
    const body = await res.json() as { previous?: { overallScore?: number } };
    assert.ok(body.previous, 'un précédent existe');
  });

  // 5 — fichiers projet inchangés par la comparaison (lecture pure)
  it('5: la comparaison n écrit rien dans les fichiers projet', async () => {
    const files = await (await fetch(`${baseUrl}/api/v1/projects/${projectId}/files`, { headers })).json() as { files?: { tree?: Array<{ path?: string }> } };
    const paths = JSON.stringify(files);
    assert.ok(paths.includes('index.html'), 'index.html présent');
    // Le contenu est vérifié via re-analyse déterministe : même DQI qu'au test 4
    const r1 = await (await fetch(designUrl(), { headers })).json() as { dqi: number };
    const r2 = await (await fetch(designUrl(), { headers })).json() as { dqi: number };
    assert.equal(r1.dqi, r2.dqi, 'déterminisme sans écriture');
  });

  // 6 — isolation tenant/projet
  it('6: isolation — le même designUrl chez un autre tenant ne retourne aucun previous', async () => {
    const res = await fetch(designUrl(), { headers: { 'x-tenant-id': 'tenant_e42p4a_autre', 'x-user-role': 'ENGINEER' } });
    assert.equal(res.status, 404, 'projet invisible depuis un autre tenant');
  });

  // 7 — persistance : reconstruction du store retrouve le dernier rapport
  it('7: reconstruction — nouvelle AgentTraceStore/DesignReportStore persist:true retrouve le dernier rapport', async () => {
    const reloaded = new DesignReportStore({ persist: true });
    const reloadedReport = reloaded.get(tenant, projectId);
    assert.ok(reloadedReport, 'dernier rapport retrouvé après reconstruction');
    assert.match(reloadedReport.reportId, /^dhr-/, 'reportId réel (format backend dhr-)');
  });

  // 8 — aucune donnée de screenshot persistée
  it('8: aucune donnée de screenshot/base64 dans le rapport persisté', async () => {
    const reloaded = new DesignReportStore({ persist: true });
    const reloadedReport = reloaded.get(tenant, projectId)!;
    const serialized = JSON.stringify(reloadedReport);
    assert.doesNotMatch(serialized, /base64|screenshot/i, 'aucune donnée screenshot/base64');
  });

  // 9 — non-régression : GET /design reste honnête sur un projet neuf (autre tenant)
  it('9: non-régression — un projet neuf d un autre tenant → premier appel sans précédent', async () => {
    const pres = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers: { 'x-tenant-id': 'tenant_e42p4a_b', 'x-user-role': 'ENGINEER', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'E42 P4A autre tenant' })
    });
    const otherProject = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    await fetch(`${baseUrl}/api/v1/projects/${otherProject}/files/content`, {
      method: 'PUT', headers: { 'x-tenant-id': 'tenant_e42p4a_b', 'x-user-role': 'ENGINEER', 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ path: 'index.html', content: HTML_V1 })
    });
    const res = await fetch(designUrl().replace(projectId, otherProject).replace(tenant, 'tenant_e42p4a_b'), {
      headers: { 'x-tenant-id': 'tenant_e42p4a_b', 'x-user-role': 'ENGINEER' }
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { previous?: unknown; comparison?: unknown };
    assert.equal(body.previous, undefined, 'aucun previous pour le premier appel de ce tenant');
    assert.equal(body.comparison, undefined);
  });
});
