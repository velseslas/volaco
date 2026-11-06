/**
 * LOT A — CDC V8 §13/§14 : Critic + AQS exposés par l'API réelle.
 *
 * Prouve que :
 *  - GET /design lit désormais les blocs <style> (tokens §7 motion/layout
 *    réellement inférés — prérequis transverse du Lot A) ;
 *  - GET /design/aesthetic expose le Design Critic (§13) et les 12
 *    sous-scores AQS (§14), mesurés ou UNKNOWN, avec la couverture réelle ;
 *  - POST /visual/analyze enrichit sa réponse d'une `critique` dédiée,
 *    déterministe, sans toucher au score historique ;
 *  - la réponse historique de GET /design reste STRICTEMENT inchangée
 *    (aucun champ en plus : non-régression e53/e42).
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { AQS_DIMENSION_ORDER } from '../../../packages/core/src/index.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'ENGINEER' };

const HTML = `<!DOCTYPE html><html><head><style>
  body { background-color: #ffffff; color: #111827; font-family: Inter, sans-serif; padding: 24px; }
  .btn { background-color: #2563eb; color: #ffffff; border-radius: 14px; padding: 12px 20px; transition: background-color 240ms ease-in-out; }
  .wrap { max-width: 1024px; margin: 0 auto; }
  @media (min-width: 768px) { .wrap { padding: 32px; } }
</style></head>
<body>
  <h1 style="font-size: 40px; font-weight: 700">Titre principal</h1>
  <p style="font-size: 16px; color: #374151">Paragraphe de contenu réel pour la mesure.</p>
  <button class="btn" aria-label="Agir">Agir</button>
  <div class="wrap"><div class="card">Carte</div></div>
</body></html>`;

interface HistoryResponse {
  designDirection?: unknown;
  tokens?: {
    shapeTokens?: { primaryButtonRadius?: string };
    motionTokens?: { durations?: string[]; easings?: string[] };
    layoutTokens?: { breakpoints?: string[]; containerWidth?: string };
  };
  harmony?: unknown;
  dqi?: number;
  requestId?: string;
}

interface AestheticResponse {
  aesthetic: {
    version: string;
    determinism: string;
    overall: number | null;
    coverage: number;
    computedCount: number;
    unknownCount: number;
    subScores: { id: string; label: string; value: number | null; confidence: number; evidence: string[]; unknownReason?: string }[];
  };
  critique: {
    axes: { axis: string; score: number | null; confidence: number; evidence: string[] }[];
    findings: { id: string; code: string }[];
    coverage: number;
    layoutSource: string;
  };
  tokens: {
    colorTokens?: { primary?: string };
    typographyTokens?: { styleScale?: { h1?: string; body?: string } };
  };
  layoutSource: string;
  responsive: { mobileAnalyzed: boolean; overflow: unknown; findings: number };
  requestId: string;
}

describe('CDC V8 Lot A — Critic §13 + AQS §14 (API réelle)', () => {
  let server: Server;
  let baseUrl: string;
  let projectId: string;

  before(async () => {
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name: 'Lot A Critic AQS' })
    });
    projectId = ((await res.json()) as { project: { id: string } }).project.id;
    const put = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ path: 'index.html', content: HTML })
    });
    assert.equal(put.status, 200, 'index.html écrit');
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. GET /design lit réellement les <style> : tokens motion §7.6 + layout §7.7', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers: H });
    assert.equal(res.status, 200);
    const body = (await res.json()) as HistoryResponse;
    assert.equal(body.tokens?.shapeTokens?.primaryButtonRadius, '14px', 'rayon réel du bouton (bloc <style> appliqué)');
    assert.ok(body.tokens?.motionTokens?.durations?.includes('240ms'), 'durée de transition inférée');
    assert.ok(body.tokens?.layoutTokens?.breakpoints?.includes('768px'), 'breakpoint réel du média');
    assert.equal(body.tokens?.layoutTokens?.containerWidth, '1024px');
  });

  it('2. la réponse historique de GET /design ne gagne AUCUN champ (non-régression)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design`, { headers: H });
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal('aesthetic' in body, false, 'pas de champ aesthetic sur la route historique');
    assert.equal('critique' in body, false, 'pas de champ critique sur la route historique');
  });

  it('3. GET /design/aesthetic expose le Critic §13 (5 axes) et l’AQS §14 (12 sous-scores)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/design/aesthetic`, { headers: H });
    assert.equal(res.status, 200, 'la route de mesure doit répondre 200');
    const body = (await res.json()) as AestheticResponse;

    assert.equal(body.aesthetic.version, '8.0');
    assert.equal(body.aesthetic.determinism, 'DETERMINISTIC');
    assert.deepEqual(body.aesthetic.subScores.map((s) => s.id), AQS_DIMENSION_ORDER, 'les 12 dimensions du CDC, dans l’ordre');
    assert.equal(body.aesthetic.computedCount + body.aesthetic.unknownCount, 12);
    for (const sub of body.aesthetic.subScores) {
      if (sub.value !== null) {
        assert.ok(sub.value >= 0 && sub.value <= 100, `${sub.id} mesuré dans 0-100`);
      } else {
        assert.ok((sub.unknownReason ?? '').length > 0, `${sub.id} UNKNOWN => raison`);
      }
    }
    assert.ok(body.aesthetic.overall === null || (body.aesthetic.overall >= 0 && body.aesthetic.overall <= 100));

    assert.deepEqual(
      body.critique.axes.map((a) => a.axis),
      ['VISUAL_HIERARCHY', 'COMPOSITION', 'AESTHETICS', 'VISUAL_UX', 'PERCEIVED_QUALITY'],
      'les 5 axes du §13'
    );
    assert.ok(body.layoutSource === 'RUNTIME' || body.layoutSource === 'ESTIMATED');
    assert.equal(body.responsive.mobileAnalyzed, true, 'l’analyse mobile a réellement eu lieu');
    assert.equal(body.responsive.findings, 0, 'aucun faux finding responsive/a11y sur une page réellement lisible');
    // Preuve que les styles CALCULÉS du DOM runtime font foi : le titre est
    // stylé inline à 40px ; une relecture statique partielle donnerait 16px.
    assert.equal(body.tokens.typographyTokens?.styleScale?.h1, '40px', 'taille réelle du titre mesurée (40px)');
    assert.equal(body.tokens.colorTokens?.primary, '#2563eb', 'couleur de marque réelle mesurée sur le bouton');
  });

  it('4. POST /visual/analyze enrichit sa réponse d’une critique §13 déterministe', async () => {
    const res1 = await fetch(`${baseUrl}/api/v1/projects/${projectId}/visual/analyze`, { method: 'POST', headers: H });
    assert.equal(res1.status, 200);
    const first = (await res1.json()) as { score: number; critique?: { axes: { axis: string; score: number | null }[]; findings: { id: string }[] } };
    assert.ok(first.critique, 'critique présente');
    assert.equal(first.critique!.axes.length, 5);

    const res2 = await fetch(`${baseUrl}/api/v1/projects/${projectId}/visual/analyze`, { method: 'POST', headers: H });
    const second = (await res2.json()) as { score: number; critique?: { axes: { axis: string; score: number | null }[]; findings: { id: string }[] } };
    assert.equal(second.score, first.score, 'score historique inchangé entre deux appels');
    assert.deepEqual(
      second.critique!.axes.map((a) => [a.axis, a.score]),
      first.critique!.axes.map((a) => [a.axis, a.score]),
      'axes reproductibles'
    );
    assert.deepEqual(
      second.critique!.findings.map((f) => f.id),
      first.critique!.findings.map((f) => f.id),
      'ids de findings reproductibles (aucun aléatoire)'
    );
  });

  it('5. project inconnu => 404 honnête sur la route de mesure', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/proj_lot_a_absent/design/aesthetic`, { headers: H });
    assert.equal(res.status, 404);
  });
});
