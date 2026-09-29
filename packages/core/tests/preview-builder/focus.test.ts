/**
 * LOT 03 — tests des transitions visuelles + Build Focus.
 * Garanties du brief :
 * 1. pending → building déclenche l'état visuel de construction (canvasVisible + focus).
 * 2. building → completed stabilise le composant (focus retiré).
 * 3. error ne casse pas les autres composants.
 * 4. Le Build Focus correspond au composant actif.
 * 5. Plusieurs composants building restent supportés (focus déterministe).
 * 6. L'animation ne modifie JAMAIS l'état (le focus est un sélecteur pur).
 * 7. prefers-reduced-motion : le modèle n'expose aucun champ d'animation
 *    (les transitions vivent en CSS, neutralisables par @media — vérifié page).
 * 8. RESET remet l'état initial.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBuildEvent,
  createPreviewBuildState
} from '../../src/preview-builder/engine.js';
import type { PreviewBuildState } from '../../src/preview-builder/engine.js';
import { buildFocus, renderPreview } from '../../src/preview-builder/renderer.js';

/** Ajoute un composant en building SUR l'état donné (chaînable). */
function addBuilding(
  state: PreviewBuildState,
  id: string,
  type: string,
  label: string,
  orderBase = 0,
  parentId?: string
): PreviewBuildState {
  // Miroir de l'usage réel : si l'état est idle, le générateur démarre
  // d'abord le build (BUILD_STARTED) — le moteur l'exige à juste titre.
  let out = state;
  if (out.status === 'idle') {
    out = applyBuildEvent(out, { kind: 'BUILD_STARTED', timestamp: 9 + orderBase });
  }
  out = applyBuildEvent(out, {
    kind: 'COMPONENT_CREATED',
    component: { id, type, label, ...(parentId !== undefined ? { parentId } : {}) },
    timestamp: 10 + orderBase
  });
  return applyBuildEvent(out, { kind: 'COMPONENT_BUILDING', componentId: id, timestamp: 11 + orderBase });
}

describe('LOT 03 : transitions visuelles + Build Focus', () => {
  it('1. pending → building : le composant devient visible ET porte le focus', () => {
    const s = addBuilding(createPreviewBuildState(), 'h', 'header', 'Header');
    const model = renderPreview(s);
    assert.equal(model.flat[0]!.status, 'building');
    assert.equal(model.flat[0]!.canvasVisible, true);
    assert.equal(model.flat[0]!.isBuildFocus, true, 'le composant building actif est le Build Focus');
    assert.equal(model.focusId, 'h');
  });

  it('2. building → completed : le composant se stabilise et le focus est retiré', () => {
    let s = addBuilding(createPreviewBuildState(), 'h', 'header', 'Header');
    assert.equal(renderPreview(s).flat[0]!.isBuildFocus, true);
    s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: 'h', timestamp: 20 });
    const model = renderPreview(s);
    assert.equal(model.flat[0]!.status, 'completed');
    assert.equal(model.flat[0]!.isBuildFocus, false, 'plus de focus sur un composant stabilisé');
    assert.equal(model.focusId, undefined, 'aucun building restant → aucun focus');
  });

  it('3. error local : le focus BASCULE sur le composant suivant, les autres tiennent', () => {
    let s = addBuilding(createPreviewBuildState(), 'a', 'card', 'Card A');
    s = addBuilding(s, 'b', 'card', 'Card B', 10);
    assert.equal(renderPreview(s).focusId, 'a');
    s = applyBuildEvent(s, { kind: 'COMPONENT_FAILED', componentId: 'a', error: 'boom', timestamp: 30 });
    const model = renderPreview(s);
    assert.equal(model.focusId, 'b', 'le focus passe au building suivant');
    assert.equal(model.flat.find((n) => n.id === 'a')!.status, 'error');
    assert.equal(model.flat.find((n) => n.id === 'b')!.isBuildFocus, true);
    assert.equal(model.counts.error, 1);
    assert.equal(model.status, 'building', 'le build global continue');
  });

  it('4. le Build Focus correspond au composant ACTIF (order minimal parmi building)', () => {
    let s = addBuilding(createPreviewBuildState(), 'z', 'card', 'Z');
    s = addBuilding(s, 'm', 'card', 'M', 10);
    s = addBuilding(s, 'a', 'card', 'A', 20);
    // z a le plus petit order → focus principal, quel que soit l'ordre d'annonce
    assert.equal(buildFocus(s)!.id, 'z');
    assert.equal(renderPreview(s).focusId, 'z');
    s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: 'z', timestamp: 40 });
    assert.equal(renderPreview(s).focusId, 'm', 'à la stabilisation, le focus avance');
  });

  it('5. plusieurs building simultanés : tous affichés, UN SEUL focus déterministe', () => {
    let s = addBuilding(createPreviewBuildState(), 'p1', 'card', 'P1');
    s = addBuilding(s, 'p2', 'card', 'P2', 10);
    const model = renderPreview(s);
    assert.equal(model.counts.building, 2, 'plusieurs building coexistent');
    const focuses = model.flat.filter((n) => n.isBuildFocus);
    assert.equal(focuses.length, 1, 'un seul focus principal');
    assert.equal(focuses[0]!.id, 'p1');
    assert.ok(model.canvas.every((n) => n.canvasVisible), 'tous les building restent rendus');
  });

  it('6. l’animation ne modifie jamais l’état : buildFocus et renderPreview sont PUREMENT dérivés', () => {
    const s = addBuilding(createPreviewBuildState(), 'h', 'header', 'Header');
    const before = JSON.stringify([...s.components.entries()]);
    buildFocus(s);
    renderPreview(s);
    buildFocus(s);
    renderPreview(s);
    assert.equal(JSON.stringify([...s.components.entries()]), before, 'l’état est intact après rendu/focus');
    // Focus dérivé : cohérent à l'infini
    assert.equal(renderPreview(s).focusId, renderPreview(s).focusId);
  });

  it('7. le modèle de rendu n’expose AUCUN champ d’animation ou de timing', () => {
    const model = renderPreview(addBuilding(createPreviewBuildState(), 'h', 'header', 'Header'));
    const flat = JSON.stringify(model.flat);
    for (const forbidden of ['animation', 'setTimeout', 'delay', 'keyframe', 'transition']) {
      assert.ok(!flat.toLowerCase().includes(forbidden), `aucun champ « ${forbidden} » dans le modèle`);
    }
    // Les transitions visuelles vivent en CSS (page), neutralisables par
    // prefers-reduced-motion — l'état et le modèle restent indépendants.
  });

  it('8. RESET : retour à l’état initial, plus de composants ni de focus', () => {
    let s = addBuilding(createPreviewBuildState(), 'h', 'header', 'Header');
    s = applyBuildEvent(s, { kind: 'BUILD_RESET', timestamp: 30 });
    const model = renderPreview(s);
    assert.equal(model.status, 'idle');
    assert.equal(model.flat.length, 0);
    assert.equal(model.focusId, undefined);
    assert.equal(model.progressLabel, 'Components: 0/0');
    assert.equal(model.statusLabel, 'idle');
  });
});
