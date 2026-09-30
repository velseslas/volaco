/**
 * ÉTAPE 18 — ÉDITION DE STRUCTURE : moveComponent.
 *
 * Les 14 cas du brief. La commande est pure : SEULS parentId et order du
 * composant déplacé changent — id, type, label É16, variant É17,
 * metadata.html, statut et stage sont conservés ; les autres composants
 * gardent leurs références ; cycles et index hors bornes sont gérés.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBuildEvents,
  createPreviewBuildState,
  type PreviewBuildEvent,
  type PreviewBuildState
} from '../../src/preview-builder/engine.js';
import { moveComponent, updateComponentLabel, updateComponentVariant } from '../../src/preview-builder/editing.js';
import { renderPreview } from '../../src/preview-builder/renderer.js';

const REAL_HTML = '<section class="stats"><h2>Revenus</h2></section>';

/** page (racine) → header + main ; main → card ; chart (racine). */
function scenario(): PreviewBuildState {
  const events: PreviewBuildEvent[] = [
    { kind: 'BUILD_STARTED', stage: 'structure', timestamp: 1 },
    { kind: 'COMPONENT_CREATED', component: { id: 'page', type: 'content', label: 'Page' }, timestamp: 2 },
    { kind: 'COMPONENT_CREATED', component: { id: 'header', type: 'header', parentId: 'page', label: 'En-tête' }, timestamp: 3 },
    { kind: 'COMPONENT_CREATED', component: { id: 'main', type: 'content', parentId: 'page', label: 'Contenu' }, timestamp: 4 },
    { kind: 'COMPONENT_CREATED', component: { id: 'card', type: 'card', parentId: 'main', label: 'Revenus', metadata: { html: REAL_HTML } }, timestamp: 5 },
    { kind: 'COMPONENT_BUILDING', componentId: 'card', timestamp: 6 },
    { kind: 'COMPONENT_READY', componentId: 'card', timestamp: 7 },
    { kind: 'COMPONENT_CREATED', component: { id: 'chart', type: 'chart', label: 'Graphique' }, timestamp: 8 }
  ];
  return applyBuildEvents(createPreviewBuildState(), events);
}

/** Ordre DOM attendu : ids des enfants d'un parent (ou racines). */
function childIds(s: PreviewBuildState, parentId: string | null): string[] {
  return renderPreview(s).flat
    .filter((n) => (s.components.get(n.id)!.parentId ?? null) === parentId)
    .map((n) => n.id);
}

describe('ÉTAPE 18 : moveComponent', () => {
  it('1. racine → parent : le composant rejoint les enfants du parent', () => {
    const s = scenario();
    assert.deepEqual(childIds(s, 'page'), ['header', 'main']);
    const result = moveComponent(s, 'chart', 'page', 0);
    assert.equal(result.applied, true);
    assert.equal(result.state.components.get('chart')!.parentId, 'page');
    assert.deepEqual(childIds(result.state, 'page'), ['chart', 'header', 'main'], 'insertion en position 0');
  });

  it('2. parent → racine : parentId redevient undefined', () => {
    const s = scenario();
    const result = moveComponent(s, 'card', null, 1);
    assert.equal(result.applied, true);
    assert.equal(result.state.components.get('card')!.parentId, undefined);
    assert.deepEqual(childIds(result.state, null), ['page', 'card', 'chart'], 'position 1 = entre page et chart');
  });

  it('3. entre deux parents : quitte l un, rejoint l autre', () => {
    const s = scenario();
    const result = moveComponent(s, 'header', 'main', 0);
    assert.equal(result.applied, true);
    assert.equal(result.state.components.get('header')!.parentId, 'main');
    assert.deepEqual(childIds(result.state, 'page'), ['main']);
    assert.deepEqual(childIds(result.state, 'main'), ['header', 'card']);
  });

  it('4. changement d ordre chez le même parent (fractionnaire : frères intacts)', () => {
    const s = scenario();
    const before = childIds(s, 'page');
    assert.deepEqual(before, ['header', 'main']);
    const headerOrder = s.components.get('header')!.order;
    const mainOrder = s.components.get('main')!.order;
    const result = moveComponent(s, 'main', 'page', 0);
    assert.equal(result.applied, true);
    assert.deepEqual(childIds(result.state, 'page'), ['main', 'header']);
    // Aucun frère renuméroté : mêmes références, mêmes orders
    assert.ok(result.state.components.get('header') === s.components.get('header'));
    assert.equal(result.state.components.get('header')!.order, headerOrder);
    assert.ok(result.state.components.get('main')!.order < headerOrder);
    assert.notEqual(result.state.components.get('main')!.order, mainOrder);
  });

  it('5. index hors limites : borné proprement (0..fin)', () => {
    const s = scenario();
    const negative = moveComponent(s, 'chart', 'page', -5);
    assert.equal(negative.applied, true);
    assert.deepEqual(childIds(negative.state, 'page'), ['chart', 'header', 'main']);
    const tooFar = moveComponent(scenario(), 'chart', 'page', 99);
    assert.equal(tooFar.applied, true);
    assert.deepEqual(childIds(tooFar.state, 'page'), ['header', 'main', 'chart'], '99 → fin de liste');
    const half = moveComponent(scenario(), 'chart', 'page', 1.7);
    assert.deepEqual(childIds(half.state, 'page'), ['header', 'chart', 'main'], '1.7 → tronqué à 1');
  });

  it('6. parent inexistant → unknown-parent, même référence', () => {
    const s = scenario();
    const result = moveComponent(s, 'chart', 'inconnu', 0);
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'unknown-parent');
    assert.equal(result.state, s);
  });

  it('7. composant inexistant → unknown-component', () => {
    const s = scenario();
    const result = moveComponent(s, 'fantome', 'page', 0);
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'unknown-component');
    assert.equal(result.state, s);
  });

  it('8. cycles refusés : soi-même et propres descendants', () => {
    const s = scenario();
    // Soi-même
    const self = moveComponent(s, 'page', 'page', 0);
    assert.equal(self.reason, 'cycle');
    assert.equal(self.state, s);
    // Un descendant (card est dans main, qui est dans page)
    const descendant = moveComponent(s, 'page', 'card', 0);
    assert.equal(descendant.reason, 'cycle');
    assert.equal(descendant.state, s);
  });

  it('9. immutabilité : l ancien state et l arbre sont intacts', () => {
    const s = scenario();
    const modelBefore = renderPreview(s);
    moveComponent(s, 'card', null, 0);
    assert.equal(s.components.get('card')!.parentId, 'main', 'l ancien state garde sa structure');
    assert.deepEqual(renderPreview(s), modelBefore);
  });

  it('10. label É16 conservé', () => {
    let s = updateComponentLabel(scenario(), 'card', 'Carte Éditée').state;
    const result = moveComponent(s, 'card', null, 0);
    assert.equal(result.state.components.get('card')!.label, 'Carte Éditée');
  });

  it('11. variant É17 conservé', () => {
    let s = updateComponentVariant(scenario(), 'card', 'featured').state;
    const result = moveComponent(s, 'card', null, 0);
    const card = result.state.components.get('card')!;
    assert.equal(card.variant, 'featured');
    assert.equal(card.parentId, undefined);
  });

  it('12. metadata.html strictement conservé (même référence)', () => {
    const s = scenario();
    const metaAvant = s.components.get('card')!.metadata;
    const après = moveComponent(s, 'card', 'page', 2).state.components.get('card')!;
    assert.equal(après.metadata, metaAvant);
    assert.equal(après.metadata?.html, REAL_HTML);
  });

  it('13. déterminisme : même déplacement → même arbre', () => {
    const a = moveComponent(scenario(), 'chart', 'page', 1).state;
    const b = moveComponent(scenario(), 'chart', 'page', 1).state;
    assert.deepEqual(childIds(a, 'page'), childIds(b, 'page'));
    assert.deepEqual(renderPreview(a).flat.map((n) => n.id), renderPreview(b).flat.map((n) => n.id));
  });

  it('14. arbre final cohérent : aucun composant perdu, aucun doublon', () => {
    const s = scenario();
    // Enchaînement de déplacements : chart→page, card→racine, header→main
    let s2 = moveComponent(s, 'chart', 'page', 0).state;
    s2 = moveComponent(s2, 'card', null, 0).state;
    s2 = moveComponent(s2, 'header', 'main', 0).state;
    const model = renderPreview(s2);
    const ids = model.flat.map((n) => n.id).sort();
    assert.deepEqual(ids, ['card', 'chart', 'header', 'main', 'page'], 'tous présents, une seule fois');
    // Chaque id apparaît EXACTEMENT une fois dans l'arbre rendu
    assert.equal(new Set(ids).size, ids.length);
    // Relations cohérentes : tout parentId pointe vers un existant
    for (const n of model.flat) {
      if (s2.components.get(n.id)!.parentId !== undefined) {
        assert.ok(s2.components.has(s2.components.get(n.id)!.parentId!), 'parent existant pour ' + n.id);
      }
    }
    // Et le composant déplacé garde ses données É16/É17
    s2 = updateComponentLabel(s2, 'chart', 'Courbe').state;
    s2 = updateComponentVariant(s2, 'chart', 'wide').state;
    s2 = moveComponent(s2, 'chart', 'main', 1).state;
    const chart = s2.components.get('chart')!;
    assert.equal(chart.label, 'Courbe');
    assert.equal(chart.variant, 'wide');
    assert.equal(chart.parentId, 'main');
  });
});
