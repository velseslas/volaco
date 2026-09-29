/**
 * LOT 02 — tests du Progressive Preview Renderer.
 * Garanties du brief : pending non rendu dans le canvas, building rendu avec
 * état de construction, completed normal, arbre parentId correct, coexistence
 * de statuts, indépendance totale vis-à-vis des événements, aucun composant
 * ne disparaît, état final cohérent — et erreur locale sans planter le reste.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBuildEvent,
  applyBuildEvents,
  createPreviewBuildState
} from '../../src/preview-builder/engine.js';
import { renderPreview } from '../../src/preview-builder/renderer.js';
import type { PreviewBuildState } from '../../src/preview-builder/engine.js';

function stage(): PreviewBuildState {
  return applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
}

describe('LOT 02 : Progressive Preview Renderer (state → UI)', () => {
  it('1. pending n’est PAS rendu dans le canvas (mais listé avec ○ attente)', () => {
    let s = stage();
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'a', type: 'card', label: 'Carte A' }, timestamp: 2 });
    const model = renderPreview(s);
    assert.equal(model.flat.length, 1, 'le composant est listé (○ attente)');
    assert.equal(model.flat[0]!.status, 'pending');
    assert.equal(model.flat[0]!.canvasVisible, false, 'pending : PAS dans le canvas');
    assert.equal(model.canvas.length, 0);
  });

  it('2. building est rendu avec son état de construction', () => {
    let s = stage();
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'h', type: 'header', label: 'Header' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'h', timestamp: 3 });
    const model = renderPreview(s);
    assert.equal(model.canvas.length, 1);
    assert.equal(model.canvas[0]!.status, 'building');
    assert.equal(model.canvas[0]!.canvasVisible, true);
    assert.equal(model.counts.building, 1);
  });

  it('3. completed est rendu normalement (élément stable)', () => {
    let s = stage();
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'h', type: 'header', label: 'Header' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: 'h', timestamp: 3 });
    const model = renderPreview(s);
    assert.equal(model.canvas[0]!.status, 'completed');
    assert.equal(model.counts.completed, 1);
    assert.equal(model.progressLabel, 'Components: 1/1');
  });

  it('4. les relations parentId produisent l’arbre Page → Header/Sidebar/Main → Card/Chart', () => {
    let s = stage();
    const seed = (id: string, type: string, label: string, parentId?: string, at = 2) => {
      s = applyBuildEvent(s, {
        kind: 'COMPONENT_CREATED',
        component: { id, type, label, ...(parentId !== undefined ? { parentId } : {}) },
        timestamp: at
      });
      return applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: id, timestamp: at + 0.5 });
    };

    s = seed('header', 'header', 'Header');
    s = seed('sidebar', 'sidebar', 'Sidebar');
    s = seed('main', 'main', 'Main');
    s = seed('card1', 'card', 'Card 1', 'main');
    s = seed('card2', 'card', 'Card 2', 'main');
    s = seed('chart', 'chart', 'Chart', 'main');

    const model = renderPreview(s);
    assert.equal(model.roots.length, 3, '3 racines : header, sidebar, main');
    const main = model.roots.find((r) => r.id === 'main')!;
    assert.equal(main.children.length, 3, 'main porte 3 enfants');
    assert.deepEqual(main.children.map((c) => c.label), ['Card 1', 'Card 2', 'Chart']);
    assert.equal(main.children[0]!.depth, 1, 'profondeur correcte');
    assert.equal(model.flat.length, 6, 'pré-ordre : parents avant enfants');
  });

  it('5. plusieurs composants coexistent avec des statuts différents', () => {
    let s = stage();
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'h', type: 'header', label: 'Header' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: 'h', timestamp: 3 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 's', type: 'sidebar', label: 'Sidebar' }, timestamp: 4 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 's', timestamp: 5 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'c', type: 'card', label: 'Card' }, timestamp: 6 });

    const model = renderPreview(s);
    assert.equal(model.counts.completed, 1);
    assert.equal(model.counts.building, 1);
    assert.equal(model.counts.pending, 1);
    assert.equal(model.progressLabel, 'Components: 1/3');
    assert.equal(model.canvas.length, 2, 'canvas = building + completed seulement');
  });

  it('6. le renderer ne dépend PAS des événements : même état → même rendu, y compris fabriqué à la main', () => {
    // État fabriqué SANS passer par un seul événement (au-delà du start) :
    // le renderer ne doit produire que depuis l'état.
    const manual: PreviewBuildState = {
      ...stage(),
      components: new Map([
        ['x', { id: 'x', type: 'card', label: 'Carte X', status: 'completed', stage: 'components', order: 0 }]
      ])
    };
    const modelA = renderPreview(manual);
    const modelB = renderPreview(manual);
    assert.deepEqual(modelA, modelB, 'rendu déterministe depuis l’état');
    assert.equal(modelA.flat[0]!.label, 'Carte X');
    // Aucun event ne fuite dans le modèle de rendu
    assert.ok(!('events' in modelA));
  });

  it('7. aucun composant ne disparaît quand un autre passe à building', () => {
    let s = stage();
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'h', type: 'header', label: 'Header' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: 'h', timestamp: 3 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 's', type: 'sidebar', label: 'Sidebar' }, timestamp: 4 });
    const before = renderPreview(s);
    const after = renderPreview(applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 's', timestamp: 5 }));
    const beforeIds = before.canvas.map((n) => n.id);
    const afterIds = after.canvas.map((n) => n.id);
    assert.ok(afterIds.includes('h'), 'header toujours affiché');
    assert.deepEqual(afterIds, [...beforeIds, 's'], 'rien ne disparaît, le nouveau s’ajoute');
  });

  it('8. erreur LOCALE sur un composant : il affiche son état d’erreur, le reste tient', () => {
    let s = stage();
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'h', type: 'header', label: 'Header' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: 'h', timestamp: 3 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'chart', type: 'chart', label: 'Chart' }, timestamp: 4 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'chart', timestamp: 5 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_FAILED', componentId: 'chart', error: 'Rendu impossible', timestamp: 6 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'card', type: 'card', label: 'Card' }, timestamp: 7 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: 'card', timestamp: 8 });

    const model = renderPreview(s);
    const chart = model.flat.find((n) => n.id === 'chart')!;
    assert.equal(chart.status, 'error');
    assert.equal(chart.error, 'Rendu impossible');
    assert.equal(chart.canvasVisible, true, 'l’erreur est affichée localement');
    assert.equal(model.status, 'building', 'le build GLOBAL n’est pas en échec');
    assert.equal(model.counts.error, 1);
    const card = model.flat.find((n) => n.id === 'card')!;
    assert.equal(card.status, 'completed', 'les autres composants continuent normalement');
  });

  it('9. état completed final cohérent : tout est rendu, compteur plein, statut PREVIEW READY', () => {
    let s = stage();
    for (const [i, id] of ['h', 's', 'm'].entries()) {
      s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id, type: 'block', label: id.toUpperCase() }, timestamp: 2 + i });
      s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: id, timestamp: 2.5 + i });
    }
    s = applyBuildEvent(s, { kind: 'BUILD_COMPLETED', timestamp: 10 });
    const model = renderPreview(s);
    assert.equal(model.status, 'completed');
    assert.equal(model.statusLabel, 'PREVIEW READY');
    assert.equal(model.counts.completed, 3);
    assert.equal(model.canvas.length, 3);
    assert.equal(model.progressLabel, 'Components: 3/3');
  });
});
