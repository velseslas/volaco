/**
 * LOT 04 — tests BUILD TIMELINE + CONSTRUCTION TREE.
 * Timeline : les 6 cas du brief (idle initial, active correcte, précédentes
 * completed, futures pending, finale completed, progression cohérente).
 * Tree : hiérarchie, orphelins, dérivation intégrale du state — aucun état
 * local concurrent avec le moteur.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBuildEvent,
  createPreviewBuildState
} from '../../src/preview-builder/engine.js';
import type { PreviewBuildState } from '../../src/preview-builder/engine.js';
import { buildTimeline, renderPreview } from '../../src/preview-builder/renderer.js';

function addComponent(state: PreviewBuildState, id: string, status: 'pending' | 'building' | 'completed', label: string, parentId?: string): PreviewBuildState {
  let s = state;
  if (s.status === 'idle') s = applyBuildEvent(s, { kind: 'BUILD_STARTED', timestamp: 1 });
  s = applyBuildEvent(s, {
    kind: 'COMPONENT_CREATED',
    component: { id, type: 'block', label, ...(parentId !== undefined ? { parentId } : {}) },
    timestamp: 2
  });
  if (status === 'building') s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: id, timestamp: 3 });
  if (status === 'completed') s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: id, timestamp: 4 });
  return s;
}

describe('LOT 04 : Build Timeline (dérivée du PreviewBuildState)', () => {
  it('1. état initial : idle est l’étape active, tout le pipeline en attente', () => {
    const steps = buildTimeline(createPreviewBuildState());
    assert.equal(steps[0]!.stage, 'idle');
    assert.equal(steps[0]!.status, 'active');
    assert.ok(steps.slice(1).every((s) => s.status === 'pending'));
  });

  it('2. pendant le build : l’étape courante est active, au bon rang', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', stage: 'structure', timestamp: 1 });
    s = applyBuildEvent(s, { kind: 'STAGE_ENTERED', stage: 'components', timestamp: 2 });
    const steps = buildTimeline(s);
    assert.deepEqual(
      steps.map((s2) => s2.status),
      ['completed', 'completed', 'completed', 'active', 'pending', 'pending', 'pending', 'pending', 'pending']
    );
    assert.equal(steps[3]!.stage, 'components');
  });

  it('3. les étapes précédentes sont completed (structure/sections franchies)', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = applyBuildEvent(s, { kind: 'STAGE_ENTERED', stage: 'sections', timestamp: 2 });
    const steps = buildTimeline(s);
    assert.equal(steps.find((s2) => s2.stage === 'structure')!.status, 'completed');
    assert.equal(steps.find((s2) => s2.stage === 'sections')!.status, 'active');
  });

  it('4. les étapes futures restent pending (aucune anticipation)', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = applyBuildEvent(s, { kind: 'STAGE_ENTERED', stage: 'components', timestamp: 2 });
    const future = buildTimeline(s).filter((s2) => ['content', 'styling', 'responsive', 'finalizing', 'completed'].includes(s2.stage));
    assert.ok(future.every((s2) => s2.status === 'pending'), 'aucune étape future marquée faite');
  });

  it('5. BUILD_COMPLETED : tout le pipeline devient completed', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = applyBuildEvent(s, { kind: 'BUILD_COMPLETED', timestamp: 2 });
    const steps = buildTimeline(s);
    assert.ok(steps.every((s2) => s2.status === 'completed'), 'toutes les étapes franchies');
  });

  it('6. progression cohérente avec le state réel (aucun compteur indépendant)', () => {
    // 3 composants : 2 completed, 1 building, 1 pending → 2/4
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = addComponent(s, 'c1', 'completed', 'Un');
    s = addComponent(s, 'c2', 'completed', 'Deux');
    s = addComponent(s, 'c3', 'building', 'Trois');
    s = addComponent(s, 'c4', 'pending', 'Quatre');
    const model = renderPreview(s);
    assert.equal(model.counts.completed, 2);
    assert.equal(model.counts.total, 4);
    assert.equal(model.progressLabel, 'Components: 2/4');
    // Cohérence : le compteur = les composants réellement completed du state
    const realCompleted = [...s.components.values()].filter((c) => c.status === 'completed').length;
    assert.equal(model.counts.completed, realCompleted, 'dérivé du state, pas d’un compteur parallèle');
    // Progression % = fraction réelle des composants terminés
    assert.ok(Math.abs(model.counts.completed / model.counts.total - 0.5) < 0.01);
  });
});

describe('LOT 04 : Construction Tree (dérivé du même state)', () => {
  it('7. hiérarchie parentId correcte et orphelin promu racine (pas perdu)', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = addComponent(s, 'main', 'completed', 'Main');
    s = addComponent(s, 'card', 'building', 'Card 02', 'main');
    // 'card' référence un parent 'main' ✓ ; un orphelin :
    const orphan = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'ghost-child', type: 'card', label: 'Orphelin', parentId: 'parent-inexistant' }, timestamp: 3 });
    const model = renderPreview(orphan);
    assert.equal(model.roots.filter((r) => r.id === 'main').length, 1);
    assert.equal(model.roots.filter((r) => r.id === 'ghost-child').length, 1, 'orphelin promu racine, jamais perdu');
    const main = model.roots.find((r) => r.id === 'main')!;
    assert.equal(main.children[0]!.label, 'Card 02');
    assert.equal(main.children[0]!.depth, 1);
  });

  it('8. tous les statuts sont représentés dans le tree, focus identifié au même endroit que le canvas', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = addComponent(s, 'done', 'completed', 'Fait');
    s = addComponent(s, 'wip', 'building', 'En cours');
    s = addComponent(s, 'todo', 'pending', 'À venir');
    s = applyBuildEvent(s, { kind: 'COMPONENT_FAILED', componentId: 'wip', error: 'boom', timestamp: 5 });
    s = addComponent(s, 'fix', 'building', 'Réparation', );

    const model = renderPreview(s);
    const byLabel = Object.fromEntries(model.flat.map((n) => [n.label, n]));
    assert.equal(byLabel['Fait']!.status, 'completed');
    assert.equal(byLabel['En cours']!.status, 'error');
    assert.equal(byLabel['À venir']!.status, 'pending');
    assert.equal(byLabel['Réparation']!.status, 'building');
    assert.equal(model.focusId, 'fix', 'le focus = buildFocus(state), partagé canvas/tree');
    assert.equal(model.flat.find((n) => n.id === 'fix')!.isBuildFocus, true);
    // Le même state alimente canvas et tree : le canvas est un sous-ensemble du tree
    assert.ok(model.canvas.every((n) => model.flat.some((f) => f.id === n.id && f.status === n.status)), 'canvas ⊂ tree');
  });

  it('9. aucun état local concurrent : tout changement du state se répercute au tree, rien sans lui', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = addComponent(s, 'c1', 'pending', 'Un');
    const before = renderPreview(s).flat.map((n) => n.status).join(',');
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'c1', timestamp: 3 });
    const after = renderPreview(s).flat.map((n) => n.status).join(',');
    assert.equal(before, 'pending');
    assert.equal(after, 'building');
    // Et un build reset annule tout (dérivation intégrale)
    s = applyBuildEvent(s, { kind: 'BUILD_RESET', timestamp: 5 });
    assert.equal(renderPreview(s).flat.length, 0);
  });
});
