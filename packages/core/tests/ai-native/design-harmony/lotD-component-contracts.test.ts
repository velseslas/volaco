/**
 * LOT D — CDC V8 §9/§10 : CONTRATS COMPOSANTS.
 *
 * Prouve que :
 *  1. le catalogue est versionné, complet (variantes, états, propriétés,
 *     contraintes, relations, règles d'utilisation, a11y, responsive) et
 *     déterministe ;
 *  2. les overrides projet (dépréciation / désactivation) sont validés
 *     strictement (remplacement existant + raison obligatoires) ;
 *  3. la résolution applique les overrides SANS muter le catalogue ;
 *  4. la validation d'une proposition refuse composant inconnu, axe/valeur/
 *     état interdits, composant déprécié (avec remplacement) ou désactivé ;
 *  5. le bloc agent « SYSTÈME DE COMPOSANTS » est borné et place les
 *     dépréciations/désactivations EN TÊTE (jamais tronquées en premier) ;
 *  6. l'audit réel mesure : noms accessibles, cible tactile mobile, états CSS
 *     (hover/focus/active/disabled, MISSING ≠ UNKNOWN), discipline des
 *     variantes, contrôle par tokens, dépréciation utilisée ;
 *  7. sans composant observé : UNKNOWN partout, score null (jamais inventé) ;
 *  8. auditId déterministe (hash de contenu) ;
 *  9. le store persiste par tenant+projet avec isolation et mise à jour.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPONENT_CONTRACTS,
  COMPONENT_CONTRACTS_VERSION,
  COMPONENT_STATE_IDS,
  MAX_COMPONENT_PROMPT_BLOCK_CHARS,
  ComponentContractStore,
  auditComponentContracts,
  buildComponentContextBlock,
  normalizeComponentOverride,
  resolveComponentContracts,
  validateComponentProposal,
  type ComputedStyleSnapshot,
  type InferredDesignSystem,
  type NormalizedDomNode,
  type SemanticRole,
  type VisualSnapshot
} from '../../../src/index.js';

// ---------------------------------------------------------------------------
// Helpers — snapshots synthétiques DÉTERMINISTES (aucun rendu nécessaire).
// ---------------------------------------------------------------------------

const BASE_STYLES: ComputedStyleSnapshot = {
  color: '#111111',
  backgroundColor: '#ffffff',
  fontFamily: 'Inter',
  fontSize: '16px',
  fontWeight: '400',
  lineHeight: '24px',
  padding: '0px',
  margin: '0px',
  borderRadius: '0px',
  borderWidth: '0px',
  borderColor: 'transparent',
  boxShadow: 'none',
  display: 'block',
  flexDirection: 'row',
  justifyContent: 'flex-start',
  alignItems: 'stretch',
  gap: '0px',
  opacity: 1,
  zIndex: 0
};

function makeNode(params: {
  id: string;
  tagName: string;
  role: SemanticRole;
  text?: string | undefined;
  classes?: readonly string[] | undefined;
  attributes?: Record<string, string> | undefined;
  styles?: Partial<ComputedStyleSnapshot> | undefined;
  layout?: Partial<NormalizedDomNode['layout']> | undefined;
  children?: readonly NormalizedDomNode[] | undefined;
  depth?: number | undefined;
  selector?: string | undefined;
}): NormalizedDomNode {
  return {
    id: params.id,
    tagName: params.tagName,
    role: params.role,
    attributes: params.attributes ?? {},
    classes: params.classes ?? [],
    textContent: params.text ?? '',
    styles: { ...BASE_STYLES, ...(params.styles ?? {}) },
    layout: {
      x: 0,
      y: 0,
      width: 200,
      height: 40,
      isVisible: true,
      hasOverflow: false,
      ...(params.layout ?? {})
    },
    children: params.children ?? [],
    depth: params.depth ?? 1,
    selector: params.selector ?? `${params.tagName}${params.classes && params.classes.length > 0 ? '.' + params.classes[0] : ''}`
  };
}

function makeSnapshot(params: {
  pageRoute?: string | undefined;
  viewportKind?: 'DESKTOP' | 'MOBILE' | undefined;
  children: readonly NormalizedDomNode[];
}): VisualSnapshot {
  const mobile = params.viewportKind === 'MOBILE';
  return {
    snapshotId: `snap-${mobile ? 'mobile' : 'desktop'}`,
    tenantId: 'tenant-test',
    projectId: 'project-test',
    pageRoute: params.pageRoute ?? '/',
    viewport: mobile
      ? { kind: 'MOBILE', width: 375, height: 667, scale: 1 }
      : { kind: 'DESKTOP', width: 1280, height: 800, scale: 1 },
    rootNode: makeNode({ id: 'root', tagName: 'body', role: 'CONTAINER', children: params.children, depth: 0 }),
    totalElementsCount: 42,
    interactiveElements: [],
    extractedColors: ['#ffffff', '#111111'],
    extractedFonts: ['Inter'],
    snapshotHash: 'hash-test',
    capturedAt: '2026-10-19T00:00:00.000Z',
    durationMs: 12
  };
}

const TOKENS: InferredDesignSystem = {
  colorTokens: { primary: '#b45309', surface: '#ffffff', foreground: '#111111' },
  typographyTokens: {
    primaryFontFamily: 'Inter',
    fontFamilies: ['Inter'],
    detectedScale: ['16px', '24px'],
    dominantLineHeightRatio: 1.5
  },
  spacingTokens: { baseGridStep: 8, detectedScale: [8, 16, 24, 32], regularityRatio: 1 },
  shapeTokens: {
    primaryButtonRadius: '8px',
    primaryCardRadius: '12px',
    primaryInputRadius: '8px',
    detectedRadii: ['8px', '12px']
  },
  elevationTokens: { detectedLevelsCount: 0, shadowLevels: [] },
  systemConfidence: 0.9,
  evidenceCount: 40
};

const BUTTON_STYLES: Partial<ComputedStyleSnapshot> = {
  padding: '8px 16px',
  fontSize: '16px',
  borderRadius: '8px',
  backgroundColor: '#b45309',
  color: '#ffffff'
};

const CSS = [
  'button:hover { background-color: #92400e; }',
  'button:focus-visible { outline: 2px solid #111111; }',
  'button:active { transform: scale(0.99); }',
  'button:disabled { opacity: 0.5; }',
  '.card { border-radius: 12px; }'
].join('\n');

function desktopChildren(): NormalizedDomNode[] {
  return [
    makeNode({
      id: 'btn-1',
      tagName: 'button',
      role: 'BUTTON',
      text: 'Enregistrer',
      classes: ['btn', 'btn-primary'],
      styles: BUTTON_STYLES,
      layout: { height: 36, width: 160 }
    }),
    makeNode({
      id: 'btn-2',
      tagName: 'button',
      role: 'BUTTON',
      text: 'Annuler',
      classes: ['btn'],
      styles: BUTTON_STYLES,
      layout: { height: 40, width: 140 }
    }),
    makeNode({
      id: 'btn-3',
      tagName: 'button',
      role: 'BUTTON',
      text: '',
      classes: ['btn', 'btn-icon'],
      styles: BUTTON_STYLES,
      layout: { height: 44, width: 44 }
    }),
    makeNode({ id: 'lbl-email', tagName: 'label', role: 'OTHER', text: 'Email', attributes: { for: 'email' } }),
    makeNode({
      id: 'input-email',
      tagName: 'input',
      role: 'INPUT',
      classes: ['input'],
      attributes: { id: 'email', type: 'email' },
      styles: { padding: '8px 16px', fontSize: '16px', borderRadius: '8px' },
      layout: { height: 48, width: 320 }
    }),
    makeNode({
      id: 'input-phone',
      tagName: 'input',
      role: 'INPUT',
      classes: ['input'],
      attributes: { id: 'phone', type: 'tel', placeholder: '+33 6 12 34 56 78' },
      styles: { padding: '8px 16px', fontSize: '16px', borderRadius: '8px' },
      layout: { height: 48, width: 320 }
    }),
    makeNode({
      id: 'card-1',
      tagName: 'div',
      role: 'CONTAINER',
      classes: ['card'],
      text: 'Carte 1',
      styles: { padding: '16px', borderRadius: '12px', fontSize: '16px' },
      layout: { height: 180, width: 300 }
    }),
    makeNode({
      id: 'card-2',
      tagName: 'div',
      role: 'CONTAINER',
      classes: ['card'],
      text: 'Carte 2',
      styles: { padding: '16px', borderRadius: '12px', fontSize: '16px' },
      layout: { height: 220, width: 300 }
    }),
    makeNode({
      id: 'card-3',
      tagName: 'div',
      role: 'CONTAINER',
      classes: ['card'],
      text: 'Carte 3',
      styles: { padding: '16px', borderRadius: '12px', fontSize: '16px' },
      layout: { height: 200, width: 300 }
    }),
    makeNode({
      id: 'table-1',
      tagName: 'table',
      role: 'OTHER',
      classes: ['table'],
      attributes: { 'aria-label': 'Liste des commandes' },
      styles: { fontSize: '16px' },
      layout: { height: 320, width: 800 },
      children: [
        makeNode({ id: 'tbl-caption', tagName: 'caption', role: 'OTHER', text: 'Commandes', depth: 2 }),
        makeNode({
          id: 'tbl-head-row',
          tagName: 'tr',
          role: 'OTHER',
          depth: 2,
          children: [makeNode({ id: 'tbl-th', tagName: 'th', role: 'OTHER', text: 'Client', depth: 3 })]
        })
      ]
    })
  ];
}

function mobileChildren(): NormalizedDomNode[] {
  return [
    makeNode({
      id: 'm-btn-1',
      tagName: 'button',
      role: 'BUTTON',
      text: 'Enregistrer',
      classes: ['btn', 'btn-primary'],
      styles: BUTTON_STYLES,
      layout: { height: 32, width: 140 }
    }),
    makeNode({
      id: 'm-btn-2',
      tagName: 'button',
      role: 'BUTTON',
      text: 'Annuler',
      classes: ['btn'],
      styles: BUTTON_STYLES,
      layout: { height: 32, width: 120 }
    }),
    makeNode({
      id: 'm-btn-3',
      tagName: 'button',
      role: 'BUTTON',
      text: '',
      classes: ['btn', 'btn-icon'],
      styles: BUTTON_STYLES,
      layout: { height: 36, width: 36 }
    }),
    makeNode({
      id: 'm-input-email',
      tagName: 'input',
      role: 'INPUT',
      classes: ['input'],
      attributes: { id: 'email', type: 'email', 'aria-label': 'Email' },
      styles: { padding: '8px 16px', fontSize: '16px', borderRadius: '8px' },
      layout: { height: 48, width: 320 }
    })
  ];
}

// ---------------------------------------------------------------------------
// 1. Catalogue §9/§10 — invariants
// ---------------------------------------------------------------------------

describe('LOT D — catalogue composants §9/§10', () => {
  it('1. catalogue versionné : 9 contrats uniques, profils complets (CDC DataTable inclus)', () => {
    assert.equal(COMPONENT_CONTRACTS_VERSION, '1.0.0');
    assert.equal(COMPONENT_CONTRACTS.length, 9);
    const ids = COMPONENT_CONTRACTS.map((contract) => contract.id);
    assert.equal(new Set(ids).size, ids.length, 'ids uniques');

    for (const contract of COMPONENT_CONTRACTS) {
      assert.match(contract.id, /^[a-z][a-z0-9-]{1,40}$/);
      assert.ok(contract.purpose.length >= 8, `${contract.id} : purpose réel`);
      assert.ok(contract.variants.length >= 1, `${contract.id} : au moins un axe de variante`);
      for (const axis of contract.variants) {
        assert.ok(axis.values.length >= 1, `${contract.id}.${axis.id} : valeurs non vides`);
      }
      assert.ok(contract.requiredStates.length >= 1, `${contract.id} : états requis`);
      for (const state of [...contract.requiredStates, ...contract.optionalStates]) {
        assert.ok(COMPONENT_STATE_IDS.includes(state), `${contract.id} : état connu ${state}`);
      }
      assert.equal(contract.properties.spacing, 'TOKEN_CONTROLLED');
      assert.equal(contract.properties.typography, 'TOKEN_CONTROLLED');
      assert.equal(contract.properties.radius, 'TOKEN_CONTROLLED');
      assert.equal(contract.responsive.required, true);
      assert.ok(contract.responsive.minTouchTargetPx >= 44);
      assert.ok(contract.constraints.length >= 1, `${contract.id} : contraintes`);
      assert.ok(contract.usageRules.length >= 1, `${contract.id} : règles d'utilisation`);
      assert.ok(contract.accessibility.length >= 1, `${contract.id} : a11y`);
      assert.ok(contract.relations.composedOf.length >= 1, `${contract.id} : relations`);
      assert.ok(contract.variantChecks.length >= 1, `${contract.id} : vérifications de variantes`);
    }
  });

  it('2. DataTable (exemple CDC §10) : variantes Compact/Standard/Dense + 7 états', () => {
    const table = COMPONENT_CONTRACTS.find((contract) => contract.id === 'data-table');
    assert.ok(table, 'data-table présent');
    assert.deepEqual(
      table.variants.find((axis) => axis.id === 'density')?.values,
      ['compact', 'standard', 'dense']
    );
    for (const state of ['default', 'loading', 'empty', 'error', 'success', 'selected', 'disabled']) {
      assert.ok(table.requiredStates.includes(state as (typeof COMPONENT_STATE_IDS)[number]), `état requis ${state}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 2-3. Overrides projet — validation et résolution
// ---------------------------------------------------------------------------

describe('LOT D — overrides projet (dépréciation / désactivation)', () => {
  it('3. normalizeComponentOverride : refus stricts, dépréciation traçable', () => {
    const valid = normalizeComponentOverride(
      { status: 'DEPRECATED', replacementId: 'data-table', reason: 'Remplacée par le tableau de données du CDC.' },
      'card'
    );
    assert.deepEqual(valid, {
      status: 'DEPRECATED',
      replacementId: 'data-table',
      reason: 'Remplacée par le tableau de données du CDC.'
    });
    assert.deepEqual(normalizeComponentOverride({ status: 'AVAILABLE' }, 'card'), { status: 'AVAILABLE' });
    assert.deepEqual(
      normalizeComponentOverride({ status: 'DISABLED', reason: 'Composant retiré du design system projet.' }, 'badge'),
      { status: 'DISABLED', reason: 'Composant retiré du design system projet.' }
    );

    assert.throws(() => normalizeComponentOverride({ status: 'DEPRECATED' }, 'inconnu'), /Composant inconnu/);
    assert.throws(() => normalizeComponentOverride({ status: 'WRONG' }, 'card'), /Statut de composant invalide/);
    assert.throws(() => normalizeComponentOverride({ status: 'DEPRECATED', reason: 'court' }, 'card'), /raison est obligatoire/);
    assert.throws(
      () => normalizeComponentOverride({ status: 'DEPRECATED', replacementId: 'inconnu', reason: 'Une raison assez longue.' }, 'card'),
      /remplacement existant/
    );
    assert.throws(
      () => normalizeComponentOverride({ status: 'DEPRECATED', replacementId: 'card', reason: 'Une raison assez longue.' }, 'card'),
      /ne peut pas être lui-même/
    );
    assert.throws(() => normalizeComponentOverride({ status: 'DISABLED' }, 'card'), /raison est obligatoire/);
  });

  it('4. resolveComponentContracts : override appliqué SANS muter le catalogue', () => {
    const effective = resolveComponentContracts([
      {
        componentId: 'card',
        override: { status: 'DEPRECATED', replacementId: 'data-table', reason: 'Remplacer par DataTable.' },
        updatedAt: '2026-10-19T10:00:00.000Z'
      },
      { componentId: 'badge', override: { status: 'DISABLED', reason: 'Retiré du design system projet.' }, updatedAt: '2026-10-19T10:00:00.000Z' },
      { componentId: 'button', override: { status: 'AVAILABLE' }, updatedAt: '2026-10-19T10:00:00.000Z' }
    ]);
    assert.equal(effective.length, 9);
    const card = effective.find((contract) => contract.id === 'card');
    assert.equal(card?.status, 'DEPRECATED');
    assert.equal(card?.deprecated?.replacementId, 'data-table');
    assert.equal(card?.deprecated?.since, '2026-10-19');
    const badge = effective.find((contract) => contract.id === 'badge');
    assert.equal(badge?.status, 'DISABLED');
    const button = effective.find((contract) => contract.id === 'button');
    assert.equal(button?.status, 'AVAILABLE');

    // Catalogue toujours intact.
    const catalogCard = COMPONENT_CONTRACTS.find((contract) => contract.id === 'card');
    assert.deepEqual(catalogCard?.variants, card?.variants);
    assert.equal(COMPONENT_CONTRACTS.every((contract) => !('status' in contract)), true);
  });
});

// ---------------------------------------------------------------------------
// 5. Validation d'une proposition (garde-fou UI Agent)
// ---------------------------------------------------------------------------

describe('LOT D — validation des propositions de génération', () => {
  it('5. refus : composant inconnu, axe/valeur/état interdits', () => {
    const effective = resolveComponentContracts([]);
    const unknown = validateComponentProposal({ componentId: 'carousel' }, effective);
    assert.equal(unknown.accepted, false);
    assert.equal(unknown.status, 'UNKNOWN');
    assert.equal(unknown.violations[0]?.code, 'UNKNOWN_COMPONENT');

    const badAxis = validateComponentProposal({ componentId: 'button', variants: { tone: 'primary' } }, effective);
    assert.ok(badAxis.violations.some((violation) => violation.code === 'UNKNOWN_VARIANT_AXIS'));

    const badValue = validateComponentProposal({ componentId: 'button', variants: { emphasis: 'tertiary' } }, effective);
    assert.ok(badValue.violations.some((violation) => violation.code === 'VARIANT_VALUE_NOT_ALLOWED'));

    const badState = validateComponentProposal({ componentId: 'button', states: ['hover', 'exploded'] }, effective);
    assert.ok(badState.violations.some((violation) => violation.code === 'STATE_NOT_ALLOWED'));

    const ok = validateComponentProposal(
      { componentId: 'button', variants: { emphasis: 'primary', size: 'large' }, states: ['hover', 'loading'] },
      effective
    );
    assert.equal(ok.accepted, true);
    assert.equal(ok.violations.length, 0);
  });

  it('6. composant déprécié refusé AVEC remplacement ; composant désactivé refusé', () => {
    const effective = resolveComponentContracts([
      {
        componentId: 'card',
        override: { status: 'DEPRECATED', replacementId: 'data-table', reason: 'Remplacer par DataTable.' },
        updatedAt: '2026-10-19T10:00:00.000Z'
      },
      { componentId: 'badge', override: { status: 'DISABLED', reason: 'Retiré du projet.' }, updatedAt: '2026-10-19T10:00:00.000Z' }
    ]);
    const deprecated = validateComponentProposal({ componentId: 'card' }, effective);
    assert.equal(deprecated.accepted, false);
    assert.equal(deprecated.status, 'DEPRECATED');
    assert.equal(deprecated.replacementId, 'data-table');
    assert.equal(deprecated.violations[0]?.code, 'COMPONENT_DEPRECATED');

    const disabled = validateComponentProposal({ componentId: 'badge' }, effective);
    assert.equal(disabled.accepted, false);
    assert.equal(disabled.status, 'DISABLED');
    assert.equal(disabled.violations[0]?.code, 'COMPONENT_DISABLED');
  });

  it('7. bloc agent borné : dépréciations/désactivations EN TÊTE, jamais tronquées', () => {
    const effective = resolveComponentContracts([
      {
        componentId: 'card',
        override: { status: 'DEPRECATED', replacementId: 'data-table', reason: 'Remplacer par DataTable.' },
        updatedAt: '2026-10-19T10:00:00.000Z'
      },
      { componentId: 'badge', override: { status: 'DISABLED', reason: 'Retiré du projet.' }, updatedAt: '2026-10-19T10:00:00.000Z' }
    ]);
    const block = buildComponentContextBlock(effective);
    assert.ok(block.startsWith('SYSTÈME DE COMPOSANTS OBLIGATOIRE'));
    assert.ok(block.includes('DÉPRÉCIÉ — remplacer par data-table'));
    assert.ok(block.includes('INDISPONIBLE — ne pas utiliser'));
    assert.ok(block.length <= MAX_COMPONENT_PROMPT_BLOCK_CHARS);
    assert.ok(block.includes('ne recrée jamais un composant existant'));
  });
});

// ---------------------------------------------------------------------------
// 6-8. Audit réel
// ---------------------------------------------------------------------------

describe('LOT D — audit réel des composants observés', () => {
  it('8. détection + a11y + cible tactile + états CSS + tokens + variantes', () => {
    const desktop = makeSnapshot({ children: desktopChildren() });
    const mobile = makeSnapshot({ viewportKind: 'MOBILE', children: mobileChildren() });
    const report = auditComponentContracts({
      snapshots: [desktop],
      mobileSnapshots: [mobile],
      tokens: TOKENS,
      cssContent: CSS,
      contracts: resolveComponentContracts([])
    });

    assert.equal(report.catalogVersion, '1.0.0');
    assert.match(report.auditId, /^cca-[0-9a-f]{16}$/);
    assert.deepEqual(report.pages, ['/']);
    assert.equal(report.items.length, 9);

    const button = report.items.find((item) => item.componentId === 'button');
    assert.ok(button, 'button audité');
    assert.equal(button.observedCount, 3);
    assert.equal(button.status, 'FAIL');
    assert.equal(button.score, 70);
    const codes = button.findings.map((finding) => finding.code);
    assert.ok(codes.includes('ACCESSIBLE_NAME_MISSING'), 'bouton sans libellé détecté');
    assert.ok(codes.includes('TOUCH_TARGET_TOO_SMALL'), 'cible tactile mobile détectée');
    const buttonStates = new Map(button.states.map((state) => [state.state, state.status]));
    assert.equal(buttonStates.get('hover'), 'DECLARED');
    assert.equal(buttonStates.get('focus'), 'DECLARED');
    assert.equal(buttonStates.get('active'), 'DECLARED');
    assert.equal(buttonStates.get('disabled'), 'DECLARED');
    assert.equal(buttonStates.get('loading'), 'UNKNOWN');
    assert.equal(button.variantChecks[0]?.status, 'PASS');
    assert.equal(button.tokenControl.overall, 100);

    const input = report.items.find((item) => item.componentId === 'input');
    assert.ok(input);
    assert.equal(input.observedCount, 2);
    assert.equal(input.status, 'PASS');
    assert.equal(input.findings[0]?.code, 'PLACEHOLDER_ONLY_LABEL');
    assert.equal(input.findings[0]?.severity, 'MEDIUM');

    const table = report.items.find((item) => item.componentId === 'data-table');
    assert.ok(table);
    assert.equal(table.observedCount, 1);
    assert.equal(table.status, 'PASS');
    const tableStates = new Map(table.states.map((state) => [state.state, state.status]));
    assert.equal(tableStates.get('default'), 'DECLARED');
    assert.equal(tableStates.get('loading'), 'UNKNOWN', 'état piloté par le code : UNKNOWN, pas de FAIL inventé');
    assert.equal(table.findings.length, 0, 'th + caption + aria-label réels → aucun finding');

    assert.equal(report.summary.observed, 4);
    assert.equal(report.summary.pass, 3);
    assert.equal(report.summary.fail, 1);
    assert.equal(report.summary.unknown, 5);
    assert.equal(report.summary.findings, 3);
    assert.equal(report.summary.componentContractScore, 88);
    assert.equal(report.summary.coverage, 0.44);
  });

  it('8b. état requis MISSING (sélecteur de famille réel sans l’état) = finding mesuré', () => {
    const desktop = makeSnapshot({
      children: [
        makeNode({
          id: 'solo-btn',
          tagName: 'button',
          role: 'BUTTON',
          text: 'Valider',
          classes: ['btn'],
          styles: BUTTON_STYLES,
          layout: { height: 40, width: 140 }
        })
      ]
    });
    const report = auditComponentContracts({
      snapshots: [desktop],
      tokens: TOKENS,
      cssContent: 'button:hover { background-color: #92400e; }',
      contracts: resolveComponentContracts([])
    });
    const button = report.items.find((item) => item.componentId === 'button');
    assert.ok(button);
    const codes = button.findings.map((finding) => finding.code);
    assert.ok(codes.includes('STATE_FOCUS_MISSING'));
    assert.ok(codes.includes('STATE_ACTIVE_MISSING'));
    assert.ok(codes.includes('STATE_DISABLED_MISSING'));
    const states = new Map(button.states.map((state) => [state.state, state.status]));
    assert.equal(states.get('hover'), 'DECLARED');
    assert.equal(states.get('focus'), 'MISSING');
    assert.equal(button.score, 70);
  });

  it('9. composant déprécié encore utilisé = échec explicite avec remplacement', () => {
    const desktop = makeSnapshot({ children: desktopChildren() });
    const mobile = makeSnapshot({ viewportKind: 'MOBILE', children: mobileChildren() });
    const effective = resolveComponentContracts([
      {
        componentId: 'card',
        override: { status: 'DEPRECATED', replacementId: 'data-table', reason: 'Remplacer les cartes de données par DataTable.' },
        updatedAt: '2026-10-19T10:00:00.000Z'
      }
    ]);
    const report = auditComponentContracts({
      snapshots: [desktop],
      mobileSnapshots: [mobile],
      tokens: TOKENS,
      cssContent: CSS,
      contracts: effective
    });
    const card = report.items.find((item) => item.componentId === 'card');
    assert.ok(card);
    assert.equal(card.status, 'FAIL');
    const finding = card.findings.find((entry) => entry.code === 'COMPONENT_DEPRECATED');
    assert.ok(finding, 'dépréciation utilisée détectée');
    assert.equal(finding.severity, 'HIGH');
    assert.equal(finding.expectedValue, 'data-table');
    assert.deepEqual(report.summary.deprecatedUsage, ['card']);
    assert.deepEqual(report.summary.disabledUsage, []);
  });

  it('10. composant désactivé encore utilisé = échec explicite', () => {
    const desktop = makeSnapshot({ children: desktopChildren() });
    const effective = resolveComponentContracts([
      { componentId: 'card', override: { status: 'DISABLED', reason: 'Cartes retirées du design system projet.' }, updatedAt: '2026-10-19T10:00:00.000Z' }
    ]);
    const report = auditComponentContracts({
      snapshots: [desktop],
      tokens: TOKENS,
      cssContent: CSS,
      contracts: effective
    });
    const card = report.items.find((item) => item.componentId === 'card');
    assert.equal(card?.findings.some((entry) => entry.code === 'COMPONENT_DISABLED_USED'), true);
    assert.deepEqual(report.summary.disabledUsage, ['card']);
  });

  it('11. sans composant observé : UNKNOWN partout, score null (jamais inventé)', () => {
    const empty = makeSnapshot({ children: [] });
    const report = auditComponentContracts({
      snapshots: [empty],
      tokens: TOKENS,
      contracts: resolveComponentContracts([])
    });
    assert.equal(report.summary.observed, 0);
    assert.equal(report.summary.componentContractScore, null);
    assert.equal(report.summary.coverage, 0);
    assert.equal(report.summary.unknown, 9);
    assert.equal(report.items.every((item) => item.status === 'UNKNOWN' && item.score === null), true);
  });

  it('12. auditId déterministe (hash de contenu, aucun random)', () => {
    const desktop = makeSnapshot({ children: desktopChildren() });
    const input = {
      snapshots: [desktop],
      tokens: TOKENS,
      cssContent: CSS,
      contracts: resolveComponentContracts([])
    };
    const first = auditComponentContracts(input);
    const second = auditComponentContracts(input);
    assert.equal(first.auditId, second.auditId);
    assert.notEqual(first.analyzedAt.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 9. Store — persistance par projet
// ---------------------------------------------------------------------------

describe('LOT D — ComponentContractStore', () => {
  it('13. upsert par composant, isolation tenant+projet, clear non destructif du catalogue', () => {
    const store = new ComponentContractStore({ persist: false });
    assert.deepEqual(store.list('t1', 'p1'), []);
    assert.equal(store.get('t1', 'p1', 'card'), undefined);

    const first = store.set({
      tenantId: 't1',
      projectId: 'p1',
      componentId: 'card',
      override: { status: 'DEPRECATED', replacementId: 'data-table', reason: 'Remplacer par DataTable.' },
      updatedBy: 'engineer',
      updatedAt: '2026-10-19T10:00:00.000Z'
    });
    assert.equal(first.catalogVersion, '1.0.0');
    assert.equal(first.updatedBy, 'engineer');
    assert.equal(store.list('t1', 'p1').length, 1);
    assert.deepEqual(store.list('t2', 'p1'), [], 'isolation tenant');
    assert.deepEqual(store.list('t1', 'p2'), [], 'isolation projet');

    store.set({
      tenantId: 't1',
      projectId: 'p1',
      componentId: 'card',
      override: { status: 'DISABLED', reason: 'Retiré du projet.' },
      updatedBy: 'engineer',
      updatedAt: '2026-10-19T11:00:00.000Z'
    });
    assert.equal(store.list('t1', 'p1').length, 1, 'upsert par composant');
    assert.equal(store.get('t1', 'p1', 'card')?.override.status, 'DISABLED');

    store.set({
      tenantId: 't1',
      projectId: 'p1',
      componentId: 'badge',
      override: { status: 'DISABLED', reason: 'Retiré du projet.' },
      updatedBy: 'engineer',
      updatedAt: '2026-10-19T11:00:00.000Z'
    });
    assert.deepEqual(
      store.list('t1', 'p1').map((entry) => entry.componentId),
      ['badge', 'card'],
      'ordre stable trié'
    );

    assert.equal(store.clearFor('t1', 'p1', 'card'), true);
    assert.equal(store.clearFor('t1', 'p1', 'card'), false);
    assert.equal(store.list('t1', 'p1').length, 1);
    // Le catalogue n'est jamais touché par le store.
    assert.equal(COMPONENT_CONTRACTS.length, 9);
  });
});
