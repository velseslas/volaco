/**
 * ÉTAPE 13 — FONDATION DE L'ÉDITION : identité stable + resolvePreviewTarget.
 *
 * Les 12 cas du brief. La résolution est testée avec des doublures
 * structurelles (mêmes sémantiques closest/getAttribute, aucune dépendance
 * DOM) ; le comportement du VRAI DOM est vérifié en navigateur (VALIDATE).
 *
 * Direction non négociable : PreviewBuildState → Renderer → DOM →
 * data-pv-id → resolvePreviewTarget(). Le résolveur ne modifie NI le state,
 * NI le DOM, ne s'abonne à rien, ne sélectionne rien.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyBuildEvent,
  applyBuildEvents,
  createPreviewBuildState,
  type PreviewBuildState
} from '../../src/preview-builder/engine.js';
import {
  renderPreview,
  previewNodeId,
  resolvePreviewTarget,
  PV_ID_ATTRIBUTE,
  type PreviewTargetElement
} from '../../src/preview-builder/renderer.js';

/** Doublure structurelle : remontée d'ascendance fidèle à Element.closest. */
interface FakeEl extends PreviewTargetElement {
  attrs: Record<string, string>;
  parent?: FakeEl;
  children: FakeEl[];
  reads: number;
}
function fakeEl(attrs: Record<string, string>, parent?: FakeEl): FakeEl {
  const el: FakeEl = {
    attrs,
    ...(parent ? { parent } : {}),
    children: [],
    reads: 0,
    closest(selectors: string): FakeEl | null {
      el.reads += 1;
      let cur: FakeEl | undefined = el;
      while (cur) {
        if (selectors === `[${PV_ID_ATTRIBUTE}]` && cur.attrs[PV_ID_ATTRIBUTE] !== undefined) return cur;
        cur = cur.parent;
      }
      return null;
    },
    getAttribute(name: string): string | null {
      el.reads += 1;
      return el.attrs[name] ?? null;
    }
  };
  if (parent) parent.children.push(el);
  return el;
}

function started(): PreviewBuildState {
  return applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
}

describe('ÉTAPE 13 : identité stable + résolution de cible', () => {
  it('1. l ID reste stable pendant BUILDING → COMPLETED', () => {
    let s = started();
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'pv-header-01', type: 'header' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'pv-header-01', timestamp: 3 });
    assert.deepEqual(renderPreview(s).flat.map((n) => n.id), ['pv-header-01']);
    s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: 'pv-header-01', timestamp: 4 });
    assert.deepEqual(renderPreview(s).flat.map((n) => n.id), ['pv-header-01']);
  });

  it('2. l ID reste stable après PREVIEW READY (et le canvas rend le même id)', () => {
    let s = started();
    s = applyBuildEvents(s, [
      { kind: 'COMPONENT_CREATED', component: { id: 'card-01', type: 'card' }, timestamp: 2 },
      { kind: 'COMPONENT_BUILDING', componentId: 'card-01', timestamp: 3 },
      { kind: 'COMPONENT_READY', componentId: 'card-01', timestamp: 4 },
      { kind: 'BUILD_COMPLETED', timestamp: 5 }
    ]);
    assert.equal(s.status, 'completed');
    const model = renderPreview(s);
    assert.deepEqual(model.canvas.map((n) => n.id), ['card-01'], 'l id rendu au PREVIEW READY est celui du modèle');
    assert.equal(previewNodeId({ id: 'card-01' }), 'card-01', 'définition unique : previewNodeId = component.id');
  });

  it('3. l ID ne dépend PAS du viewport (Desktop/Tablet/Mobile hors du modèle)', () => {
    let s = started();
    s = applyBuildEvents(s, [
      { kind: 'COMPONENT_CREATED', component: { id: 'hero', type: 'hero' }, timestamp: 2 },
      { kind: 'COMPONENT_BUILDING', componentId: 'hero', timestamp: 3 }
    ]);
    const model1 = renderPreview(s);
    const model2 = renderPreview(s);
    assert.deepEqual(model1, model2, 'le modèle de rendu ne contient AUCUN champ viewport');
    assert.ok(!('viewport' in model1));
    // La page ne bascule les viewports QUE par classes CSS (aucun id regénéré)
    const source = readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder.html'), 'utf8');
    const vpHandler = source.slice(source.indexOf("document.querySelectorAll('.vp-btn')"), source.indexOf("document.querySelectorAll('.vp-btn')") + 600);
    assert.ok(vpHandler.includes('classList.add'), 'viewports = classes CSS');
    assert.ok(!vpHandler.includes('dataset.pvId'), 'aucun id regénéré lors d un changement de viewport');
  });

  it('4. résolution depuis l élément racine : data-pv-id → son id', () => {
    const root = fakeEl({ [PV_ID_ATTRIBUTE]: 'card-01' });
    assert.equal(resolvePreviewTarget(root), 'card-01');
  });

  it('5. résolution depuis un ENFANT : remontée vers le composant porteur', () => {
    const root = fakeEl({ [PV_ID_ATTRIBUTE]: 'card-01' });
    const title = fakeEl({ class: 'pvz-card-title' }, root);
    assert.equal(resolvePreviewTarget(title), 'card-01');
  });

  it('6. résolution depuis le HTML RÉEL IA : deep dans realHtml → composant parent', () => {
    const root = fakeEl({ [PV_ID_ATTRIBUTE]: 'temoignages' });
    const real = fakeEl({ class: 'pvz-real' }, root);
    const section = fakeEl({ class: 'temoignages' }, real);
    const quote = fakeEl({ class: 'citation' }, section);
    const strong = fakeEl({}, quote);
    assert.equal(resolvePreviewTarget(strong), 'temoignages', 'l ascendance remonte jusqu au composant Preview');
  });

  it('7. élément HORS Preview → null', () => {
    const outside = fakeEl({ class: 'app-header' });
    const inner = fakeEl({}, outside);
    assert.equal(resolvePreviewTarget(inner), null);
    assert.equal(resolvePreviewTarget(null), null, 'aucun élément → null (jamais une exception)');
  });

  it('8. AUCUN index DOM ni ordre d affichage dans l identité', () => {
    // L identité vient du modèle : deux composants de MÊME type ont des ids
    // distincts portés par le modèle, quel que soit leur ordre d'annonce.
    let s = started();
    s = applyBuildEvents(s, [
      { kind: 'COMPONENT_CREATED', component: { id: 'orders', type: 'card' }, timestamp: 2 },
      { kind: 'COMPONENT_CREATED', component: { id: 'revenue', type: 'card' }, timestamp: 3 }
    ]);
    const ids = renderPreview(s).flat.map((n) => n.id);
    assert.deepEqual(ids.sort(), ['orders', 'revenue'], 'ids = ids annoncés, pas pv-0/pv-1');
    assert.ok(!ids.some((id) => /^(pv-)?\d+$/.test(id)), 'aucun id numérique synthétisé');
    // Le résolveur ne reçoit JAMAIS un index : sa signature ne prend qu'un élément
    assert.equal(resolvePreviewTarget.length, 1);
  });

  it('9. aucun changement du state : le résolveur ne connaît pas le state', () => {
    // Signature pure : un seul paramètre (l'élément). Le state ne peut pas
    // être touché puisqu'il n'est pas accessible.
    let s = started();
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'c1', type: 'card' }, timestamp: 2 });
    const modelBefore = renderPreview(s);
    const el = fakeEl({ [PV_ID_ATTRIBUTE]: 'c1' });
    resolvePreviewTarget(el);
    resolvePreviewTarget(el);
    assert.deepEqual(renderPreview(s), modelBefore, 'le state rend exactement le même modèle après résolution');
  });

  it('10. aucun changement du DOM : lecture seule (closest + getAttribute)', () => {
    const root = fakeEl({ [PV_ID_ATTRIBUTE]: 'card-01' });
    const child = fakeEl({}, root);
    resolvePreviewTarget(child);
    assert.ok(child.reads > 0 && root.reads > 0, 'la résolution a lu l ascendance');
    assert.equal(child.children.length, 0, 'aucun enfant ajouté');
    assert.deepEqual(Object.keys(child.attrs), [], 'aucun attribut écrit');
    assert.equal(child.attrs[PV_ID_ATTRIBUTE], undefined, 'aucun data-pv-id attribué par le résolveur');
  });

  it('11. déterminisme : même chaîne DOM → même résultat, toujours', () => {
    const root = fakeEl({ [PV_ID_ATTRIBUTE]: 'chart-09' });
    const bar = fakeEl({ class: 'pvz-col' }, root);
    const results = Array.from({ length: 5 }, () => resolvePreviewTarget(bar));
    assert.deepEqual(results, ['chart-09', 'chart-09', 'chart-09', 'chart-09', 'chart-09']);
  });

  it('12. plusieurs composants : chacun résout vers SON propre id', () => {
    // Deux cartes voisines, chacune avec un enfant interne au realHtml
    const cardA = fakeEl({ [PV_ID_ATTRIBUTE]: 'revenue' });
    const childA = fakeEl({ class: 'pvz-real' }, cardA);
    const deepA = fakeEl({ class: 'valeur' }, childA);
    const cardB = fakeEl({ [PV_ID_ATTRIBUTE]: 'orders' });
    const childB = fakeEl({ class: 'pvz-real' }, cardB);
    const deepB = fakeEl({ class: 'valeur' }, childB);
    assert.equal(resolvePreviewTarget(deepA), 'revenue');
    assert.equal(resolvePreviewTarget(deepB), 'orders');
    assert.equal(resolvePreviewTarget(cardA), 'revenue');
    assert.equal(resolvePreviewTarget(cardB), 'orders');
  });
});
