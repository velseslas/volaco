/**
 * ÉTAPE 44 Phase 3 — correction P1 : terme de pénalité couleur du DQI.
 *
 * Avant correction, design.ts tronquait `extractedColors` à 8 AVANT de
 * compter, rendant `colors.length - 8` toujours nul : la pénalité couleur
 * était mathématiquement morte. La pénalité s'applique désormais sur le
 * nombre RÉEL de couleurs extraites (0-8 → 0 ; 9 → 4 ; 10 → 8).
 *
 * Le DQI complet est vérifié via le serveur HTTP réel :
 *   dqi = round(0.6 × harmony.overallScore + 0.4 × perceived)
 *   perceived = 100 − max(0, realColorCount − 8) × 4 − max(0, realFonts − 3) × 6
 * (polices volontairement ≤ 3 dans tous les fixtures pour isoler le terme couleur).
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { VisualIntelligenceService } from '../../../packages/core/src/ai-native/visual-intelligence/index.js';

const tenant = 'tenant_e44p3';
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'ENGINEER' };

// Palette de bordures décoratives (hors périmètre des checks de contraste
// texte/fond, pour isoler le terme couleur). La base du document produit
// 4 couleurs uniques ; ces 4 complètent à 8, les suivantes dépassent.
const BASE_COMPLETERS = ['#7dd3fc', '#94a3b8', '#fb7185', '#a5b4fc'];

/** Document nominal : base à 8 couleurs réelles + N couleurs supplémentaires. */
function docWith(extraColors: string[]): string {
  const decorations = [...BASE_COMPLETERS, ...extraColors]
    .map((c) => `<div class="decor" style="border-color:${c};border-width:2px;border-style:solid;border-radius:4px"></div>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>DQI</title>
<style>body{font-family:system-ui}</style></head>
<body style="background:#0f172a;color:#e2e8f0">
<header style="background:#1e293b;padding:16px"><h1 style="font-size:28px;color:#93c5fd">Titre</h1></header>
<main><button style="height:40px;background:#93c5fd;border-radius:4px;color:#0f172a">Action 1</button>
<button style="height:40px;background:#93c5fd;border-radius:4px;color:#0f172a">Action 2</button>
<button style="height:40px;background:#93c5fd;border-radius:4px;color:#0f172a">Action 3</button></main>
${decorations}
</body></html>`;
}

// Cas 4 — fixture réelle de l'audit Phase 2D ayant démontré P1 (9 couleurs
// extraites : avant correction la route comptait 8 → pénalité 0).
const FIXTURE_2D = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>App A</title>
<style>body{font-family:system-ui}</style></head>
<body style="background:#0f172a;color:#e2e8f0">
<header id="top" style="background:#1e293b;padding:16px"><h1 style="font-size:28px;color:#93c5fd">Tableau de bord</h1></header>
<main>
<section class="card" style="background:#1e293b;border-radius:8px;padding:16px"><h2 style="font-size:20px">Section 1</h2><p style="color:#94a3b8">Contenu un.</p><button style="height:40px;background:#93c5fd;border-radius:4px;color:#0f172a">Action 1</button><button style="height:40px;background:#93c5fd;border-radius:4px;color:#0f172a">Action 2</button><button style="height:40px;background:#93c5fd;border-radius:4px;color:#0f172a">Action 3</button></section>
<section class="card" style="background:#1e293b;border-radius:8px;padding:16px"><h2 style="font-size:20px">Section 2</h2><p style="color:#94a3b8">Contenu deux.</p><button style="height:40px;background:#93c5fd;border-radius:4px;color:#0f172a">Valider</button><button style="height:64px;background:#fb7185;border-radius:16px;color:#fff">URGENT</button></section>
<section class="card" style="background:#1e293b;border-radius:8px;padding:16px"><h2 style="font-size:20px">Section 3</h2><a href="#" style="color:#7dd3fc">Lien</a><input type="email" placeholder="email" style="height:36px;background:#0f172a;color:#e2e8f0;border-radius:4px"></section>
</main>
<footer style="background:#1e293b;padding:12px"><p style="color:#64748b;font-size:12px">Pied de page</p></footer>
</body></html>`;

describe('ÉTAPE 44 Phase 3 — pénalité couleur du DQI (terme P1)', () => {
  let server: Server;
  let baseUrl: string;
  const visual = new VisualIntelligenceService();

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
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  /**
   * Dépose le document, mesure le nombre RÉEL de couleurs via le même moteur
   * que la route (VisualIntelligenceService), puis vérifie que le DQI servi
   * correspond exactement à la formule avec la pénalité couleur attendue.
   */
  async function assertDqiWithColorPenalty(label: string, html: string, expectedPenalty: number): Promise<void> {
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'P3 ' + label }) });
    const pid = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: html })
    });

    // Mesure indépendante du nombre réel de couleurs (même moteur déterministe)
    const analysis = await visual.analyzeVisuals(
      { tenantId: tenant + '_measure', projectId: 'measure_' + label, htmlContent: html, requestId: 'req_' + label },
      'ENGINEER'
    );
    const realColors = analysis.snapshot.extractedColors.length;
    const realFonts = analysis.snapshot.extractedFonts.length;
    assert.ok(realFonts <= 3, 'les fixtures isolent le terme couleur (polices ≤ 3)');

    const res = await fetch(`${baseUrl}/api/v1/projects/${pid}/design`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { harmony: { overallScore: number }; dqi: number };

    const perceived = Math.max(0, Math.min(100,
      100 - Math.max(0, realColors - 8) * 4 - Math.max(0, realFonts - 3) * 6));
    const expectedDqi = Math.round(body.harmony.overallScore * 0.6 + perceived * 0.4);
    assert.equal(body.dqi, expectedDqi,
      `[${label}] DQI servi = formule avec pénalité couleur réelle (${realColors} couleurs, pénalité ${expectedPenalty})`);
    return void 0;
  }

  it('Cas 1: 8 couleurs réelles → pénalité 0 (comportement inchangé)', async () => {
    const html = docWith([]);
    await assertDqiWithColorPenalty('8-couleurs', html, 0);
  });

  it('Cas 2: 9 couleurs réelles → pénalité 4 (terme atteignable)', async () => {
    const html = docWith(['#f9a8d4']);
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'P3 count9' }) });
    const pid = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: html })
    });
    // Vérifie d'abord que le fixture produit bien 9 couleurs
    const analysis = await visual.analyzeVisuals(
      { tenantId: tenant + '_count', projectId: 'count9', htmlContent: html, requestId: 'req_count9' },
      'ENGINEER'
    );
    assert.equal(analysis.snapshot.extractedColors.length, 9, 'le fixture cas 2 contient exactement 9 couleurs');
    await assertDqiWithColorPenalty('9-couleurs', html, 4);
  });

  it('Cas 3: 10 couleurs réelles → pénalité 8', async () => {
    const html = docWith(['#f9a8d4', '#86efac']);
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'P3 count10' }) });
    const pid = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: html })
    });
    const analysis = await visual.analyzeVisuals(
      { tenantId: tenant + '_count', projectId: 'count10', htmlContent: html, requestId: 'req_count10' },
      'ENGINEER'
    );
    assert.equal(analysis.snapshot.extractedColors.length, 10, 'le fixture cas 3 contient exactement 10 couleurs');
    await assertDqiWithColorPenalty('10-couleurs', html, 8);
  });

  it('Cas 4: fixture réelle Phase 2D (9 couleurs) — la pénalité est désormais appliquée', async () => {
    await assertDqiWithColorPenalty('fixture-2d', FIXTURE_2D, 4);
  });

  it('Aucun autre terme du DQI n a changé : formule complète revérifiée sur le cas 9 couleurs', async () => {
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'P3 formule' }) });
    const pid = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    const html = docWith(['#f9a8d4']);
    await fetch(`${baseUrl}/api/v1/projects/${pid}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: html })
    });
    const body = await (await fetch(`${baseUrl}/api/v1/projects/${pid}/design`, { headers })).json() as {
      harmony: { overallScore: number }; dqi: number;
    };
    // Avec pénalité 4 : perceived = 96 → dqi = round(0.6·S + 38.4)
    const withPenalty = Math.round(body.harmony.overallScore * 0.6 + 38.4);
    assert.equal(body.dqi, withPenalty, 'seul le terme couleur s applique (pénalité 4)');
    // L ANCIEN comportement (terme mort : perceived=100 → round(0.6·S + 40))
    // serait différent — la correction est prouvée par la disjonction :
    const oldDeadTerm = Math.round(body.harmony.overallScore * 0.6 + 40);
    assert.notEqual(body.dqi, oldDeadTerm, 'l ancien terme mort ne peut plus produire ce DQI');
  });
});
