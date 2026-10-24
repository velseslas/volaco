/**
 * LOT A — CDC V8 §13 : Design Critic Engine (preuves).
 *
 * Vérifie que les 5 axes réels sont mesurés sur des preuves DOM, que les
 * écarts déclenchent des findings déterministes, et que l'absence de preuve
 * produit UNKNOWN (jamais un score de remplissage).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VisualIntelligenceService, DesignCriticEngine, type VisualSnapshot } from '../../../src/index.js';

const TENANT = 'tenant_lot_a_critic';
const PROJECT = 'proj_lot_a_critic';
const service = new VisualIntelligenceService();
const critic = new DesignCriticEngine();
let routeCounter = 0;

async function snapshotOf(html: string, viewport: 'DESKTOP' | 'MOBILE' = 'DESKTOP'): Promise<VisualSnapshot> {
  const result = await service.analyzeVisuals({
    tenantId: TENANT,
    projectId: PROJECT,
    pageRoute: `/critic-${++routeCounter}`,
    htmlContent: html,
    viewport
  });
  return result.snapshot;
}

const GOOD_HTML = `<body style="background-color:#ffffff;color:#111827;font-family:Inter;padding:24px">
  <h1 style="font-size:40px;font-weight:700">Titre principal</h1>
  <h2 style="font-size:28px">Sous-titre</h2>
  <p style="font-size:16px;color:#374151">Premier paragraphe de contenu réel.</p>
  <p style="font-size:16px;color:#374151">Deuxième paragraphe de contenu réel.</p>
  <button style="background-color:#2563eb;color:#ffffff;font-weight:600;padding:12px 20px;border-radius:8px" aria-label="Action">Agir</button>
</body>`;

const axisOf = (critique: ReturnType<DesignCriticEngine['critique']>, axis: string) =>
  critique.axes.find((a) => a.axis === axis)!;

describe('LOT A §13 — Design Critic Engine (hiérarchie/composition/esthétique/UX/perçu)', () => {
  it('mesure les 5 axes du CDC sur une page saine (preuves citées, pas d’invention)', async () => {
    const snap = await snapshotOf(GOOD_HTML);
    const critique = critic.critique(snap);

    assert.deepEqual(
      critique.axes.map((a) => a.axis),
      ['VISUAL_HIERARCHY', 'COMPOSITION', 'AESTHETICS', 'VISUAL_UX', 'PERCEIVED_QUALITY']
    );
    const hierarchy = axisOf(critique, 'VISUAL_HIERARCHY');
    assert.equal(hierarchy.score, 100, 'hiérarchie saine = 100');
    assert.ok(hierarchy.evidence.length > 0, 'preuves de hiérarchie citées');
    const perceived = axisOf(critique, 'PERCEIVED_QUALITY');
    assert.equal(perceived.score, 100, 'contrastes AA respectés = 100');
    assert.equal(critique.coverage, 1, 'les 5 axes sont mesurables sur cette page');
    assert.equal(critique.layoutSource, 'ESTIMATED', 'analyse statique tracée comme estimée');
  });

  it('détecte l’absence de titre et une échelle typographique pauvre (codes déterministes)', async () => {
    const flat = `<body style="background-color:#ffffff;color:#111827;padding:24px">
      <p style="font-size:16px">Long texte sans structure visuelle un.</p>
      <p style="font-size:16px">Long texte sans structure visuelle deux.</p>
      <div style="font-size:24px">Bloc proéminent sans sémantique de titre</div>
      <button style="background-color:#2563eb;color:#ffffff;font-weight:700;padding:12px 20px">CTA</button>
    </body>`;
    const critique = critic.critique(await snapshotOf(flat));
    const hierarchy = axisOf(critique, 'VISUAL_HIERARCHY');
    assert.ok(hierarchy.score !== null && hierarchy.score < 100, 'hiérarchie dégradée détectée');
    assert.ok(critique.findings.some((f) => f.code === 'NO_HEADINGS'), 'finding NO_HEADINGS émis');
    assert.ok(critique.findings.some((f) => f.code === 'FEW_STEPS'), 'finding FEW_STEPS émis');
  });

  it('détecte la surcharge de polices et de palette (esthétique)', async () => {
    const bloat = `<body style="font-family:Arial;background-color:#ffffff;color:#111827;padding:16px">
      <p style="font-family:Georgia;color:#e11d48;background-color:#fef3c7;font-size:16px">Un texte</p>
      <p style="font-family:Verdana;color:#7c3aed;font-size:14px">Deux texte</p>
      <div style="font-family:Georgia;color:#059669;font-size:18px">Trois texte</div>
      <div style="font-family:Courier;color:#0891b2;font-size:20px">Quatre texte</div>
      <div style="font-family:Arial;color:#b45309;font-size:22px">Cinq texte</div>
    </body>`;
    const critique = critic.critique(await snapshotOf(bloat));
    const aesthetics = axisOf(critique, 'AESTHETICS');
    assert.ok(aesthetics.score !== null && aesthetics.score < 100, 'esthétique dégradée mesurée');
    assert.ok(critique.findings.some((f) => f.code === 'FONT_BLOAT'), 'finding FONT_BLOAT émis');
  });

  it('détecte les interactions sans nom accessible, liens morts et images sans alt (UX visuelle)', async () => {
    const ux = `<body style="background-color:#ffffff;color:#111827">
      <h1 style="font-size:32px;font-weight:700">Titre</h1>
      <p style="font-size:16px">Paragraphe de contenu réel pour la page.</p>
      <button style="padding:10px"><span class="icon"></span></button>
      <a href="#">Lien sans destination réelle</a>
      <img src="hero.png">
    </body>`;
    const critique = critic.critique(await snapshotOf(ux));
    assert.ok(critique.findings.some((f) => f.code === 'UNNAMED_INTERACTIONS'), 'interaction sans nom signalée');
    assert.ok(critique.findings.some((f) => f.code === 'DEAD_LINKS'), 'lien mort signalé');
    assert.ok(critique.findings.some((f) => f.code === 'IMAGES_WITHOUT_ALT'), 'image sans alt signalée');
  });

  it('mesure les contrastes réels (qualité perçue WCAG AA)', async () => {
    const lowContrast = `<body style="background-color:#ffffff">
      <p style="color:#cbd5e1;font-size:14px">Texte gris très clair un.</p>
      <p style="color:#cbd5e1;font-size:14px">Texte gris très clair deux.</p>
    </body>`;
    const critique = critic.critique(await snapshotOf(lowContrast));
    const perceived = axisOf(critique, 'PERCEIVED_QUALITY');
    assert.ok(perceived.score !== null && perceived.score < 100, 'violations de contraste mesurées');
    assert.ok(critique.findings.some((f) => f.code === 'CONTRAST_VIOLATIONS'), 'finding contraste émis');
  });

  it('rend UNKNOWN les axes sans preuves suffisantes (aucun score de remplissage)', async () => {
    const empty = await snapshotOf('<div id="solo"></div>');
    const critique = critic.critique(empty);
    assert.equal(critique.coverage, 0, 'aucun axe mesurable sur un DOM vide');
    for (const axis of critique.axes) {
      assert.equal(axis.score, null);
      assert.ok(axis.unknownReason && axis.unknownReason.length > 0, `raison UNKNOWN fournie (${axis.axis})`);
    }
  });

  it('est déterministe : deux critiques identiques => mêmes scores et mêmes ids', async () => {
    const snap = await snapshotOf(GOOD_HTML);
    const a = critic.critique(snap);
    const b = critic.critique(snap);
    assert.deepEqual(a.axes.map((x) => [x.axis, x.score, x.confidence]), b.axes.map((x) => [x.axis, x.score, x.confidence]));
    assert.deepEqual(a.findings.map((f) => f.id), b.findings.map((f) => f.id));
  });
});
