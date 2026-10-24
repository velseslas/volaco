/**
 * LOT C — CDC V8 §24 : DESIGN MEMORY (décisions Decision+Reason mémorisées).
 *
 * Prouve que :
 *  1. l'id est un hash de CONTENU (rejouer la même décision ne duplique pas) ;
 *  2. la raison est OBLIGATOIRE et la supersession est NON destructive ;
 *  3. l'isolation tenant/projet est stricte ;
 *  4. les décisions ACTIVES sont injectées dans le prompt design des
 *     générations ; les IGNORE_OPPORTUNITY ne le sont JAMAIS ;
 *  5. un override de direction (§6) est consommé par le contexte et tracé
 *     (`directionSource = override`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDesignMemoryDecision,
  buildProjectDesignContext,
  computeDesignMemoryId,
  loadProjectDesignContext,
  DesignMemoryStore,
  type DesignHarmonyFinding,
  type DesignHarmonyReport,
  type DesignMemoryDecisionInput,
  type InferredDesignSystem
} from '../../../src/index.js';

const TENANT = 'tenant_lot_c_memory';
const PROJECT = 'proj_lot_c_memory';
const NOW = '2026-10-19T08:00:00.000Z';
const LATER = '2026-10-19T09:00:00.000Z';

function makeFinding(
  id: string,
  category: DesignHarmonyFinding['category'],
  severity: DesignHarmonyFinding['severity'],
  recommendation: string
): DesignHarmonyFinding {
  return {
    id,
    category,
    severity,
    confidence: 0.9,
    pageRoute: '/',
    property: 'test-property',
    observedValue: 'observed',
    recommendation,
    designDrift: true,
    evidence: [{ source: 'DOM_SNAPSHOT', detail: 'preuve de test', pageRoute: '/', occurrences: 1 }]
  };
}

const TOKENS: InferredDesignSystem = {
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
    fontFamilies: ['Inter'],
    detectedScale: ['14px', '16px', '32px'],
    dominantLineHeightRatio: 1.5
  },
  spacingTokens: { baseGridStep: 8, detectedScale: [8, 16, 24], regularityRatio: 0.9 },
  shapeTokens: {
    primaryButtonRadius: '10px',
    primaryCardRadius: '16px',
    primaryInputRadius: '10px',
    detectedRadii: ['10px', '16px']
  },
  elevationTokens: { detectedLevelsCount: 1, shadowLevels: ['0 1px 2px rgba(0,0,0,0.05)'] },
  systemConfidence: 0.8,
  evidenceCount: 100
};

function makeReport(): DesignHarmonyReport {
  return {
    reportId: 'dhr-lotc-memory',
    tenantId: TENANT,
    projectId: PROJECT,
    analyzedRoutes: ['/'],
    overallScore: 80,
    subScores: {
      colorHarmony: 80,
      typographyHarmony: 78,
      spacingHarmony: 82,
      shapeHarmony: 79,
      elevationHarmony: 75,
      componentHarmony: 77,
      crossPageHarmony: 76,
      responsiveA11yHarmony: 74
    },
    inferredDesignSystem: TOKENS,
    findings: [makeFinding('f-color', 'COLOR', 'HIGH', 'Contraste insuffisant')],
    driftSummary: { totalDrifts: 1, criticalDrifts: 0 },
    reportHash: 'hash-lotc-memory',
    generatedAt: '2026-10-19T07:00:00.000Z',
    durationMs: 10
  };
}

function makeDecision(overrides: Record<string, unknown> = {}) {
  return buildDesignMemoryDecision(
    {
      tenantId: TENANT,
      projectId: PROJECT,
      decision: 'Utiliser des tables compactes',
      reason: 'Application destinée à des utilisateurs professionnels manipulant de gros volumes.',
      source: 'HUMAN',
      ...overrides
    } as DesignMemoryDecisionInput,
    { createdAt: NOW, recordedAt: NOW }
  );
}

describe('LOT C §24 — Design Memory (décisions persistantes)', () => {
  it('1. id de contenu déterministe : mêmes entrées → même id, horodatage exclu', () => {
    const a = makeDecision();
    const b = buildDesignMemoryDecision(
      {
        tenantId: TENANT,
        projectId: PROJECT,
        decision: 'Utiliser des tables compactes',
        reason: 'Application destinée à des utilisateurs professionnels manipulant de gros volumes.',
        source: 'HUMAN'
      },
      { createdAt: LATER, recordedAt: LATER }
    );
    assert.equal(a.id, b.id);
    assert.match(a.id, /^dmem:[a-f0-9]{16}$/);
    assert.equal(
      computeDesignMemoryId({
        tenantId: TENANT,
        projectId: PROJECT,
        kind: 'DECISION',
        decision: a.decision,
        reason: a.reason,
        source: 'HUMAN'
      }),
      a.id
    );
    assert.equal(a.status, 'ACTIVE');
    assert.equal(a.createdAt, NOW);
  });

  it('2. enregistrement idempotent + supersession non destructive', () => {
    const store = new DesignMemoryStore({ persist: false });
    const decision = makeDecision();
    const first = store.record(decision);
    const second = store.record(decision);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(store.list(TENANT, PROJECT).length, 1);

    const superseded = store.supersede(TENANT, PROJECT, decision.id, 'studio-user', LATER);
    assert.ok(superseded);
    assert.equal(superseded!.status, 'SUPERSEDED');
    assert.equal(superseded!.supersededBy, 'studio-user');
    assert.equal(superseded!.supersededAt, LATER);
    assert.equal(store.list(TENANT, PROJECT).length, 1, 'aucune suppression');
    assert.equal(store.listActive(TENANT, PROJECT).length, 0);
    assert.equal(
      store.supersede(TENANT, PROJECT, decision.id, 'studio-user', LATER),
      undefined,
      'une décision déjà superseded ne l’est pas deux fois'
    );
  });

  it('3. isolation tenant/projet stricte', () => {
    const store = new DesignMemoryStore({ persist: false });
    store.record(makeDecision());
    assert.equal(store.list(TENANT, 'autre-projet').length, 0);
    assert.equal(store.list('autre-tenant', PROJECT).length, 0);
    assert.equal(store.listActive(TENANT, PROJECT).length, 1);
  });

  it('4. validation : Decision+Reason obligatoires, kind/dimension/opportunity bornés', () => {
    assert.throws(() => makeDecision({ decision: 'ab' }), /"decision" invalide/);
    assert.throws(() => makeDecision({ reason: 'court' }), /"reason" invalide/);
    assert.throws(() => makeDecision({ kind: 'MAGIC' }), /Nature de décision inconnue/);
    assert.throws(() => makeDecision({ dimension: 'magic' }), /Dimension AQS inconnue/);
    assert.throws(() => makeDecision({ kind: 'IGNORE_OPPORTUNITY' }), /exige opportunityId/);
    assert.throws(() => makeDecision({ kind: 'IGNORE_OPPORTUNITY', opportunityId: 'nope' }), /Id d'opportunité invalide/);

    const ignore = makeDecision({
      kind: 'IGNORE_OPPORTUNITY',
      opportunityId: 'opp-spacing_rhythm',
      dimension: 'spacing_rhythm'
    });
    assert.equal(ignore.kind, 'IGNORE_OPPORTUNITY');
    assert.equal(ignore.opportunityId, 'opp-spacing_rhythm');
  });

  it('5. les décisions ACTIVES sont injectées dans le prompt, pas les ignores', () => {
    const store = new DesignMemoryStore({ persist: false });
    const decision = makeDecision();
    const ignore = makeDecision({
      kind: 'IGNORE_OPPORTUNITY',
      opportunityId: 'opp-color_harmony',
      decision: 'Ignorer l’opportunité opp-color_harmony',
      reason: 'Choix produit assumé pour cette itération — sera revu plus tard.'
    });
    store.record(decision);
    store.record(ignore);
    const active = store.listActive(TENANT, PROJECT);

    const ctx = buildProjectDesignContext(makeReport(), undefined, { decisions: active });
    assert.equal(active.length, 2, 'deux décisions actives dans le store');
    assert.equal(ctx.designDecisions.length, 1, 'seules les DECISION sont injectables');
    assert.ok(ctx.promptBlock.includes('Décisions design mémorisées'));
    assert.ok(ctx.promptBlock.includes('tables compactes'));
    assert.ok(ctx.promptBlock.includes('raison : Application destinée'));
    // Seule la décision DECISION entre dans le prompt.
    assert.equal(ctx.promptBlock.includes('opp-color_harmony'), false);
  });

  it('6. chargement réel : décisions + override de direction consommés par le contexte', () => {
    const memoryStore = new DesignMemoryStore({ persist: false });
    memoryStore.record(makeDecision());
    const directionStore = {
      get: () => ({ override: { style: 'Sharp & Technical' as const, density: 'Dense' as const } })
    };
    const ctx = loadProjectDesignContext({
      tenantId: TENANT,
      projectId: PROJECT,
      store: { get: (tenantId, projectId) => (tenantId === TENANT && projectId === PROJECT ? makeReport() : undefined) },
      systemStore: { get: () => undefined },
      memoryStore,
      directionStore
    });
    assert.ok(ctx);
    assert.equal(ctx!.directionSource, 'override');
    assert.equal(ctx!.direction.style, 'Sharp & Technical');
    assert.equal(ctx!.direction.density, 'Dense');
    assert.equal(ctx!.designDecisions.length, 1);
    assert.ok(ctx!.promptBlock.includes('tables compactes'));
  });
});
