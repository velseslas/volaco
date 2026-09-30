/**
 * ÉTAPE 15 — INSPECTOR DESCRIPTIF (pur, en lecture seule).
 *
 * Les 9 cas du brief. buildInspector(state, selectedId) ne lit QUE le
 * PreviewBuildState : aucune lecture du DOM, aucune mutation, aucun nouvel
 * état métier. Le HTML réel IA est transporté tel quel.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBuildEvent,
  applyBuildEvents,
  createPreviewBuildState,
  type PreviewBuildEvent,
  type PreviewBuildState
} from '../../src/preview-builder/engine.js';
import { buildInspector, renderPreview } from '../../src/preview-builder/renderer.js';

const REAL_HTML = '<section class="stats"><h2>Revenus</h2></section>';

function started(): PreviewBuildState {
  return applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
}

/** Page avec parent + enfant : page (parent) → header (enfant), hero (racine). */
function scenario(): PreviewBuildState {
  const events: PreviewBuildEvent[] = [
    { kind: 'BUILD_STARTED', stage: 'structure', timestamp: 1 },
    { kind: 'COMPONENT_CREATED', component: { id: 'page', type: 'content', label: 'Ma Page' }, timestamp: 2 },
    { kind: 'COMPONENT_CREATED', component: { id: 'header', type: 'header', parentId: 'page', label: 'En-tête', metadata: { html: REAL_HTML, title: 'MonApp' } }, timestamp: 3 },
    { kind: 'COMPONENT_BUILDING', componentId: 'header', timestamp: 4 },
    { kind: 'COMPONENT_READY', componentId: 'header', timestamp: 5 },
    { kind: 'COMPONENT_CREATED', component: { id: 'hero', type: 'hero' }, timestamp: 6 },
    { kind: 'COMPONENT_BUILDING', componentId: 'hero', timestamp: 7 }
  ];
  return applyBuildEvents(started(), events);
}

describe('ÉTAPE 15 : inspector descriptif', () => {
  it('1. sélection valide : id, type, label et statut du modèle', () => {
    const inspector = buildInspector(scenario(), 'header');
    assert.ok(inspector);
    assert.equal(inspector!.id, 'header');
    assert.equal(inspector!.type, 'header');
    assert.equal(inspector!.label, 'En-tête');
    assert.equal(inspector!.status, 'completed');
  });

  it('2. sélection inexistante → null (panneau vide, jamais une erreur)', () => {
    assert.equal(buildInspector(scenario(), 'composant-fantome'), null);
  });

  it('3. aucun selectedId (null ou undefined) → null', () => {
    assert.equal(buildInspector(scenario(), null), null);
    assert.equal(buildInspector(scenario()), null);
  });

  it('4. composant BUILDING : statut, étape et ordre viennent du modèle', () => {
    const inspector = buildInspector(scenario(), 'hero');
    assert.ok(inspector);
    assert.equal(inspector!.status, 'building');
    assert.equal(inspector!.stage, 'structure');
    assert.equal(typeof inspector!.order, 'number');
    assert.equal(inspector!.hasRealHtml, false);
  });

  it('5. composant COMPLETED avec HTML réel IA : hasRealHtml vrai, contenu intact', () => {
    const inspector = buildInspector(scenario(), 'header');
    assert.ok(inspector);
    assert.equal(inspector!.status, 'completed');
    assert.equal(inspector!.hasRealHtml, true);
    assert.equal(inspector!.metadata?.html, REAL_HTML, 'le HTML réel IA est transporté SANS transformation');
  });

  it('6. parentId et enfants : relations dérivées du state', () => {
    const header = buildInspector(scenario(), 'header');
    assert.ok(header);
    assert.equal(header!.parentId, 'page', 'l enfant connaît son parent');
    assert.deepEqual(header!.children, []);
    const page = buildInspector(scenario(), 'page');
    assert.ok(page);
    assert.equal(page!.parentId, undefined, 'la racine n a pas de parent');
    assert.deepEqual(page!.children, ['header'], 'les enfants déclarés via parentId');
  });

  it('7. metadata disponibles telles quelles (aucun parsing visuel)', () => {
    const inspector = buildInspector(scenario(), 'header');
    assert.equal(inspector!.metadata?.title, 'MonApp');
    assert.equal(typeof inspector!.metadata?.html, 'string');
  });

  it('8. pureté et déterminisme : même entrée → même inspector', () => {
    const s = scenario();
    const a = buildInspector(s, 'header');
    const b = buildInspector(s, 'header');
    assert.deepEqual(a, b);
    // Cohérence avec le modèle de rendu : l id inspecté est celui du renderer
    const model = renderPreview(s);
    assert.ok(model.flat.some((n) => n.id === a!.id));
  });

  it('9. AUCUNE mutation du state : l inspector est en lecture seule', () => {
    const s = scenario();
    const modelBefore = renderPreview(s);
    buildInspector(s, 'header');
    buildInspector(s, 'hero');
    buildInspector(s, 'inexistant');
    buildInspector(s, null);
    assert.deepEqual(renderPreview(s), modelBefore, 'le state produit strictement le même modèle après les inspections');
  });
});
