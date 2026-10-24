/**
 * LOT C — CDC V8 §6 + §8 : Design Direction exploitable + Design Rules
 * auditables (preuves).
 *
 * Prouve que :
 *  1. le catalogue §6 est VERSIONNÉ et couvre les 8 dimensions du CDC ;
 *  2. un override projet ne remplace QUE les dimensions fixées, reste
 *     déterministe et refuse toute valeur hors CDC ;
 *  3. le profil étendu dérive les 8 dimensions des preuves (aucune valeur
 *     inventée sans stats) ;
 *  4. les 10 règles RULE-001..RULE-010 sont évaluées sur des preuves réelles,
 *     avec PASS/FAIL/UNKNOWN + valeur observée + preuves ;
 *  5. les seuils projet et les règles personnalisées bornées sont réellement
 *     appliqués ; une config incohérente est refusée.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CDC_RULE_IDS,
  DEFAULT_DESIGN_RULES_CONFIG,
  DESIGN_DIRECTION_CATALOG_VERSION,
  DESIGN_DIRECTION_PRESETS,
  VisualIntelligenceService,
  TokenInferer,
  applyDesignDirectionOverride,
  auditDesignRules,
  buildDesignDirectionProfile,
  closestDirectionPresetId,
  deriveDesignDirection,
  deriveProfessionalism,
  deriveVisualComplexity,
  extractDocumentCss,
  normalizeDesignDirectionOverride,
  normalizeDesignRulesConfig,
  type DesignDirection,
  type InferredDesignSystem,
  type VisualSnapshot
} from '../../../src/index.js';

const TENANT = 'tenant_lot_c_rules';
const PROJECT = 'proj_lot_c_rules';
const service = new VisualIntelligenceService();
const inferer = new TokenInferer();
let routeCounter = 0;

const CSS = `
  :root { --brand: #2563eb; --ink: #111827; }
  body { background-color: #ffffff; color: var(--ink); font-family: Inter, sans-serif; padding: 24px; }
  h1 { font-size: 40px; margin: 0 0 16px; }
  h2 { font-size: 28px; margin: 24px 0 8px; }
  p { font-size: 16px; margin: 0 0 16px; }
  .btn-primary { background-color: var(--brand); color: #ffffff; border-radius: 8px; padding: 12px 20px; transition: background-color 240ms ease-in-out; }
  .btn-primary:hover { background-color: #1d4ed8; }
  .card { background-color: #f8fafc; border-radius: 12px; padding: 16px; }
`;

const HTML = `<!DOCTYPE html>
<html><head><style>${CSS}</style></head>
<body>
  <h1>Titre principal</h1>
  <p>Premier paragraphe de contenu réel.</p>
  <h2>Sous-titre</h2>
  <p>Deuxième paragraphe de contenu réel.</p>
  <button class="btn-primary" aria-label="Action principale">Agir</button>
  <div class="card">Carte A</div>
  <span style="background-color: #16a34a; color:#ffffff">OK</span>
  <span style="background-color: #f59e0b; color:#111827">Attention</span>
  <span style="background-color: #dc2626; color:#ffffff">Erreur</span>
  <span style="background-color: #0284c7; color:#ffffff">Info</span>
</body></html>`;

async function analyze(): Promise<{ snapshot: VisualSnapshot; tokens: InferredDesignSystem; cssContent: string }> {
  const cssContent = extractDocumentCss(HTML);
  const result = await service.analyzeVisuals({
    tenantId: TENANT,
    projectId: PROJECT,
    pageRoute: `/lot-c-${++routeCounter}`,
    htmlContent: HTML,
    cssContent
  });
  const tokens = inferer.inferDesignSystem([result.snapshot], { cssContent });
  return { snapshot: result.snapshot, tokens, cssContent };
}

const BASE_DIRECTION: DesignDirection = {
  style: 'Balanced Modern',
  density: 'Balanced',
  personality: 'Friendly / Editorial',
  motion: 'Subtle',
  visualEnergy: 'Calm',
  informationDensity: 'Medium',
  evidence: { dominantRadiusPx: 10, colorCount: 5, fontCount: 2 }
};

describe('LOT C §6 — Design Direction : catalogue versionné + override projet', () => {
  it('1. catalogue versionné : 8 dimensions CDC par preset, ids uniques', () => {
    assert.match(DESIGN_DIRECTION_CATALOG_VERSION, /^\d+\.\d+\.\d+$/);
    assert.ok(DESIGN_DIRECTION_PRESETS.length >= 5);
    const ids = new Set<string>();
    for (const preset of DESIGN_DIRECTION_PRESETS) {
      assert.equal(ids.has(preset.id), false, `preset dupliqué : ${preset.id}`);
      ids.add(preset.id);
      assert.deepEqual(
        Object.keys(preset.values).sort(),
        [
          'density',
          'informationDensity',
          'motion',
          'personality',
          'professionalism',
          'style',
          'visualComplexity',
          'visualEnergy'
        ].sort(),
        `preset ${preset.id} doit couvrir les 8 dimensions CDC`
      );
    }
  });

  it('2. profil étendu : 8/8 dimensions dérivées, source et preset traçables', () => {
    const profile = buildDesignDirectionProfile(BASE_DIRECTION);
    assert.equal(profile.catalogVersion, DESIGN_DIRECTION_CATALOG_VERSION);
    assert.equal(profile.style, 'Balanced Modern');
    assert.equal(profile.density, 'Balanced');
    assert.equal(profile.personality, 'Friendly / Editorial');
    assert.equal(profile.visualEnergy, 'Calm');
    assert.equal(profile.motion, 'Subtle');
    assert.equal(profile.professionalism, 'Premium');
    assert.equal(profile.visualComplexity, 'Medium');
    assert.equal(profile.informationDensity, 'Medium');
    assert.equal(profile.source, 'derived');
    assert.ok(profile.closestPresetId, 'un preset proche doit être cité');
    assert.equal(profile.evidence.colorCount, 5);
  });

  it('3. dérivations Professionalism / Visual Complexity : bornes déterministes', () => {
    assert.equal(deriveProfessionalism({ ...BASE_DIRECTION, personality: 'Professional / Technical' }), 'Professional');
    assert.equal(deriveProfessionalism({ ...BASE_DIRECTION, style: 'Soft & Rounded' }), 'Friendly');
    const complex: DesignDirection = {
      ...BASE_DIRECTION,
      evidence: { dominantRadiusPx: 8, colorCount: 10, fontCount: 2 }
    };
    assert.equal(deriveVisualComplexity(complex), 'High');
    assert.equal(
      deriveVisualComplexity({ ...BASE_DIRECTION, evidence: { dominantRadiusPx: 8, colorCount: 3, fontCount: 1 } }),
      'Low'
    );
  });

  it('4. override : seules les dimensions fixées changent, preuves conservées', () => {
    const override = normalizeDesignDirectionOverride({
      style: 'Sharp & Technical',
      professionalism: 'Professional',
      visualComplexity: 'High'
    });
    const applied = applyDesignDirectionOverride(BASE_DIRECTION, override);
    assert.equal(applied.style, 'Sharp & Technical');
    assert.equal(applied.professionalism, 'Professional');
    assert.equal(applied.visualComplexity, 'High');
    assert.equal(applied.density, 'Balanced', 'dimension non fixée inchangée');
    assert.equal(applied.personality, 'Friendly / Editorial');
    assert.deepEqual(applied.evidence, BASE_DIRECTION.evidence);
    assert.equal(BASE_DIRECTION.style, 'Balanced Modern', 'la base n’est jamais mutée');

    const profile = buildDesignDirectionProfile(BASE_DIRECTION, override);
    assert.equal(profile.source, 'override');
    assert.equal(profile.style, 'Sharp & Technical');
    assert.equal(profile.professionalism, 'Professional');
    assert.equal(profile.visualComplexity, 'High');
  });

  it('5. preset le plus proche : déterministe (égalité → ordre du catalogue)', () => {
    const technical = {
      style: 'Sharp & Technical' as const,
      density: 'Dense' as const,
      personality: 'Professional / Technical' as const,
      visualEnergy: 'Calm' as const,
      professionalism: 'Professional' as const,
      motion: 'Subtle' as const,
      visualComplexity: 'High' as const,
      informationDensity: 'High' as const
    };
    assert.equal(closestDirectionPresetId(technical), 'technical-dashboard');
    assert.equal(closestDirectionPresetId(technical), closestDirectionPresetId({ ...technical }));
  });

  it('6. override invalide : clé inconnue, valeur hors CDC ou override vide refusés', () => {
    assert.throws(() => normalizeDesignDirectionOverride({ style: 'Brutalist' }), /Valeur invalide/);
    assert.throws(() => normalizeDesignDirectionOverride({ glow: 'Neon' }), /inconnue/);
    assert.throws(() => normalizeDesignDirectionOverride({}), /vide/);
    assert.throws(() => normalizeDesignDirectionOverride(null), /objet attendu/);
  });
});

describe('LOT C §8 — Design Rules : 10 règles CDC auditables', () => {
  it('7. les 10 règles sont évaluées dans l’ordre, avec preuve et valeur observée', async () => {
    const { snapshot, tokens, cssContent } = await analyze();
    const report = auditDesignRules({
      snapshot,
      tokens,
      cssContent,
      config: DEFAULT_DESIGN_RULES_CONFIG
    });

    assert.equal(report.catalogVersion.length > 0, true);
    assert.deepEqual(
      report.results.map((result) => result.id),
      [...CDC_RULE_IDS]
    );
    assert.equal(report.summary.total, 10);
    assert.equal(report.summary.pass + report.summary.fail + report.summary.unknown, 10);
    for (const result of report.results) {
      assert.ok(result.observedValue.length > 0, `${result.id} doit citer la valeur observée`);
      assert.ok(result.evidence.length > 0, `${result.id} doit citer ses preuves`);
    }
  });

  it('8. règles réellement mesurées : radius/typo/états passent, accents excédentaires échouent', async () => {
    const { snapshot, tokens, cssContent } = await analyze();
    const report = auditDesignRules({ snapshot, tokens, cssContent, config: DEFAULT_DESIGN_RULES_CONFIG });
    const byId = new Map(report.results.map((result) => [result.id, result]));

    assert.equal(byId.get('RULE-003')!.status, 'PASS', 'rayon 12px ≤ 16px');
    assert.match(byId.get('RULE-003')!.observedValue, /12px/);
    assert.equal(byId.get('RULE-004')!.status, 'PASS', '1 H1 + tailles décroissantes');
    assert.equal(byId.get('RULE-005')!.status, 'PASS', 'règle :hover observée');
    assert.equal(byId.get('RULE-006')!.status, 'FAIL', '5 couleurs saturées > 3 accents');
    assert.match(byId.get('RULE-006')!.observedValue, /5 accent/);
  });

  it('9. seuils projet + règle personnalisée : réellement appliqués', async () => {
    const { snapshot, tokens, cssContent } = await analyze();
    const config = normalizeDesignRulesConfig({
      disabledRuleIds: ['RULE-004'],
      thresholds: { maxRadiusPx: 8 },
      customRules: [
        {
          id: 'CUSTOM-RADIUS-4',
          label: 'Rayon projet ≤ 4px',
          metric: 'maxRadiusPx',
          operator: '<=',
          value: 4
        }
      ]
    });
    const report = auditDesignRules({ snapshot, tokens, cssContent, config });

    assert.equal(report.results.length, 10, '9 règles CDC restantes + 1 règle projet');
    assert.equal(report.results.some((result) => result.id === 'RULE-004'), false, 'règle désactivée absente');
    const radius = report.results.find((result) => result.id === 'RULE-003')!;
    assert.equal(radius.status, 'FAIL', 'seuil projet 8px < 12px observé');
    assert.match(radius.expectedValue ?? '', /≤ 8px/);

    const custom = report.results.find((result) => result.id === 'CUSTOM-RADIUS-4')!;
    assert.equal(custom.custom, true);
    assert.equal(custom.status, 'FAIL');
    assert.match(custom.observedValue, /maxRadiusPx = 12/);
    assert.equal(custom.expectedValue, 'maxRadiusPx <= 4');
  });

  it('10. preuve absente → UNKNOWN honnête (jamais un verdict inventé)', async () => {
    const { snapshot } = await analyze();
    const tokensWithoutEvidence = {
      colorTokens: {},
      typographyTokens: {
        primaryFontFamily: '',
        fontFamilies: [],
        detectedScale: [],
        dominantLineHeightRatio: 1.5
      },
      spacingTokens: { baseGridStep: 4, detectedScale: [], regularityRatio: 0 },
      shapeTokens: {
        primaryButtonRadius: '0px',
        primaryCardRadius: '0px',
        primaryInputRadius: '0px',
        detectedRadii: []
      },
      elevationTokens: { detectedLevelsCount: 0, shadowLevels: [] },
      systemConfidence: 0,
      evidenceCount: 0
    } as unknown as InferredDesignSystem;

    const report = auditDesignRules({
      snapshot,
      tokens: tokensWithoutEvidence,
      config: DEFAULT_DESIGN_RULES_CONFIG
    });
    const byId = new Map(report.results.map((result) => [result.id, result]));
    assert.equal(byId.get('RULE-002')!.status, 'UNKNOWN', 'aucune échelle d’espacement');
    assert.equal(byId.get('RULE-003')!.status, 'UNKNOWN', 'aucun rayon');
    assert.equal(byId.get('RULE-005')!.status, 'UNKNOWN', 'aucune preuve CSS/motion');
    assert.equal(byId.get('RULE-007')!.status, 'UNKNOWN', 'aucune durée');
    assert.ok(byId.get('RULE-003')!.observedValue.includes('aucun rayon'));
  });

  it('11. config incohérente refusée (règle inconnue, seuil hors bornes, métrique inconnue)', () => {
    assert.throws(() => normalizeDesignRulesConfig({ disabledRuleIds: ['RULE-999'] }), /inconnue/);
    assert.throws(() => normalizeDesignRulesConfig({ thresholds: { maxRadiusPx: -1 } }), /Seuil invalide/);
    assert.throws(() => normalizeDesignRulesConfig({ thresholds: { maxVisualAccents: 99 } }), /Seuil invalide/);
    assert.throws(
      () =>
        normalizeDesignRulesConfig({
          customRules: [{ id: 'CUSTOM-X', label: 'Test', metric: 'magic', operator: '<=', value: 1 }]
        }),
      /Métrique inconnue/
    );
    assert.throws(
      () =>
        normalizeDesignRulesConfig({
          customRules: [{ id: 'BAD-X', label: 'Test', metric: 'maxRadiusPx', operator: '<=', value: 1 }]
        }),
      /Id de règle projet invalide/
    );
  });

  it('12. direction dérivée sans stats : densités absentes (jamais inventées)', async () => {
    const { tokens } = await analyze();
    const dir = deriveDesignDirection(tokens);
    assert.equal('interactiveElements' in dir.evidence, false);
    assert.equal('totalElements' in dir.evidence, false);
    assert.ok(dir.style.length > 0);
  });
});
