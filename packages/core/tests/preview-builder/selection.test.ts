/**
 * ÉTAPE 14 — SÉLECTION INTERACTIVE MINIMALE (fondation É13 consommée).
 *
 * Les 15 cas du brief. La sélection est un ÉTAT D'INTERACTION UI : porté par
 * le MODÈLE DE RENDU uniquement (renderPreview(state, { selectedId })), jamais
 * injecté dans PreviewBuildState. resolvePreviewTarget() reste l'unique
 * mécanisme d'identification ; le Build Focus (IA) et la sélection
 * (utilisateur) sont indépendants et coexistent.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyBuildEvent,
  applyBuildEvents,
  createPreviewBuildState,
  type PreviewBuildEvent,
  type PreviewBuildState
} from '../../src/preview-builder/engine.js';
import { renderPreview, resolvePreviewTarget, shouldRefreshNode, PV_ID_ATTRIBUTE, type PreviewTargetElement } from '../../src/preview-builder/renderer.js';

interface FakeEl extends PreviewTargetElement {
  attrs: Record<string, string>;
  parent?: FakeEl;
  children: FakeEl[];
}
function fakeEl(attrs: Record<string, string>, parent?: FakeEl): FakeEl {
  const el: FakeEl = {
    attrs,
    ...(parent ? { parent } : {}),
    children: [],
    closest(selectors: string): FakeEl | null {
      let cur: FakeEl | undefined = el;
      while (cur) {
        if (selectors === `[${PV_ID_ATTRIBUTE}]` && cur.attrs[PV_ID_ATTRIBUTE] !== undefined) return cur;
        cur = cur.parent;
      }
      return null;
    },
    getAttribute(name: string): string | null {
      return el.attrs[name] ?? null;
    }
  };
  if (parent) parent.children.push(el);
  return el;
}

function started(): PreviewBuildState {
  return applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
}

/** Scénario : revenue (completed), orders (building), chart (créé, pending). */
function scenario(): PreviewBuildState {
  const events: PreviewBuildEvent[] = [
    { kind: 'BUILD_STARTED', timestamp: 1 },
    { kind: 'COMPONENT_CREATED', component: { id: 'revenue', type: 'card', label: 'Revenus' }, timestamp: 2 },
    { kind: 'COMPONENT_BUILDING', componentId: 'revenue', timestamp: 3 },
    { kind: 'COMPONENT_READY', componentId: 'revenue', timestamp: 4 },
    { kind: 'COMPONENT_CREATED', component: { id: 'orders', type: 'card', label: 'Commandes' }, timestamp: 5 },
    { kind: 'COMPONENT_BUILDING', componentId: 'orders', timestamp: 6 },
    { kind: 'COMPONENT_CREATED', component: { id: 'chart', type: 'chart' }, timestamp: 7 }
  ];
  return applyBuildEvents(started(), events);
}

describe('ÉTAPE 14 : sélection interactive', () => {
  it('1. clic sur la racine d un composant → sélection correcte', () => {
    const root = fakeEl({ [PV_ID_ATTRIBUTE]: 'revenue' });
    const id = resolvePreviewTarget(root);
    assert.equal(id, 'revenue');
    const model = renderPreview(scenario(), { selectedId: id });
    const selected = model.flat.filter((n) => n.isUserSelected);
    assert.deepEqual(selected.map((n) => n.id), ['revenue']);
  });

  it('2. clic sur un ENFANT → le composant parent est sélectionné', () => {
    const root = fakeEl({ [PV_ID_ATTRIBUTE]: 'revenue' });
    const title = fakeEl({ class: 'pvz-card-title' }, root);
    const id = resolvePreviewTarget(title);
    assert.equal(id, 'revenue', 'resolvePreviewTarget remonte au parent');
    const model = renderPreview(scenario(), { selectedId: id });
    assert.equal(model.flat.find((n) => n.isUserSelected)!.id, 'revenue');
  });

  it('3. clic DANS le HTML réel IA → le composant porteur est sélectionné', () => {
    const root = fakeEl({ [PV_ID_ATTRIBUTE]: 'revenue' });
    const real = fakeEl({ class: 'pvz-real' }, root);
    const section = fakeEl({ class: 'stats' }, real);
    const strong = fakeEl({}, section);
    const id = resolvePreviewTarget(strong);
    assert.equal(id, 'revenue');
    const model = renderPreview(scenario(), { selectedId: id });
    assert.equal(model.selectedId, 'revenue');
    assert.equal(model.selectedLabel, 'Revenus');
  });

  it('4. clic HORS Preview → null → aucune sélection', () => {
    const outside = fakeEl({ class: 'panel-build' });
    assert.equal(resolvePreviewTarget(outside), null);
    const model = renderPreview(scenario(), { selectedId: null });
    assert.ok(model.flat.every((n) => !n.isUserSelected));
    assert.equal(model.selectedId, undefined);
    assert.equal(model.selectedLabel, undefined);
  });

  it('5. UN SEUL composant sélectionné à la fois', () => {
    const model = renderPreview(scenario(), { selectedId: 'revenue' });
    assert.equal(model.flat.filter((n) => n.isUserSelected).length, 1);
  });

  it('6. changement de sélection : Revenue → Orders (remplacement, pas accumulation)', () => {
    const first = renderPreview(scenario(), { selectedId: 'revenue' });
    const second = renderPreview(scenario(), { selectedId: 'orders' });
    assert.equal(first.flat.find((n) => n.isUserSelected)!.id, 'revenue');
    assert.equal(second.flat.find((n) => n.isUserSelected)!.id, 'orders');
    assert.equal(second.flat.filter((n) => n.isUserSelected).length, 1);
  });

  it('7. un composant BUILDING reste sélectionnable', () => {
    const model = renderPreview(scenario(), { selectedId: 'orders' });
    const node = model.flat.find((n) => n.isUserSelected)!;
    assert.equal(node.status, 'building', 'le statut du composant est inchangé');
    assert.ok(node.isUserSelected);
  });

  it('8. un composant COMPLETED reste sélectionnable', () => {
    const model = renderPreview(scenario(), { selectedId: 'revenue' });
    const node = model.flat.find((n) => n.isUserSelected)!;
    assert.equal(node.status, 'completed');
    assert.ok(node.isUserSelected);
  });

  it('9. Build Focus INDÉPENDANT : la sélection ne le fait pas disparaître', () => {
    const withoutSelection = renderPreview(scenario());
    const withSelection = renderPreview(scenario(), { selectedId: 'revenue' });
    assert.equal(withoutSelection.focusId, 'orders', 'focus IA sur orders');
    assert.equal(withSelection.focusId, 'orders', 'la sélection ne déplace pas le focus');
    const focused = withSelection.flat.find((n) => n.isBuildFocus)!;
    const selected = withSelection.flat.find((n) => n.isUserSelected)!;
    assert.equal(focused.id, 'orders');
    assert.equal(selected.id, 'revenue');
    assert.ok(focused.isBuildFocus && !focused.isUserSelected);
    assert.ok(selected.isUserSelected && !selected.isBuildFocus);
  });

  it('10. Tree et Canvas lisent la MÊME sélection (un seul model)', () => {
    const model = renderPreview(scenario(), { selectedId: 'revenue' });
    const canvasNode = model.canvas.find((n) => n.id === 'revenue')!;
    const flatNode = model.flat.find((n) => n.id === 'revenue')!;
    assert.ok(canvasNode.isUserSelected && flatNode.isUserSelected, 'même source de vérité');
    assert.equal(model.selectedId, 'revenue');
  });

  it('11. AUCUN changement du PreviewBuildState (rétrocompatibilité totale)', () => {
    const s = scenario();
    const before = renderPreview(s);
    const stateRef = s;
    renderPreview(s, { selectedId: 'revenue' });
    renderPreview(s, { selectedId: 'orders' });
    assert.ok(s === stateRef, 'le state n est pas muté');
    const after = renderPreview(s);
    assert.deepEqual(after, before, 'sans option, le modèle est strictement identique à avant l ÉTAPE 14');
    assert.equal(after.selectedId, undefined);
  });

  it('12. AUCUN rebuild du canvas : la sélection ne passe pas par la politique de refresh', () => {
    // La sélection n'est PAS une entrée de shouldRefreshNode : un changement
    // de sélection ne déclenche aucune réécriture de nœud.
    assert.equal(shouldRefreshNode({ statusChanged: false, focusChanged: false, nextStatus: 'completed' }), false);
    // La page n'applique la sélection QUE par classes + attribut
    const source = readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder-app.js'), 'utf8');
    const block = source.slice(source.indexOf('HIGHLIGHT DE SÉLECTION'), source.indexOf('AUTO-SCROLL doux'));
    assert.ok(block.includes('classList.add') && block.includes('setAttribute'), 'classes + attribut uniquement');
    assert.ok(!block.includes('.innerHTML'), 'aucun innerHTML dans l application de la sélection');
  });

  it('13. le libellé provient DU MODÈLE : label, repli type, jamais l id ni le DOM', () => {
    // component.label → « Revenus »
    const withLabel = renderPreview(scenario(), { selectedId: 'revenue' });
    assert.equal(withLabel.selectedLabel, 'Revenus');
    // sans label → repli TYPE (chart n'a pas de label)
    const withType = renderPreview(scenario(), { selectedId: 'chart' });
    assert.equal(withType.selectedLabel, 'chart');
    // jamais l id : un composant dont label === id retombe sur le type
    let s = started();
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'stats-cards', type: 'cards', label: 'stats-cards' }, timestamp: 2 });
    assert.equal(renderPreview(s, { selectedId: 'stats-cards' }).selectedLabel, 'cards');
  });

  it('14. responsive conserve l identité ET la sélection', () => {
    const model = renderPreview(scenario(), { selectedId: 'revenue' });
    const modelAgain = renderPreview(scenario(), { selectedId: 'revenue' });
    assert.deepEqual(model, modelAgain, 'le modèle n a AUCUN champ viewport : la sélection survit à un changement d affichage');
    // É30 : les boutons viewport sont supprimés — la sélection ne peut plus
    // être dérangée par un clic viewport (il n existe plus de bouton).
    const pageSrc = readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder-app.js'), 'utf8');
    assert.ok(!pageSrc.includes('vp-switch'), 'aucun bouton viewport dans la page');
  });

  it('15. sélection DÉTERMINISTE : même entrée → même modèle', () => {
    const a = renderPreview(scenario(), { selectedId: 'orders' });
    const b = renderPreview(scenario(), { selectedId: 'orders' });
    assert.deepEqual(a, b);
  });
});
