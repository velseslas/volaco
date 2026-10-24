/**
 * LOT A — CDC V8 §14 : Aesthetic Quality Score (preuves).
 *
 * Vérifie que l'AQS expose les 12 sous-scores EXACTS du CDC, que chacun est
 * soit mesuré (0-100 + preuves) soit UNKNOWN (null + raison), que le score
 * global est la moyenne pondérée des seuls sous-scores mesurés, et que tout
 * reste déterministe.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  VisualIntelligenceService,
  TokenInferer,
  DesignCriticEngine,
  AestheticQualityEngine,
  AQS_DIMENSION_ORDER,
  AQS_WEIGHTS,
  type VisualSnapshot
} from '../../../src/index.js';

const TENANT = 'tenant_lot_a_aqs';
const PROJECT = 'proj_lot_a_aqs';
const service = new VisualIntelligenceService();
const critic = new DesignCriticEngine();
const inferer = new TokenInferer();
const aqs = new AestheticQualityEngine();
let routeCounter = 0;

async function snapshotOf(html: string, viewport: 'DESKTOP' | 'MOBILE' = 'DESKTOP'): Promise<VisualSnapshot> {
  const result = await service.analyzeVisuals({
    tenantId: TENANT,
    projectId: PROJECT,
    pageRoute: `/aqs-${++routeCounter}`,
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

describe('LOT A §14 — Aesthetic Quality Score (12 sous-scores du CDC)', () => {
  it('expose exactement les 12 dimensions du CDC (ordre stable)', async () => {
    const snap = await snapshotOf(GOOD_HTML);
    const critique = critic.critique(snap);
    const tokens = inferer.inferDesignSystem([snap]);
    const aesthetic = aqs.compute({ snapshot: snap, critique, tokens });

    assert.equal(aesthetic.subScores.length, 12);
    assert.deepEqual(aesthetic.subScores.map((s) => s.id), AQS_DIMENSION_ORDER);
    assert.deepEqual(AQS_DIMENSION_ORDER, [
      'visual_hierarchy',
      'composition',
      'typography',
      'color_harmony',
      'spacing_rhythm',
      'component_quality',
      'visual_balance',
      'information_density',
      'interaction_design',
      'responsive_quality',
      'brand_alignment',
      'perceived_quality'
    ]);
    for (const sub of aesthetic.subScores) {
      assert.ok(sub.label.length > 0, `label présent (${sub.id})`);
      if (sub.value !== null) {
        assert.ok(Number.isInteger(sub.value) && sub.value >= 0 && sub.value <= 100, `${sub.id} dans 0-100`);
        assert.ok(sub.evidence.length > 0, `${sub.id} mesuré => preuves citées`);
      } else {
        assert.ok(sub.confidence === 0, `${sub.id} UNKNOWN => confiance 0`);
        assert.ok(sub.unknownReason && sub.unknownReason.length > 0, `${sub.id} UNKNOWN => raison fournie`);
      }
    }
  });

  it('calcule le score global comme moyenne pondérée des seuls sous-scores mesurés', async () => {
    const snap = await snapshotOf(GOOD_HTML);
    const critique = critic.critique(snap);
    const tokens = inferer.inferDesignSystem([snap]);
    const aesthetic = aqs.compute({ snapshot: snap, critique, tokens });

    assert.ok(aesthetic.computedCount >= 10, 'au moins 10 dimensions réellement mesurées sur une page saine');
    assert.equal(
      aesthetic.computedCount + aesthetic.unknownCount,
      12,
      'mesurés + UNKNOWN = 12'
    );
    assert.ok(aesthetic.overall !== null, 'score global calculé car couverture > 0');

    let weighted = 0;
    let weight = 0;
    for (const sub of aesthetic.subScores) {
      if (sub.value === null) continue;
      weighted += sub.value * AQS_WEIGHTS[sub.id];
      weight += AQS_WEIGHTS[sub.id];
    }
    assert.equal(aesthetic.overall, Math.round(weighted / weight), 'moyenne pondérée exacte');
    assert.equal(aesthetic.coverage, Math.round(weight * 100) / 100, 'couverture = poids réellement couvert');
  });

  it('rend UNKNOWN la qualité responsive sans preuve mobile', async () => {
    const snap = await snapshotOf(GOOD_HTML);
    const critique = critic.critique(snap);
    const tokens = inferer.inferDesignSystem([snap]);
    const aesthetic = aqs.compute({ snapshot: snap, critique, tokens });
    const responsive = aesthetic.subScores.find((s) => s.id === 'responsive_quality')!;
    assert.equal(responsive.value, null, 'aucune analyse mobile => UNKNOWN, jamais fabriqué');
    assert.match(responsive.unknownReason ?? '', /mobile/i);
  });

  it('mesure la qualité responsive quand des preuves mobile existent (overflow compris)', async () => {
    const snap = await snapshotOf(GOOD_HTML);
    const mobile = await snapshotOf(GOOD_HTML, 'MOBILE');
    const critique = critic.critique(snap);
    const tokens = inferer.inferDesignSystem([snap]);

    const clean = aqs.compute({
      snapshot: snap,
      critique,
      tokens,
      mobileSnapshot: mobile,
      responsiveFindings: [],
      mobileOverflow: { overflowX: false, wideElements: 0 }
    });
    const cleanResponsive = clean.subScores.find((s) => s.id === 'responsive_quality')!;
    assert.equal(cleanResponsive.value, 100, 'aucun débordement mesuré => 100');

    const overflow = aqs.compute({
      snapshot: snap,
      critique,
      tokens,
      mobileSnapshot: mobile,
      responsiveFindings: [],
      mobileOverflow: { overflowX: true, wideElements: 3 }
    });
    const overflowResponsive = overflow.subScores.find((s) => s.id === 'responsive_quality')!;
    assert.equal(overflowResponsive.value, 80, 'débordement mesuré => pénalité réelle de 20');
  });

  it('rend un score global null quand AUCUNE dimension n’est mesurable', async () => {
    const snap = await snapshotOf('<div id="solo"></div>');
    const critique = critic.critique(snap);
    const tokens = inferer.inferDesignSystem([snap]);
    const aesthetic = aqs.compute({ snapshot: snap, critique, tokens });
    assert.equal(aesthetic.computedCount, 0);
    assert.equal(aesthetic.overall, null, 'jamais de score global inventé');
    assert.equal(aesthetic.coverage, 0);
  });

  it('est déterministe : deux calculs identiques => même objet', async () => {
    const snap = await snapshotOf(GOOD_HTML);
    const critique = critic.critique(snap);
    const tokens = inferer.inferDesignSystem([snap]);
    const a = aqs.compute({ snapshot: snap, critique, tokens });
    const b = aqs.compute({ snapshot: snap, critique, tokens });
    assert.deepEqual(a, b);
  });
});
