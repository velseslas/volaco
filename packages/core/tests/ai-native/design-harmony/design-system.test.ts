/**
 * VibeCode Core — Design Harmony
 * CDC V8 §11 LOT 1 — Catalogue de règles versionné + artefact Design System
 * persisté (tokens + direction + règles appliquées) : tests de preuve.
 *
 * Preuves :
 *  - catalogue : version sémantique, ids uniques/stables, textes construits
 *    DÉTERMINISTEMENT des tokens, règles conditionnelles jamais inventées ;
 *  - artefact : construit uniquement depuis un rapport RÉEL (aucun verdict
 *    fabriqué), artifactId déterministe (recordedAt exclu), règles du
 *    catalogue appliquées, gel en profondeur ;
 *  - store : upsert par couple tenant/projet, isolation à la lecture,
 *    clear pour les tests, aucune écriture dans les fichiers projet.
 *
 * Déterministe : aucun réseau, aucune horloge réelle.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAppliedDesignRules,
  buildDesignSystemArtifact,
  computeDesignSystemArtifactId,
  deriveDesignDirection,
  designRulesInputFromTokens,
  DesignSystemStore,
  DESIGN_RULES_CATALOG,
  DESIGN_RULES_CATALOG_VERSION,
  DESIGN_SYSTEM_SCHEMA_VERSION,
  type DesignHarmonyReport,
  type DesignRulesInput,
  type InferredDesignSystem
} from '../../../src/index.js';

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
    reportId: 'dhr-test-lot1',
    tenantId: 'tenant-lot1',
    projectId: 'proj-lot1',
    analyzedRoutes: ['/', '/menu'],
    overallScore: 77,
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
    findings: [],
    driftSummary: { totalDrifts: 0, criticalDrifts: 0 },
    reportHash: 'hash-lot1',
    generatedAt: '2026-10-18T11:00:00.000Z',
    durationMs: 20,
    ...overrides
  };
}

const EMPTY_RULE_INPUT: DesignRulesInput = {
  palette: [],
  primaryFontFamily: '',
  fontFamilies: [],
  baseGridStep: 8,
  spacingScale: [],
  radii: [],
  shadowLevelsCount: 0
};

describe('CDC V8 §11 Lot 1 — catalogue de règles versionné', () => {
  it('1. version sémantique + ids uniques + catégories déclarées', () => {
    assert.match(DESIGN_RULES_CATALOG_VERSION, /^\d+\.\d+\.\d+$/);
    const ids = DESIGN_RULES_CATALOG.map((rule) => rule.id);
    assert.equal(new Set(ids).size, ids.length, 'ids uniques');
    for (const rule of DESIGN_RULES_CATALOG) {
      assert.ok(rule.id.trim().length > 0);
      assert.ok(rule.description.trim().length > 0, `description présente pour ${rule.id}`);
    }
  });

  it('2. tokens complets → 7 règles dans l ordre du catalogue, ids et textes exacts', () => {
    const applied = buildAppliedDesignRules(designRulesInputFromTokens(BASE_TOKENS));

    assert.deepEqual(
      applied.map((rule) => rule.id),
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
    assert.equal(
      applied[2]!.text,
      'Espacement : multiples de 8px (échelle observée : 8/16/24/32/48px).'
    );
    assert.equal(
      applied[6]!.text,
      'Accessibilité : contraste texte ≥ 4.5:1 et libellé explicite sur chaque interaction.'
    );
    assert.ok(applied[0]!.text.includes('primary #b45309'));
    assert.ok(applied[1]!.text.includes('« Inter »'));
  });

  it('3. entrée vide → seules les règles TOUJOURS applicables (aucune règle inventée)', () => {
    const applied = buildAppliedDesignRules(EMPTY_RULE_INPUT);

    assert.deepEqual(
      applied.map((rule) => rule.id),
      ['spacing.grid-base', 'structure.semantics', 'a11y.contrast-labels']
    );
    assert.equal(applied[0]!.text, 'Espacement : multiples de 8px.');
  });

  it('4. designRulesInputFromTokens : bornes et filtrage des tokens réels', () => {
    const manyColors: Record<string, string> = {};
    for (let i = 1; i <= 15; i += 1) manyColors[`role${i}`] = `#00000${i % 10}`;
    const tokens: InferredDesignSystem = {
      ...BASE_TOKENS,
      colorTokens: { ...manyColors, vide: '   ' } as InferredDesignSystem['colorTokens'],
      typographyTokens: { ...BASE_TOKENS.typographyTokens, primaryFontFamily: ' Inter ', fontFamilies: ['Inter', '', 'Mono', 'Serif', 'Extra'] },
      spacingTokens: { baseGridStep: 4, detectedScale: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40], regularityRatio: 0.9 },
      shapeTokens: { ...BASE_TOKENS.shapeTokens, detectedRadii: ['2px', '4px', '8px', '12px', '16px', '24px', '32px'] }
    };

    const input = designRulesInputFromTokens(tokens);
    assert.equal(input.palette.length, 12, 'palette bornée à 12');
    assert.equal(input.palette.some((p) => p.value.trim().length === 0), false, 'valeurs vides exclues');
    assert.equal(input.primaryFontFamily, 'Inter', 'police primaire trimmée');
    assert.equal(input.fontFamilies.length, 4, 'familles bornées à 4');
    assert.equal(input.spacingScale.length, 8, 'échelle bornée à 8');
    assert.equal(input.radii.length, 6, 'rayons bornés à 6');
  });

  it('5. déterminisme : deux instanciations identiques (mêmes tokens → mêmes règles)', () => {
    const a = buildAppliedDesignRules(designRulesInputFromTokens(BASE_TOKENS));
    const b = buildAppliedDesignRules(designRulesInputFromTokens(BASE_TOKENS));
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });
});

describe('CDC V8 §11 Lot 1 — artefact Design System (build déterministe)', () => {
  const DIRECTION = deriveDesignDirection(BASE_TOKENS, {
    extractedColorCount: 5,
    extractedFonts: ['Inter'],
    interactiveElementsCount: 30,
    totalElementsCount: 400
  });

  it('6. champs réels : rapport source, tokens embarqués, direction appliquée, règles versionnées', () => {
    const report = makeReport();
    const artifact = buildDesignSystemArtifact({
      report,
      direction: DIRECTION,
      dqi: 84,
      recordedAt: '2026-10-18T11:05:00.000Z'
    });

    assert.equal(artifact.schemaVersion, DESIGN_SYSTEM_SCHEMA_VERSION);
    assert.match(artifact.artifactId, /^dsa:[0-9a-f]{16}$/);
    assert.equal(artifact.tenantId, 'tenant-lot1');
    assert.equal(artifact.projectId, 'proj-lot1');
    assert.deepEqual(artifact.source, {
      reportId: 'dhr-test-lot1',
      reportHash: 'hash-lot1',
      overallScore: 77,
      dqi: 84
    });
    assert.deepEqual(artifact.analyzedRoutes, ['/', '/menu']);
    assert.equal(artifact.generatedAt, '2026-10-18T11:00:00.000Z');
    assert.equal(artifact.recordedAt, '2026-10-18T11:05:00.000Z');
    assert.deepEqual(artifact.direction, DIRECTION);
    assert.deepEqual(artifact.tokens, report.inferredDesignSystem);
    assert.equal(artifact.rules.catalogVersion, DESIGN_RULES_CATALOG_VERSION);
    assert.deepEqual(
      artifact.rules.items,
      buildAppliedDesignRules(designRulesInputFromTokens(report.inferredDesignSystem))
    );
  });

  it('7. artifactId déterministe : recordedAt exclu, direction incluse', () => {
    const report = makeReport();
    const a = buildDesignSystemArtifact({ report, direction: DIRECTION, dqi: 84, recordedAt: '2026-10-18T11:05:00.000Z' });
    const b = buildDesignSystemArtifact({ report, direction: DIRECTION, dqi: 61, recordedAt: '2026-10-19T08:00:00.000Z' });

    assert.equal(a.artifactId, b.artifactId, 'même contenu de référence → même id (dqi/recordedAt exclus)');

    const other = deriveDesignDirection({ ...BASE_TOKENS, shapeTokens: { ...BASE_TOKENS.shapeTokens, primaryButtonRadius: '4px' } });
    const c = buildDesignSystemArtifact({ report, direction: other, dqi: 84, recordedAt: '2026-10-18T11:05:00.000Z' });
    assert.notEqual(c.artifactId, a.artifactId, 'direction différente → id différent');
  });

  it('8. computeDesignSystemArtifactId : format stable dsa: + 16 hex', () => {
    const id = computeDesignSystemArtifactId({
      tenantId: 't',
      projectId: 'p',
      schemaVersion: DESIGN_SYSTEM_SCHEMA_VERSION,
      sourceReportHash: 'h',
      catalogVersion: DESIGN_RULES_CATALOG_VERSION,
      direction: DIRECTION
    });
    assert.match(id, /^dsa:[0-9a-f]{16}$/);
  });

  it('9. artefact gelé en profondeur (immutabilité)', () => {
    const artifact = buildDesignSystemArtifact({
      report: makeReport(),
      direction: DIRECTION,
      dqi: 84,
      recordedAt: '2026-10-18T11:05:00.000Z'
    });
    assert.ok(Object.isFrozen(artifact));
    assert.ok(Object.isFrozen(artifact.tokens));
    assert.ok(Object.isFrozen(artifact.direction));
    assert.ok(Object.isFrozen(artifact.rules));
    assert.ok(Object.isFrozen(artifact.rules.items));
  });
});

describe('CDC V8 §11 Lot 1 — DesignSystemStore (upsert, isolation, clear)', () => {
  const DIRECTION = deriveDesignDirection(BASE_TOKENS);

  function makeArtifact(report: DesignHarmonyReport, recordedAt: string) {
    return buildDesignSystemArtifact({ report, direction: DIRECTION, dqi: 80, recordedAt });
  }

  it('10. record/get : aller-retour réel + has', () => {
    const store = new DesignSystemStore();
    const artifact = makeArtifact(makeReport(), '2026-10-18T11:05:00.000Z');

    store.record(artifact);
    assert.equal(store.has('tenant-lot1', 'proj-lot1'), true);
    const found = store.get('tenant-lot1', 'proj-lot1');
    assert.ok(found);
    assert.equal(found!.artifactId, artifact.artifactId);
    assert.deepEqual(found!.rules.items, artifact.rules.items);
  });

  it('11. upsert : le nouveau artefact REMPLACE le précédent (dernier artefact)', () => {
    const store = new DesignSystemStore();
    const first = makeArtifact(makeReport(), '2026-10-18T11:05:00.000Z');
    const second = makeArtifact(makeReport({ reportId: 'dhr-test-lot1-bis', reportHash: 'hash-lot1-bis' }), '2026-10-18T12:00:00.000Z');

    store.record(first);
    store.record(second);
    assert.equal(store.get('tenant-lot1', 'proj-lot1')!.artifactId, second.artifactId);
    assert.notEqual(first.artifactId, second.artifactId);
  });

  it('12. isolation : un autre couple tenant/projet ne voit rien', () => {
    const store = new DesignSystemStore();
    store.record(makeArtifact(makeReport(), '2026-10-18T11:05:00.000Z'));

    assert.equal(store.get('tenant-autre', 'proj-lot1'), undefined);
    assert.equal(store.get('tenant-lot1', 'proj-autre'), undefined);
    assert.equal(store.has('tenant-autre', 'proj-autre'), false);
  });

  it('13. store vide : aucune lecture fabriquée ; clear = plus rien', () => {
    const store = new DesignSystemStore();
    assert.equal(store.get('tenant-lot1', 'proj-lot1'), undefined);

    store.record(makeArtifact(makeReport(), '2026-10-18T11:05:00.000Z'));
    store.clear();
    assert.equal(store.has('tenant-lot1', 'proj-lot1'), false);
  });

  it('14. artefact stocké indépendant du rapport source (clone à l enregistrement)', () => {
    const store = new DesignSystemStore();
    const artifact = makeArtifact(makeReport(), '2026-10-18T11:05:00.000Z');
    store.record(artifact);

    const stored = store.get('tenant-lot1', 'proj-lot1')!;
    assert.notEqual(stored, artifact, 'objet stocké distinct (pas de référence partagée)');
    assert.deepEqual(stored, JSON.parse(JSON.stringify(artifact)));
  });
});
