/**
 * ÉTAPE 19 — FONDATION DRAG & DROP : modèle pur (DropProbe/DragIntent/
 * DropTarget). moveComponent reste l'unique source de vérité : le modèle
 * calcule une cible puis DÉLÈGUE. Aucun état métier supplémentaire.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBuildEvents,
  createPreviewBuildState,
  type PreviewBuildEvent,
  type PreviewBuildState
} from '../../src/preview-builder/engine.js';
import {
  applyDragIntent,
  computeDropTarget,
  updateComponentLabel,
  updateComponentVariant
} from '../../src/preview-builder/editing.js';
import { renderPreview } from '../../src/preview-builder/renderer.js';

function scenario(): PreviewBuildState {
  const events: PreviewBuildEvent[] = [
    { kind: 'BUILD_STARTED', stage: 'structure', timestamp: 1 },
    { kind: 'COMPONENT_CREATED', component: { id: 'page', type: 'content', label: 'Page' }, timestamp: 2 },
    { kind: 'COMPONENT_CREATED', component: { id: 'header', type: 'header', parentId: 'page', label: 'En-tête' }, timestamp: 3 },
    { kind: 'COMPONENT_CREATED', component: { id: 'main', type: 'content', parentId: 'page', label: 'Contenu' }, timestamp: 4 },
    { kind: 'COMPONENT_CREATED', component: { id: 'card', type: 'card', parentId: 'main', label: 'Revenus' }, timestamp: 5 },
    { kind: 'COMPONENT_CREATED', component: { id: 'chart', type: 'chart', label: 'Graphique' }, timestamp: 6 }
  ];
  return applyBuildEvents(createPreviewBuildState(), events);
}

function childIds(s: PreviewBuildState, parentId: string | null): string[] {
  return renderPreview(s).flat
    .filter((n) => (s.components.get(n.id)!.parentId ?? null) === parentId)
    .map((n) => n.id);
}

describe('ÉTAPE 19 : modèle de drag (pur, non activé)', () => {
  it('1. déterminisme : même intention → même cible', () => {
    const s = scenario();
    const intent = { componentId: 'chart', hoveredId: 'main', edge: 'before' as const };
    assert.deepEqual(computeDropTarget(s, intent), computeDropTarget(s, intent));
  });

  it('2. immutabilité : compute et apply ne mutent jamais le state', () => {
    const s = scenario();
    const modelBefore = renderPreview(s);
    const target = computeDropTarget(s, { componentId: 'chart', hoveredId: 'header', edge: 'after' });
    const result = applyDragIntent(s, { componentId: 'chart', hoveredId: 'header', edge: 'after' });
    assert.ok(target);
    assert.deepEqual(renderPreview(s), modelBefore, 'le state source est intact après compute + apply');
    assert.notEqual(result.state, s, 'apply produit un NOUVEL état');
  });

  it('3. cible racine : hover d un composant racine (before/after)', () => {
    const s = scenario();
    // page est racine en position 0 ; chart veut se placer avant page
    const before = computeDropTarget(s, { componentId: 'chart', hoveredId: 'page', edge: 'before' });
    assert.deepEqual(before, { parentId: null, index: 0 });
    // after main (dernier enfant de page) → chez page, index ajusté
    const afterMain = computeDropTarget(s, { componentId: 'chart', hoveredId: 'main', edge: 'after' });
    assert.deepEqual(afterMain, { parentId: 'page', index: 2 });
  });

  it('4. cible enfant : inside → le survolé devient parent, en fin de liste', () => {
    const s = scenario();
    const target = computeDropTarget(s, { componentId: 'chart', hoveredId: 'main', edge: 'inside' });
    assert.deepEqual(target, { parentId: 'main', index: 1 }, 'main a déjà card : insertion en position 1');
    const applied = applyDragIntent(s, { componentId: 'chart', hoveredId: 'main', edge: 'inside' });
    assert.equal(applied.applied, true);
    assert.equal(applied.state.components.get('chart')!.parentId, 'main');
  });

  it('5. index : before/after exacts et AJUSTEMENT si le draggé est un frère avant', () => {
    const s = scenario();
    // Frères de page : [header, main]. On déplace header, on survole main.
    const beforeMain = computeDropTarget(s, { componentId: 'header', hoveredId: 'main', edge: 'before' });
    assert.deepEqual(beforeMain, { parentId: 'page', index: 0 }, 'header avant main = position 0 (déjà : unchanged)');
    const afterMain = computeDropTarget(s, { componentId: 'header', hoveredId: 'main', edge: 'after' });
    assert.deepEqual(afterMain, { parentId: 'page', index: 1 }, 'ajustement : la suppression de header décale l index');
    const applied = applyDragIntent(s, { componentId: 'header', hoveredId: 'main', edge: 'after' });
    assert.deepEqual(childIds(applied.state, 'page'), ['main', 'header']);
  });

  it('6. cible invalide : hovered inconnu, dragged inconnu, hors preview → null', () => {
    const s = scenario();
    assert.equal(computeDropTarget(s, { componentId: 'chart', hoveredId: 'fantome', edge: 'before' }), null);
    assert.equal(computeDropTarget(s, { componentId: 'fantome', hoveredId: 'main', edge: 'before' }), null);
    assert.equal(computeDropTarget(s, { componentId: 'chart', hoveredId: 'chart', edge: 'inside' }), null, 'jamais sur soi-même');
  });

  it('7. cycles : inside/before/after dans son propre sous-arbre → null', () => {
    const s = scenario();
    // page contient main qui contient card : déplacer page « dans » card ou
    // avant/après card (dans main) créerait un cycle
    assert.equal(computeDropTarget(s, { componentId: 'page', hoveredId: 'card', edge: 'inside' }), null);
    assert.equal(computeDropTarget(s, { componentId: 'page', hoveredId: 'card', edge: 'before' }), null);
    assert.equal(computeDropTarget(s, { componentId: 'page', hoveredId: 'main', edge: 'after' }), null);
    // L'application d'une intention cyclique est refusée avec raison claire
    const result = applyDragIntent(s, { componentId: 'page', hoveredId: 'card', edge: 'inside' });
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'invalid-target');
    assert.equal(result.state, s);
  });

  it('8. délégation exclusive : applyDragIntent passe par moveComponent', () => {
    const s = scenario();
    // variant + label É16/É17 posés AVANT le drag : ils survivent au déplacement
    let prepared = updateComponentLabel(s, 'chart', 'Courbe').state;
    prepared = updateComponentVariant(prepared, 'chart', 'wide').state;
    const result = applyDragIntent(prepared, { componentId: 'chart', hoveredId: 'card', edge: 'after' });
    assert.equal(result.applied, true);
    const chart = result.state.components.get('chart')!;
    assert.equal(chart.parentId, 'main', 'chart rejoint card chez main');
    assert.equal(chart.label, 'Courbe');
    assert.equal(chart.variant, 'wide');
    assert.deepEqual(childIds(result.state, 'main'), ['card', 'chart']);
  });
});
