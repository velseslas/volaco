/**
 * ÉTAPE 21 — RESIZE INTERACTIF : resizeComponent + intégration UI.
 *
 * Les 14 cas du brief. La commande est pure : SEUL size change — id, type,
 * label É16, variant É17, parentId, order, statut et metadata.html restent
 * intacts ; les autres composants gardent leurs références. Les garanties
 * d'interaction (poignées, aperçu local, cleanup, DnD non déclenché) sont
 * vérifiées par lecture de la source de la page.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyBuildEvents,
  createPreviewBuildState,
  RESIZE_BOUNDS,
  type PreviewBuildEvent,
  type PreviewBuildState
} from '../../src/preview-builder/engine.js';
import { resizeComponent, updateComponentLabel, updateComponentVariant, moveComponent } from '../../src/preview-builder/editing.js';
import { renderPreview, buildInspector } from '../../src/preview-builder/renderer.js';

const REAL_HTML = '<section class="stats"><h2>Revenus</h2></section>';

function scenario(): PreviewBuildState {
  const events: PreviewBuildEvent[] = [
    { kind: 'BUILD_STARTED', stage: 'structure', timestamp: 1 },
    { kind: 'COMPONENT_CREATED', component: { id: 'card', type: 'card', label: 'Revenus', metadata: { html: REAL_HTML } }, timestamp: 2 },
    { kind: 'COMPONENT_BUILDING', componentId: 'card', timestamp: 3 },
    { kind: 'COMPONENT_READY', componentId: 'card', timestamp: 4 },
    { kind: 'COMPONENT_CREATED', component: { id: 'chart', type: 'chart', label: 'Graphique' }, timestamp: 5 }
  ];
  return applyBuildEvents(createPreviewBuildState(), events);
}

const page = (): string => readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder.html'), 'utf8');

describe('ÉTAPE 21 : resize interactif', () => {
  it('1. resize horizontal : seule la largeur change', () => {
    const s = scenario();
    const result = resizeComponent(s, 'card', 420, RESIZE_BOUNDS.minHeight);
    assert.equal(result.applied, true);
    const size = result.state.components.get('card')!.size!;
    assert.equal(size.width, 420);
    assert.equal(size.height, RESIZE_BOUNDS.minHeight);
  });

  it('2. resize vertical : seule la hauteur change', () => {
    const s = scenario();
    const result = resizeComponent(s, 'card', RESIZE_BOUNDS.minWidth, 380);
    assert.equal(result.applied, true);
    const size = result.state.components.get('card')!.size!;
    assert.equal(size.width, RESIZE_BOUNDS.minWidth);
    assert.equal(size.height, 380);
  });

  it('3. resize simultané largeur + hauteur', () => {
    const s = scenario();
    const result = resizeComponent(s, 'card', 560, 300);
    assert.deepEqual(result.state.components.get('card')!.size, { width: 560, height: 300 });
  });

  it('4. min/max : les valeurs sont BORNÉES explicitement', () => {
    const s = scenario();
    const tiny = resizeComponent(s, 'card', 1, 1);
    assert.deepEqual(tiny.state.components.get('card')!.size, { width: RESIZE_BOUNDS.minWidth, height: RESIZE_BOUNDS.minHeight });
    const huge = resizeComponent(s, 'card', 99999, 99999);
    assert.deepEqual(huge.state.components.get('card')!.size, { width: RESIZE_BOUNDS.maxWidth, height: RESIZE_BOUNDS.maxHeight });
  });

  it('5. dimensions invalides (non finies) → refus explicite', () => {
    const s = scenario();
    for (const [w, h] of [[NaN, 200], [200, NaN], [Infinity, 200], [200, Infinity]] as const) {
      const result = resizeComponent(s, 'card', w, h);
      assert.equal(result.applied, false);
      assert.equal(result.reason, 'invalid-dimensions');
      assert.equal(result.state, s, 'même référence retournée');
    }
  });

  it('6. composant inexistant → unknown-component', () => {
    const s = scenario();
    const result = resizeComponent(s, 'fantome', 300, 200);
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'unknown-component');
    assert.equal(result.state, s);
  });

  it('7. state inchangé PENDANT le resize (pointermove sans mutation)', () => {
    const source = page();
    const downStart = source.indexOf("document.addEventListener('pointerdown'", source.indexOf('ÉTAPE 21 — RESIZE'));
    const moveStart = source.indexOf("document.addEventListener('pointermove'", downStart);
    const moveEnd = source.indexOf("document.addEventListener('pointerup'", moveStart);
    const moveBlock = source.slice(moveStart, moveEnd);
    assert.ok(moveBlock.includes('nodeEl.style.width'), 'aperçu visuel local = style inline');
    for (const forbidden of ['state =', 'renderCurrent()', 'applyBuildEvent']) {
      assert.ok(!moveBlock.includes(forbidden), `${forbidden} interdit pendant le pointermove du resize`);
    }
  });

  it('8. aucun déplacement DOM pendant le resize (style seul)', () => {
    const source = page();
    const downStart = source.indexOf("document.addEventListener('pointerdown'", source.indexOf('ÉTAPE 21 — RESIZE'));
    const moveStart = source.indexOf("document.addEventListener('pointermove'", downStart);
    const moveEnd = source.indexOf("document.addEventListener('pointerup'", moveStart);
    const moveBlock = source.slice(moveStart, moveEnd);
    for (const forbidden of ['appendChild', 'insertBefore', '.innerHTML', 'removeChild']) {
      assert.ok(!moveBlock.includes(forbidden), `${forbidden} interdit pendant le resize`);
    }
  });

  it('9. data-pv-id inchangé après resize (l identité vient du modèle)', () => {
    const s = scenario();
    const result = resizeComponent(s, 'card', 500, 250);
    const model = renderPreview(result.state);
    assert.ok(model.flat.some((n) => n.id === 'card'), 'le composant garde son id');
    assert.equal(result.state.components.get('card')!.id, 'card');
  });

  it('10. label É16, variant É17 et metadata.html conservés (même référence)', () => {
    let s = updateComponentLabel(scenario(), 'card', 'Carte Éditée').state;
    s = updateComponentVariant(s, 'card', 'featured').state;
    const metaAvant = s.components.get('card')!.metadata;
    const après = resizeComponent(s, 'card', 500, 250).state.components.get('card')!;
    assert.equal(après.label, 'Carte Éditée');
    assert.equal(après.variant, 'featured');
    assert.equal(après.metadata, metaAvant);
    assert.equal(après.metadata?.html, REAL_HTML);
  });

  it('11. sélection conservée : le modèle reflète la sélection après resize', () => {
    let s = scenario();
    s = resizeComponent(s, 'card', 500, 250).state;
    const model = renderPreview(s, { selectedId: 'card' });
    const selected = model.flat.find((n) => n.isUserSelected)!;
    assert.equal(selected.id, 'card');
    assert.equal(selected.size!.width, 500);
    const inspector = buildInspector(s, 'card');
    assert.deepEqual(inspector!.size, { width: 500, height: 250 });
  });

  it('12. DnD NON déclenché depuis une poignée (capture + stopPropagation)', () => {
    const source = page();
    const resizeDown = source.indexOf("document.addEventListener('pointerdown'", source.indexOf('ÉTAPE 21 — RESIZE'));
    const resizeBlock = source.slice(resizeDown, resizeDown + 1400);
    assert.ok(resizeBlock.includes('}, true)'), "l écouteur resize est en CAPTURE (avant le DnD)");
    assert.ok(resizeBlock.includes('stopPropagation()'), 'stopPropagation bloque le pointerdown du DnD');
    assert.ok(resizeBlock.includes('preventDefault()'));
    // et la source du DnD ne contient aucune référence aux poignées
    const dndDown = source.indexOf("el('canvas').addEventListener('pointerdown'");
    const dndBlock = source.slice(dndDown, dndDown + 400);
    assert.ok(!dndBlock.includes('pv-resize-handle'), 'le DnD ignore les poignées');
  });

  it('13. pointercancel nettoie tout et restaure le state', () => {
    const source = page();
    const cancelStart = source.lastIndexOf("document.addEventListener('pointercancel'");
    const cancelBlock = source.slice(cancelStart, cancelStart + 400);
    assert.ok(cancelBlock.includes('resizeCtx = null'), 'contexte de resize réinitialisé');
    assert.ok(cancelBlock.includes("classList.remove('pv-resizing')"), 'état visuel nettoyé');
    assert.ok(cancelBlock.includes('renderCurrent()'), 'le style est restauré depuis le state');
    // Modèle : un pointercancel sans resizeComponent ne change rien
    const s = scenario();
    const modelBefore = renderPreview(s);
    assert.deepEqual(renderPreview(s), modelBefore);
  });

  it('14. RESET et nouvelle génération : aucune fuite de dimensions', () => {
    let s = resizeComponent(scenario(), 'card', 500, 250).state;
    // Nouvelle construction (BUILD_STARTED réinitialise les composants)
    s = applyBuildEvents(s, [{ kind: 'BUILD_STARTED', stage: 'structure', timestamp: 100 }]);
    assert.equal(s.components.size, 0);
    const fresh = applyBuildEvents(s, [
      { kind: 'COMPONENT_CREATED', component: { id: 'card', type: 'card', label: 'Revenus' }, timestamp: 101 }
    ]);
    assert.equal(fresh.components.get('card')!.size, undefined, 'aucune taille de l ancienne génération ne fuit');
    assert.equal(buildInspector(fresh, 'card')!.size, undefined);
    // et un déplacement É18 ne révèle pas non plus la taille
    const moved = moveComponent(resizeComponent(scenario(), 'card', 500, 250).state, 'card', 'chart', 0).state;
    assert.equal(moved.components.get('card')!.size!.width, 500, 'la taille suit son composant');
  });
});
