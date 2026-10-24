/**
 * VibeCode Core — Design Harmony
 * CDC V8 §11 — Design Context (source des générations design-aware) : tests
 * de preuve unitaires.
 *
 * Preuves :
 *  - Design Direction dérivée DÉTERMINISTEMENT (parité avec la route : mêmes
 *    entrées → mêmes sorties ; sans stats DOM : densités omises, jamais
 *    inventées) ;
 *  - contexte construit depuis un rapport RÉEL (palette, typo, espacement,
 *    rayons), règles dérivées des tokens, corrections attendues = findings
 *    MEDIUM+ triés, bloc de prompt borné ;
 *  - immutabilité (deepFreeze) + déterminisme ;
 *  - chargement depuis un store : isolation tenant/projet vérifiée,
 *    failure-safe (aucune exception propagée, jamais de contexte fabriqué).
 *
 * Déterministe : aucun réseau, aucun serveur, aucune horloge réelle.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectDesignContext,
  deriveDesignDirection,
  loadProjectDesignContext,
  MAX_PROMPT_BLOCK_CHARS,
  buildDesignSystemArtifact,
  type DesignHarmonyFinding,
  type DesignHarmonyReport,
  type DesignSystemArtifact,
  type InferredDesignSystem
} from '../../../src/index.js';

function makeFinding(
  id: string,
  category: DesignHarmonyFinding['category'],
  severity: DesignHarmonyFinding['severity'],
  recommendation: string,
  pageRoute = '/'
): DesignHarmonyFinding {
  return {
    id,
    category,
    severity,
    confidence: 0.9,
    pageRoute,
    property: 'test-property',
    observedValue: 'observed',
    recommendation,
    designDrift: true,
    evidence: [{ source: 'DOM_SNAPSHOT', detail: 'preuve de test', pageRoute, occurrences: 1 }]
  };
}

const BASE_TOKENS: InferredDesignSystem = {
  colorTokens: {
    primary: '#b45309',
    secondary: '#1f2937',
    accent: '#f59e0b',
    background: '#ffffff',
    surface: '#f9fafb',
    foreground: '#111827',
    muted: '#6b7280',
    border: '#e5e7eb'
  },
  typographyTokens: {
    primaryFontFamily: 'Inter',
    fontFamilies: ['Inter', 'JetBrains Mono'],
    detectedScale: ['14px', '16px', '20px', '32px'],
    dominantLineHeightRatio: 1.5
  },
  spacingTokens: { baseGridStep: 8, detectedScale: [8, 16, 24, 32, 48], regularityRatio: 0.86 },
  shapeTokens: {
    primaryButtonRadius: '10px',
    primaryCardRadius: '16px',
    primaryInputRadius: '10px',
    detectedRadii: ['10px', '16px']
  },
  elevationTokens: {
    detectedLevelsCount: 2,
    shadowLevels: ['0 1px 2px rgba(0,0,0,0.05)', '0 4px 12px rgba(0,0,0,0.1)']
  },
  systemConfidence: 0.82,
  evidenceCount: 140
};

function makeReport(overrides: Partial<DesignHarmonyReport> = {}): DesignHarmonyReport {
  return {
    reportId: 'dhr-test-0001',
    tenantId: 'tenant-a',
    projectId: 'proj-a',
    analyzedRoutes: ['/', '/menu'],
    overallScore: 78,
    subScores: {
      colorHarmony: 80,
      typographyHarmony: 75,
      spacingHarmony: 82,
      shapeHarmony: 79,
      elevationHarmony: 70,
      componentHarmony: 76,
      crossPageHarmony: 74,
      responsiveA11yHarmony: 72
    },
    inferredDesignSystem: BASE_TOKENS,
    findings: [
      makeFinding('f-color', 'COLOR', 'HIGH', 'Contraste insuffisant sur le bouton principal'),
      makeFinding('f-typo', 'TYPOGRAPHY', 'MEDIUM', 'Deux familles de police concurrentes dans le hero'),
      makeFinding('f-spacing', 'SPACING', 'LOW', 'Espacement hors grille 8px dans la section tarifs'),
      makeFinding('f-a11y', 'ACCESSIBILITY', 'CRITICAL', 'Bouton sans libellé accessible'),
      makeFinding('f-elev', 'ELEVATION', 'MEDIUM', 'Trois niveaux d ombre incohérents'),
      makeFinding('f-comp', 'COMPONENT', 'MEDIUM', 'Rayons différents entre boutons')
    ],
    driftSummary: { totalDrifts: 6, criticalDrifts: 1 },
    reportHash: 'hash-test',
    generatedAt: '2026-10-18T10:00:00.000Z',
    durationMs: 42,
    ...overrides
  };
}

describe('CDC V8 §11 — Design Direction déterministe (source unique)', () => {
  it('1. avec stats DOM réelles : même dérivation que la route (une seule source)', () => {
    const dir = deriveDesignDirection(BASE_TOKENS, {
      extractedColorCount: 5,
      extractedFonts: ['Inter'],
      interactiveElementsCount: 30,
      totalElementsCount: 400
    });

    assert.equal(dir.style, 'Balanced Modern');
    assert.equal(dir.density, 'Spacious');
    assert.equal(dir.personality, 'Friendly / Editorial');
    assert.equal(dir.motion, 'Subtle');
    assert.equal(dir.visualEnergy, 'Calm');
    assert.equal(dir.informationDensity, 'High');
    assert.deepEqual(dir.evidence, {
      dominantRadiusPx: 10,
      colorCount: 5,
      fontCount: 1,
      interactiveElements: 30,
      totalElements: 400
    });
  });

  it('2. sans stats DOM : densités OMISES (jamais inventées), le reste dérivé des tokens', () => {
    const dir = deriveDesignDirection(BASE_TOKENS);

    assert.equal(dir.style, 'Balanced Modern');
    assert.equal('density' in dir, false);
    assert.equal('informationDensity' in dir, false);
    assert.equal(dir.personality, 'Professional / Technical');
    assert.equal(dir.visualEnergy, 'Expressive');
    assert.deepEqual(dir.evidence, { dominantRadiusPx: 10, colorCount: 8, fontCount: 2 });
    assert.equal('interactiveElements' in dir.evidence, false);
    assert.equal('totalElements' in dir.evidence, false);
  });

  it('3. seuils de style identiques à la route historique (4px / 10px / 16px)', () => {
    const tokensWith = (radius: string): InferredDesignSystem => ({
      ...BASE_TOKENS,
      shapeTokens: { ...BASE_TOKENS.shapeTokens, primaryButtonRadius: radius }
    });

    assert.equal(deriveDesignDirection(tokensWith('4px')).style, 'Sharp & Technical');
    assert.equal(deriveDesignDirection(tokensWith('8px')).style, 'Balanced Modern');
    assert.equal(deriveDesignDirection(tokensWith('16px')).style, 'Soft & Rounded');
  });

  it('4. deux dérivations consécutives identiques (déterminisme strict)', () => {
    const a = deriveDesignDirection(BASE_TOKENS, {
      extractedColorCount: 7,
      extractedFonts: ['Inter', 'Roboto Mono'],
      interactiveElementsCount: 60,
      totalElementsCount: 200
    });
    const b = deriveDesignDirection(BASE_TOKENS, {
      extractedColorCount: 7,
      extractedFonts: ['Inter', 'Roboto Mono'],
      interactiveElementsCount: 60,
      totalElementsCount: 200
    });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.density, 'Dense');
    assert.equal(a.informationDensity, 'Medium');
    assert.equal(a.visualEnergy, 'Expressive');
  });
});

describe('CDC V8 §11 — buildProjectDesignContext (rapport réel → contexte borné)', () => {
  it('5. tokens du rapport repris fidèlement (palette ordonnée, typos, espacement, rayons)', () => {
    const ctx = buildProjectDesignContext(makeReport());

    assert.equal(ctx.source, 'design-report');
    assert.equal(ctx.reportId, 'dhr-test-0001');
    assert.equal(ctx.overallScore, 78);
    assert.deepEqual(ctx.analyzedRoutes, ['/', '/menu']);
    assert.deepEqual(ctx.tokens.palette[0], { role: 'primary', value: '#b45309' });
    assert.equal(ctx.tokens.palette.length, 8);
    assert.equal(ctx.tokens.primaryFontFamily, 'Inter');
    assert.deepEqual(ctx.tokens.fontFamilies, ['Inter', 'JetBrains Mono']);
    assert.equal(ctx.tokens.baseGridStep, 8);
    assert.deepEqual(ctx.tokens.spacingScale, [8, 16, 24, 32, 48]);
    assert.deepEqual(ctx.tokens.radii, ['10px', '16px']);
    assert.equal(ctx.tokens.shadowLevelsCount, 2);
    assert.equal(ctx.tokens.systemConfidence, 0.82);
    assert.equal(ctx.direction.style, 'Balanced Modern');
    // LOT 1 — provenance de la direction et version du catalogue appliqué :
    // sans artefact persisté frais, la direction est re-dérivée des tokens.
    assert.equal(ctx.directionSource, 'derived');
    assert.equal(ctx.rulesCatalogVersion, '1.0.0');
  });

  it('6. règles dérivées des tokens réellement observés (catalogue versionné)', () => {
    const ctx = buildProjectDesignContext(makeReport());
    const rules = ctx.rules.map((rule) => rule.text).join(' | ');

    assert.ok(rules.includes('palette de référence'), 'règle palette');
    assert.ok(rules.includes('primary #b45309'), 'palette citée avec preuve');
    assert.ok(rules.includes('Inter'), 'typo de référence');
    assert.ok(rules.includes('multiples de 8px'), 'grille d espacement');
    assert.ok(rules.includes('10px, 16px'), 'plage de rayons');
    assert.ok(rules.includes('4.5:1'), 'accessibilité');
    assert.ok(rules.length >= 6);
    assert.equal(ctx.rules.length, 7);
    // LOT 1 — les règles APPLIQUÉES portent l'id du catalogue (traçabilité).
    assert.deepEqual(
      ctx.rules.map((rule) => rule.id),
      [
        'palette.reuse',
        'typography.primary-family',
        'spacing.grid-base',
        'shape.radii-range',
        'elevation.max-levels',
        'structure.semantics',
        'a11y.contrast-labels'
      ]
    );
    assert.deepEqual(
      ctx.rules.map((rule) => rule.category),
      ['COLOR', 'TYPOGRAPHY', 'SPACING', 'SHAPE', 'ELEVATION', 'STRUCTURE', 'ACCESSIBILITY']
    );
  });

  it('7. corrections attendues = findings MEDIUM+ uniquement, triés par sévérité', () => {
    const ctx = buildProjectDesignContext(makeReport());

    assert.equal(ctx.expectedCorrections.length, 5);
    assert.deepEqual(
      ctx.expectedCorrections.map((c) => c.category),
      ['ACCESSIBILITY', 'COLOR', 'COMPONENT', 'ELEVATION', 'TYPOGRAPHY']
    );
    assert.equal(ctx.expectedCorrections[0]!.severity, 'CRITICAL');
    assert.ok(!ctx.expectedCorrections.some((c) => c.severity === 'LOW'), 'LOW exclu');
  });

  it('8. recommandation longue tronquée proprement (160 max)', () => {
    const longText = 'A'.repeat(400);
    const report = makeReport({
      findings: [makeFinding('f-long', 'COLOR', 'HIGH', longText)]
    });
    const ctx = buildProjectDesignContext(report);

    assert.equal(ctx.expectedCorrections.length, 1);
    const rec = ctx.expectedCorrections[0]!.recommendation;
    assert.ok(rec.length <= 160);
    assert.ok(rec.endsWith('…'));
  });

  it('9. bloc de prompt : traçabilité (reportId), direction, palette et exigence d explication', () => {
    const ctx = buildProjectDesignContext(makeReport());
    const block = ctx.promptBlock;

    assert.ok(block.includes('CONTEXTE DESIGN OBLIGATOIRE'));
    assert.ok(block.includes('dhr-test-0001'));
    assert.ok(block.includes('2026-10-18'));
    assert.ok(block.includes('Balanced Modern'));
    assert.ok(block.includes('primary #b45309'));
    assert.ok(block.includes('multiples de 8px'));
    assert.ok(block.includes('explique tes choix'), 'exigence d explication (CDC §11)');
    assert.ok(block.includes('[CRITICAL] ACCESSIBILITY'), 'corrections réelles citées');
    assert.ok(block.length <= MAX_PROMPT_BLOCK_CHARS);
  });

  it('10. bloc borné même avec un rapport volumineux (jamais au-delà du plafond)', () => {
    const longFinding = (i: number): DesignHarmonyFinding =>
      makeFinding(`f-huge-${i}`, 'COLOR', 'HIGH', `Recommandation très longue numéro ${i} `.repeat(8));
    const report = makeReport({
      findings: [1, 2, 3, 4, 5, 6].map(longFinding)
    });
    const ctx = buildProjectDesignContext(report);

    assert.ok(ctx.promptBlock.length <= MAX_PROMPT_BLOCK_CHARS);
    assert.ok(ctx.promptBlock.endsWith('…'), 'troncature explicite');
  });

  it('11. sans finding MEDIUM+ : aucune section corrections fabriquée', () => {
    const report = makeReport({
      findings: [makeFinding('f-low', 'SPACING', 'LOW', 'Détail mineur')]
    });
    const ctx = buildProjectDesignContext(report);

    assert.equal(ctx.expectedCorrections.length, 0);
    assert.ok(!ctx.promptBlock.includes('Corrections attendues'));
  });

  it('12. contexte gelé en profondeur (immutabilité) et déterministe', () => {
    const a = buildProjectDesignContext(makeReport());
    const b = buildProjectDesignContext(makeReport());

    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.ok(Object.isFrozen(a));
    assert.ok(Object.isFrozen(a.tokens));
    assert.ok(Object.isFrozen(a.tokens.palette));
    assert.ok(Object.isFrozen(a.rules));
    assert.ok(Object.isFrozen(a.direction));
    assert.ok(Object.isFrozen(a.expectedCorrections));
  });
});

describe('CDC V8 §11 — loadProjectDesignContext (store réel, isolation, failure-safe)', () => {
  class FakeStore {
    public calls = 0;
    constructor(private readonly report?: DesignHarmonyReport | undefined) {}
    public get(tenantId: string, projectId: string): DesignHarmonyReport | undefined {
      this.calls += 1;
      if (!this.report) return undefined;
      if (this.report.tenantId !== tenantId || this.report.projectId !== projectId) return undefined;
      return this.report;
    }
  }

  it('13. rapport présent pour le couple tenant/projet → contexte construit', () => {
    const store = new FakeStore(makeReport());
    const ctx = loadProjectDesignContext({ tenantId: 'tenant-a', projectId: 'proj-a', store });

    assert.ok(ctx);
    assert.equal(ctx!.reportId, 'dhr-test-0001');
    assert.equal(store.calls, 1);
  });

  it('14. aucun rapport pour ce couple → undefined (aucun contexte fabriqué)', () => {
    const store = new FakeStore(undefined);
    const ctx = loadProjectDesignContext({ tenantId: 'tenant-a', projectId: 'proj-a', store });

    assert.equal(ctx, undefined);
  });

  it('15. rapport d un autre couple remonté par un store non isolé → refusé (défense en profondeur)', () => {
    const foreign = makeReport({ tenantId: 'tenant-b', projectId: 'proj-b' });
    const leakyStore = { get: () => foreign };
    const ctx = loadProjectDesignContext({ tenantId: 'tenant-a', projectId: 'proj-a', store: leakyStore });

    assert.equal(ctx, undefined);
  });

  it('16. store en erreur → undefined, aucune exception propagée', () => {
    const throwingStore = {
      get(): DesignHarmonyReport | undefined {
        throw new Error('panne de persistance simulée');
      }
    };
    let result: unknown = 'non-appelé';
    assert.doesNotThrow(() => {
      result = loadProjectDesignContext({ tenantId: 'tenant-a', projectId: 'proj-a', store: throwingStore });
    });
    assert.equal(result, undefined);
  });

  it('17. store de production (singleton) : projet inconnu → undefined sans écrire', () => {
    const ctx = loadProjectDesignContext({
      tenantId: 'tenant-inexistant-e53',
      projectId: 'projet-inexistant-e53'
    });
    assert.equal(ctx, undefined);
  });
});

describe('CDC V8 §11 Lot 1 — artefact Design System persisté (direction fraîche vs périmée)', () => {
  const APPLIED_DIRECTION = deriveDesignDirection(BASE_TOKENS, {
    extractedColorCount: 5,
    extractedFonts: ['Inter'],
    interactiveElementsCount: 30,
    totalElementsCount: 400
  });

  it('18. artefact frais (même rapport source) : direction PERSISTÉE reprise telle quelle', () => {
    const report = makeReport();
    const artifact = buildDesignSystemArtifact({
      report,
      direction: APPLIED_DIRECTION,
      dqi: 88,
      recordedAt: '2026-10-18T10:05:00.000Z'
    });
    const ctx = buildProjectDesignContext(report, artifact);

    assert.equal(ctx.directionSource, 'persisted');
    assert.deepEqual(ctx.direction, APPLIED_DIRECTION);
    // La direction persistée porte la densité RÉELLE fournie par la route —
    // la dérivation tokens-seuls l'omettrait (jamais inventée).
    assert.equal(ctx.direction.density, 'Spacious');
    // Le bloc de prompt intègre la direction persistée.
    assert.ok(ctx.promptBlock.includes('densité « Spacious »'));
  });

  it('19. artefact périmé (autre rapport source) : repli sur la dérivation tokens, densités omises', () => {
    const stale = buildDesignSystemArtifact({
      report: makeReport({ reportId: 'dhr-ancien-0002' }),
      direction: APPLIED_DIRECTION,
      dqi: 88,
      recordedAt: '2026-10-18T09:00:00.000Z'
    });
    const ctx = buildProjectDesignContext(makeReport(), stale);

    assert.equal(ctx.directionSource, 'derived');
    assert.equal('density' in ctx.direction, false);
  });

  it('20. artefact d un autre couple tenant/projet : jamais consommé (défense en profondeur)', () => {
    const foreign = buildDesignSystemArtifact({
      report: makeReport({ tenantId: 'tenant-b', projectId: 'proj-b' }),
      direction: APPLIED_DIRECTION,
      dqi: 88,
      recordedAt: '2026-10-18T10:05:00.000Z'
    });
    const ctx = buildProjectDesignContext(makeReport(), foreign);

    assert.equal(ctx.directionSource, 'derived');
    assert.equal('density' in ctx.direction, false);
  });

  it('21. load : artefact frais consommé ; store d artefacts en panne → repli dérivé sans perte du rapport', () => {
    const report = makeReport();
    const artifact = buildDesignSystemArtifact({
      report,
      direction: APPLIED_DIRECTION,
      dqi: 88,
      recordedAt: '2026-10-18T10:05:00.000Z'
    });
    const base = {
      get(tenantId: string, projectId: string): DesignHarmonyReport | undefined {
        return report.tenantId === tenantId && report.projectId === projectId ? report : undefined;
      }
    };

    const withArtifact = loadProjectDesignContext({
      tenantId: 'tenant-a',
      projectId: 'proj-a',
      store: base,
      systemStore: { get: () => artifact }
    });
    assert.ok(withArtifact);
    assert.equal(withArtifact!.directionSource, 'persisted');

    const throwingSystem = {
      get(): DesignSystemArtifact | undefined {
        throw new Error('panne de persistance simulée');
      }
    };
    let fallback: ReturnType<typeof loadProjectDesignContext> = undefined;
    try {
      fallback = loadProjectDesignContext({
        tenantId: 'tenant-a',
        projectId: 'proj-a',
        store: base,
        systemStore: throwingSystem
      });
    } catch (err) {
      assert.fail(`loadProjectDesignContext a jeté : ${String(err)}`);
    }
    assert.ok(fallback);
    assert.equal(fallback!.directionSource, 'derived');
    assert.equal(fallback!.reportId, 'dhr-test-0001');
  });
});
