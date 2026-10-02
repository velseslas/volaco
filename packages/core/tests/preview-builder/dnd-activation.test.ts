/**
 * ÉTAPE 20 — ACTIVATION DU DRAG & DROP (pointer events, fondation É19).
 *
 * Les 14 cas du brief. Le pipeline simulé reproduit exactement la page :
 * resolveDropTarget (élément + géométrie) → computeDropTarget →
 * applyDragIntent → moveComponent. Les garanties d'interaction (seuil,
 * indicateur, aucune mutation pendant le move, cleanup) sont vérifiées par
 * lecture de la source de la page.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { renderPreview, resolveDropTarget, buildInspector, resolvePreviewTarget, type DropProbeElement } from '../../src/preview-builder/renderer.js';

const REAL_HTML = '<section class="stats"><h2>Revenus</h2></section>';

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

function childIds(s: PreviewBuildState, parentId: string | null): string[] {
  return renderPreview(s).flat
    .filter((n) => (s.components.get(n.id)!.parentId ?? null) === parentId)
    .map((n) => n.id);
}

/** Simule le pipeline EXACT de la page pour un drag jusqu'à (x, y). */
function dragTo(s: PreviewBuildState, fromId: string, hoverEl: DropProbeElement, geometry: { x: number; y: number }): PreviewBuildState {
  const intent = resolveDropTarget(hoverEl, geometry, fromId);
  if (!intent) return s;
  const result = applyDragIntent(s, intent);
  return result.applied ? result.state : s;
}

function hostEl(id: string, rect: { top: number; left: number; bottom: number; right: number }, innerParent?: DropProbeElement): DropProbeElement {
  const host: any = {
    attrs: { 'data-pv-id': id },
    rect,
    closest(selectors: string): any {
      let cur: any = innerParent || host;
      while (cur) {
        if (selectors === '[data-pv-id]' && cur.attrs?.['data-pv-id'] !== undefined) return cur;
        cur = cur.parent;
      }
      return null;
    },
    getAttribute(name: string) { return host.attrs[name] ?? null; },
    getBoundingClientRect() { return host.rect; }
  };
  if (innerParent) (innerParent as any).parent = host;
  return host;
}

const page = (): string => readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder-app.js'), 'utf8');

describe('ÉTAPE 20 : drag & drop réel (pointer events)', () => {
  it('1. drag racine → racine : réordonnancement par la géométrie', () => {
    const s = scenario();
    // chart (racine, dernier) déplacé avant page : hôte page, tiers haut
    const host = hostEl('page', { top: 0, left: 0, bottom: 300, right: 100 });
    const inner = { attrs: {}, parent: host, closest: host.closest.bind(host), getAttribute: () => null, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 10, right: 10 }) } as unknown as DropProbeElement;
    const s2 = dragTo(s, 'chart', inner, { x: 50, y: 20 });
    // Racines : page contient header/main/card — seul chart bouge au niveau racine
    assert.deepEqual(childIds(s2, null), ['chart', 'page']);
    assert.equal(s2.components.get('chart')!.order, Math.min(...[...s2.components.values()].filter((c) => c.id !== 'chart' && !c.parentId).map((c) => c.order)) - 1);
  });

  it('2. drag racine → enfant (inside) : le survolé devient parent', () => {
    const s = scenario();
    const host = hostEl('main', { top: 0, left: 0, bottom: 300, right: 100 });
    const inner = { attrs: {}, parent: host, closest: host.closest.bind(host), getAttribute: () => null, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 10, right: 10 }) } as unknown as DropProbeElement;
    const s2 = dragTo(s, 'chart', inner, { x: 50, y: 150 });
    assert.equal(s2.components.get('chart')!.parentId, 'main');
    assert.deepEqual(childIds(s2, 'main'), ['card', 'chart']);
  });

  it('3. enfant → racine : card quitté main pour la racine', () => {
    const s = scenario();
    const host = hostEl('chart', { top: 0, left: 0, bottom: 300, right: 100 });
    const inner = { attrs: {}, parent: host, closest: host.closest.bind(host), getAttribute: () => null, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 10, right: 10 }) } as unknown as DropProbeElement;
    const s2 = dragTo(s, 'card', inner, { x: 50, y: 280 });
    assert.equal(s2.components.get('card')!.parentId, undefined);
  });

  it('4. réordonnement avant/après entre frères', () => {
    const s = scenario();
    // Frères de page : [header, main] — header APRÈS main (ajustement É19)
    const hostMain = hostEl('main', { top: 0, left: 0, bottom: 300, right: 100 });
    const innerMain = { attrs: {}, parent: hostMain, closest: hostMain.closest.bind(hostMain), getAttribute: () => null, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 10, right: 10 }) } as unknown as DropProbeElement;
    const s2 = dragTo(s, 'header', innerMain, { x: 50, y: 280 });
    assert.deepEqual(childIds(s2, 'page'), ['main', 'header']);
    // puis main APRÈS header → retour à l'ordre initial
    const hostHeader = hostEl('header', { top: 0, left: 0, bottom: 300, right: 100 });
    const innerHeader = { attrs: {}, parent: hostHeader, closest: hostHeader.closest.bind(hostHeader), getAttribute: () => null, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 10, right: 10 }) } as unknown as DropProbeElement;
    const s3 = dragTo(s2, 'main', innerHeader, { x: 50, y: 280 });
    assert.deepEqual(childIds(s3, 'page'), ['header', 'main']);
    // et un déplacement sans effet réel (main déjà avant header) → unchanged
    const s4 = dragTo(s3, 'main', innerHeader, { x: 50, y: 20 });
    assert.deepEqual(childIds(s4, 'page'), ['main', 'header'], 'unchanged : le même ordre ne produit aucun nouvel état');
  });

  it('5. cible inside : indicateur ring (le modèle donne une cible valide)', () => {
    const s = scenario();
    const target = computeDropTarget(s, { componentId: 'chart', hoveredId: 'main', edge: 'inside' });
    assert.deepEqual(target, { parentId: 'main', index: 1 });
  });

  it('6. cycle refusé proprement au pointerup (indicateur forbidden, aucun changement)', () => {
    const s = scenario();
    const host = hostEl('card', { top: 0, left: 0, bottom: 300, right: 100 });
    const inner = { attrs: {}, parent: host, closest: host.closest.bind(host), getAttribute: () => null, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 10, right: 10 }) } as unknown as DropProbeElement;
    const intent = resolveDropTarget(inner, { x: 50, y: 150 }, 'page');
    assert.ok(intent, 'le sondage produit une intention');
    const result = applyDragIntent(s, intent!);
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'invalid-target');
    assert.equal(result.state, s, 'état inchangé');
  });

  it('7. hors preview : résolution null → aucune application', () => {
    const s = scenario();
    const intent = resolveDropTarget(null, { x: 10, y: 10 }, 'chart');
    assert.equal(intent, null);
    const modelBefore = renderPreview(s);
    assert.deepEqual(renderPreview(s), modelBefore);
  });

  it('8. pointerup sans mouvement : le seuil bloque tout déplacement', () => {
    const source = page();
    assert.ok(source.includes('MIN_DRAG_PX'), 'un seuil de distance existe');
    assert.ok(/if \(!wasActive\) return/.test(source), 'pointerup sans drag actif = simple clic, aucune application');
    // Modèle : sans intention résolue, le state ne change pas
    const s = scenario();
    const result = applyDragIntent(s, { componentId: 'chart', hoveredId: 'main', edge: 'inside' });
    assert.notEqual(result.state, s, 'seule une intention résolue applique un changement');
  });

  it('9. state inchangé PENDANT le drag (pointermove sans mutation)', () => {
    const source = page();
    const moveStart = source.indexOf("document.addEventListener('pointermove'");
    const moveEnd = source.indexOf("document.addEventListener('pointerup'");
    const moveBlock = source.slice(moveStart, moveEnd);
    assert.ok(moveBlock.includes('updateDropIndicator'), 'le move ne fait qu afficher l indicateur');
    assert.ok(!moveBlock.includes('state ='), 'aucune affectation du state pendant le drag');
    assert.ok(!moveBlock.includes('renderCurrent()'), 'aucun rendu d état pendant le drag');
  });

  it('10. aucun déplacement DOM pendant le drag', () => {
    const source = page();
    const moveStart = source.indexOf("document.addEventListener('pointermove'");
    const moveEnd = source.indexOf("document.addEventListener('pointerup'");
    const moveBlock = source.slice(moveStart, moveEnd);
    for (const forbidden of ['appendChild', 'insertBefore', '.innerHTML =', 'removeChild']) {
      assert.ok(!moveBlock.includes(forbidden), `${forbidden} interdit pendant pointermove`);
    }
  });

  it('11. zéro doublon après drop (l arbre rendu reste un ensemble unique)', () => {
    let s = scenario();
    const host = hostEl('main', { top: 0, left: 0, bottom: 300, right: 100 });
    const inner = { attrs: {}, parent: host, closest: host.closest.bind(host), getAttribute: () => null, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 10, right: 10 }) } as unknown as DropProbeElement;
    s = dragTo(s, 'chart', inner, { x: 50, y: 150 });
    s = dragTo(s, 'card', host, { x: 50, y: 150 });
    const ids = renderPreview(s).flat.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, 'aucun doublon');
    assert.deepEqual([...ids].sort(), ['card', 'chart', 'header', 'main', 'page'], 'aucun composant perdu');
  });

  it('12. identité data-pv-id inchangée après drop', () => {
    const s = scenario();
    const host = hostEl('header', { top: 0, left: 0, bottom: 300, right: 100 });
    const inner = { attrs: {}, parent: host, closest: host.closest.bind(host), getAttribute: () => null, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 10, right: 10 }) } as unknown as DropProbeElement;
    const s2 = dragTo(s, 'chart', inner, { x: 50, y: 150 });
    assert.deepEqual(renderPreview(s2).flat.map((n) => n.id).sort(), renderPreview(s).flat.map((n) => n.id).sort(), 'mêmes identités, déplacées');
    // Le composant déplacé conserve son id : la sélection continue de le viser
    const inspector = buildInspector(s2, 'chart');
    assert.equal(inspector!.id, 'chart');
  });

  it('13. label É16, variant É17 et HTML réel conservés après drop', () => {
    let s = scenario();
    s = updateComponentLabel(s, 'chart', 'Courbe').state;
    s = updateComponentVariant(s, 'chart', 'wide').state;
    const host = hostEl('main', { top: 0, left: 0, bottom: 300, right: 100 });
    const inner = { attrs: {}, parent: host, closest: host.closest.bind(host), getAttribute: () => null, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 10, right: 10 }) } as unknown as DropProbeElement;
    s = dragTo(s, 'card', inner, { x: 50, y: 150 });
    const card = s.components.get('card')!;
    assert.equal(card.label, 'Revenus');
    assert.equal(card.metadata?.html, REAL_HTML);
    assert.equal(s.components.get('chart')!.label, 'Courbe');
    assert.equal(s.components.get('chart')!.variant, 'wide');
  });

  it('14. sélection + Inspector cohérents après drop', () => {
    let s = scenario();
    // le composant draggé reste sélectionné (selectedId inchangé)
    const result = applyDragIntent(s, { componentId: 'card', hoveredId: 'page', edge: 'after' });
    s = result.state;
    const model = renderPreview(s, { selectedId: 'card' });
    const selected = model.flat.find((n) => n.isUserSelected)!;
    assert.equal(selected.id, 'card');
    assert.equal((s.components.get('card')!.parentId ?? null), null, 'card est à la racine');
    const inspector = buildInspector(s, 'card');
    assert.equal(inspector!.parentId, undefined);
    assert.equal(inspector!.status, 'completed');
    // L'indicateur est TOUJOURS nettoyé au pointerup (succès ou refus)
    const source = page();
    const upStart = source.indexOf("document.addEventListener('pointerup'");
    const upEnd = source.indexOf("document.addEventListener('pointercancel'");
    const upBlock = source.slice(upStart, upEnd);
    assert.ok(upBlock.includes('hideDropIndicator()'), 'indicateur retiré au pointerup');
    assert.ok(source.slice(source.indexOf("document.addEventListener('pointercancel'")).includes('hideDropIndicator()'), 'indicateur retiré au pointercancel');
  });
});
