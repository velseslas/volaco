/**
 * ÉTAPE 17 — ÉDITION DU VARIANT DE PRÉSENTATION : updateComponentVariant.
 *
 * Les 10 cas du brief + intégration renderer/inspector + absence de fuite.
 * Le variant porte la PRÉSENTATION uniquement : id, type métier, label,
 * parentId, statut et metadata.html restent intouchés.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBuildEvents,
  createPreviewBuildState,
  PRESENTATION_VARIANTS,
  type PreviewBuildEvent,
  type PreviewBuildState
} from '../../src/preview-builder/engine.js';
import { updateComponentVariant, componentVariant } from '../../src/preview-builder/editing.js';
import { renderPreview, buildInspector } from '../../src/preview-builder/renderer.js';

const REAL_HTML = '<section class="stats"><h2>Ventes</h2></section>';

function scenario(): PreviewBuildState {
  const events: PreviewBuildEvent[] = [
    { kind: 'BUILD_STARTED', stage: 'components', timestamp: 1 },
    { kind: 'COMPONENT_CREATED', component: { id: 'revenue', type: 'card', label: 'Revenus', metadata: { html: REAL_HTML, value: '12 456 €' } }, timestamp: 2 },
    { kind: 'COMPONENT_BUILDING', componentId: 'revenue', timestamp: 3 },
    { kind: 'COMPONENT_READY', componentId: 'revenue', timestamp: 4 },
    { kind: 'COMPONENT_CREATED', component: { id: 'orders', type: 'card', label: 'Commandes' }, timestamp: 5 },
    { kind: 'COMPONENT_BUILDING', componentId: 'orders', timestamp: 6 }
  ];
  return applyBuildEvents(createPreviewBuildState(), events);
}

describe('ÉTAPE 17 : updateComponentVariant', () => {
  it('1. changement valide : nouveau state, applied=true, variant porté', () => {
    const s = scenario();
    const result = updateComponentVariant(s, 'revenue', 'featured');
    assert.equal(result.applied, true);
    assert.equal(result.reason, undefined);
    assert.equal(result.state.components.get('revenue')!.variant, 'featured');
    assert.notEqual(result.state, s);
  });

  it('2. variant invalide → refus explicite, état inchangé', () => {
    const s = scenario();
    const result = updateComponentVariant(s, 'revenue', 'explosif');
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'invalid-variant');
    assert.equal(result.state, s);
    // La liste canonique est la seule source de variants valides
    assert.deepEqual([...PRESENTATION_VARIANTS], ['default', 'compact', 'featured', 'wide']);
  });

  it('3. composant inexistant → unknown-component, même référence', () => {
    const s = scenario();
    const result = updateComponentVariant(s, 'fantome', 'compact');
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'unknown-component');
    assert.equal(result.state, s);
  });

  it('4. même variant (et default absent) → unchanged, même référence', () => {
    const s = scenario();
    const applied = updateComponentVariant(s, 'revenue', 'featured');
    const same = updateComponentVariant(applied.state, 'revenue', 'featured');
    assert.equal(same.applied, false);
    assert.equal(same.reason, 'unchanged');
    assert.equal(same.state, applied.state);
    // 'default' explicite sur un composant sans variant = unchanged
    const def = updateComponentVariant(s, 'orders', 'default');
    assert.equal(def.applied, false);
    assert.equal(def.reason, 'unchanged');
    assert.equal(def.state, s);
  });

  it('5. immutabilité : l ancien state n est jamais muté', () => {
    const s = scenario();
    const modelBefore = renderPreview(s);
    updateComponentVariant(s, 'revenue', 'compact');
    assert.equal(s.components.get('revenue')!.variant, undefined, 'l ancien state reste sans variant');
    assert.deepEqual(renderPreview(s), modelBefore);
  });

  it('6. les AUTRES composants restent identiques PAR RÉFÉRENCE', () => {
    const s = scenario();
    const ordersAvant = s.components.get('orders');
    const result = updateComponentVariant(s, 'revenue', 'wide');
    assert.ok(ordersAvant && result.state.components.get('orders') === ordersAvant);
    assert.equal(result.state.events.length, s.events.length);
    assert.equal(result.state.status, s.status);
  });

  it('7. label conservé (l édition É16 reste intacte)', () => {
    const s = scenario();
    assert.equal(componentVariant(s.components.get('revenue')!), 'default');
    const result = updateComponentVariant(s, 'revenue', 'featured');
    const c = result.state.components.get('revenue')!;
    assert.equal(c.label, 'Revenus');
    assert.equal(c.variant, 'featured');
  });

  it('8. metadata.html conservé (même référence objet)', () => {
    const s = scenario();
    const metaAvant = s.components.get('revenue')!.metadata;
    const après = updateComponentVariant(s, 'revenue', 'featured').state.components.get('revenue')!;
    assert.equal(après.metadata, metaAvant);
    assert.equal(après.metadata?.html, REAL_HTML);
  });

  it('9. id conservé (et type métier, parentId, statut, stage, order)', () => {
    const s = scenario();
    const avant = s.components.get('revenue')!;
    const après = updateComponentVariant(s, 'revenue', 'compact').state.components.get('revenue')!;
    assert.equal(après.id, avant.id);
    assert.equal(après.type, avant.type);
    assert.equal(après.parentId, avant.parentId);
    assert.equal(après.status, avant.status);
    assert.equal(après.stage, avant.stage);
    assert.equal(après.order, avant.order);
  });

  it('10. déterminisme : même entrée → même résultat', () => {
    const s = scenario();
    const a = updateComponentVariant(s, 'revenue', 'featured');
    const b = updateComponentVariant(s, 'revenue', 'featured');
    assert.equal(a.state.components.get('revenue')!.variant, b.state.components.get('revenue')!.variant);
    assert.equal(a.applied, b.applied);
  });

  it('11. intégration : renderer + inspector dérivent le variant du state', () => {
    let s = scenario();
    s = updateComponentVariant(s, 'revenue', 'featured').state;
    const model = renderPreview(s);
    assert.equal(model.flat.find((n) => n.id === 'revenue')!.variant, 'featured');
    assert.equal(model.flat.find((n) => n.id === 'orders')!.variant, undefined, 'les autres restent default');
    const inspector = buildInspector(s, 'revenue');
    assert.equal(inspector!.variant, 'featured');
    assert.equal(buildInspector(s, 'orders')!.variant, 'default');
  });

  it('12. aucune fuite : RESET et nouvelle construction repartent sans variant', () => {
    let s = updateComponentVariant(scenario(), 'revenue', 'featured').state;
    // Nouvelle construction (BUILD_STARTED réinitialise les composants)
    s = applyBuildEvents(s, [{ kind: 'BUILD_STARTED', stage: 'structure', timestamp: 100 }]);
    assert.equal(s.components.size, 0, 'RESET/nouveau build : plus de composants');
    const fresh = applyBuildEvents(s, [
      { kind: 'COMPONENT_CREATED', component: { id: 'revenue', type: 'card', label: 'Revenus' }, timestamp: 101 }
    ]);
    assert.equal(fresh.components.get('revenue')!.variant, undefined, 'aucun variant de l ancienne génération ne fuit');
    assert.equal(buildInspector(fresh, 'revenue')!.variant, 'default');
  });
});
