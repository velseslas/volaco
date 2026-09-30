/**
 * ÉTAPE 16 — PREMIÈRE COMMANDE D'ÉDITION : updateComponentLabel.
 *
 * Les 9 cas du brief + préservation des champs + intégration renderer.
 * La commande est PURE : aucun DOM, aucun SSE, aucun générateur — elle
 * produit un NOUVEAU PreviewBuildState ou retourne le MÊME avec une raison.
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
import { updateComponentLabel } from '../../src/preview-builder/editing.js';
import { renderPreview, buildInspector } from '../../src/preview-builder/renderer.js';

const REAL_HTML = '<section class="hero"><h1>Titre IA</h1></section>';

function scenario(): PreviewBuildState {
  const events: PreviewBuildEvent[] = [
    { kind: 'BUILD_STARTED', stage: 'structure', timestamp: 1 },
    { kind: 'COMPONENT_CREATED', component: { id: 'hero', type: 'hero', label: 'Héros', metadata: { html: REAL_HTML, title: 'Titre IA' } }, timestamp: 2 },
    { kind: 'COMPONENT_BUILDING', componentId: 'hero', timestamp: 3 },
    { kind: 'COMPONENT_READY', componentId: 'hero', timestamp: 4 },
    { kind: 'COMPONENT_CREATED', component: { id: 'orders', type: 'card', label: 'Commandes' }, timestamp: 5 },
    { kind: 'COMPONENT_BUILDING', componentId: 'orders', timestamp: 6 }
  ];
  return applyBuildEvents(createPreviewBuildState(), events);
}

describe('ÉTAPE 16 : updateComponentLabel', () => {
  it('1. modification réussie : nouveau state, applied=true', () => {
    const s = scenario();
    const result = updateComponentLabel(s, 'hero', 'Bannière principale');
    assert.equal(result.applied, true);
    assert.equal(result.reason, undefined);
    assert.equal(result.state.components.get('hero')!.label, 'Bannière principale');
    assert.notEqual(result.state, s, 'un NOUVEL état a été produit');
  });

  it('2. composant inexistant : état INCHANGÉ (même référence) + raison explicite', () => {
    const s = scenario();
    const result = updateComponentLabel(s, 'fantome', 'X');
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'unknown-component');
    assert.equal(result.state, s, 'la même référence est retournée');
  });

  it('3. label vide (même après trim) → refus explicite', () => {
    const s = scenario();
    for (const vide of ['', '   ']) {
      const result = updateComponentLabel(s, 'hero', vide);
      assert.equal(result.applied, false);
      assert.equal(result.reason, 'empty-label');
      assert.equal(result.state, s);
    }
  });

  it('4. trim : les espaces autour sont retirés', () => {
    const s = scenario();
    const result = updateComponentLabel(s, 'hero', '   Nouveau Héros   ');
    assert.equal(result.applied, true);
    assert.equal(result.state.components.get('hero')!.label, 'Nouveau Héros');
  });

  it('5. même valeur : état inchangé (même référence)', () => {
    const s = scenario();
    const result = updateComponentLabel(s, 'hero', 'Héros');
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'unchanged');
    assert.equal(result.state, s);
  });

  it('6. immutabilité : l ANCIEN state n est jamais muté', () => {
    const s = scenario();
    const avant = renderPreview(s);
    updateComponentLabel(s, 'hero', 'Modifié');
    assert.equal(s.components.get('hero')!.label, 'Héros', 'l ancien state garde son label');
    assert.deepEqual(renderPreview(s), avant, 'l ancien state rend exactement le même modèle');
  });

  it('7. les AUTRES composants restent strictement identiques (mêmes références)', () => {
    const s = scenario();
    const ordersAvant = s.components.get('orders');
    const result = updateComponentLabel(s, 'hero', 'Modifié');
    assert.ok(ordersAvant && result.state.components.get('orders') === ordersAvant);
    assert.equal(result.state.components.size, s.components.size);
    // Le reste de l'état (journal, statut, stages) est conservé à l'identique
    assert.equal(result.state.status, s.status);
    assert.equal(result.state.stage, s.stage);
    assert.equal(result.state.events.length, s.events.length);
  });

  it('8. metadata.html PRÉSERVÉ (même référence, jamais touché)', () => {
    const s = scenario();
    const metadataAvant = s.components.get('hero')!.metadata;
    const result = updateComponentLabel(s, 'hero', 'Modifié');
    const après = result.state.components.get('hero')!;
    assert.equal(après.metadata, metadataAvant, 'l objet metadata est conservé tel quel');
    assert.equal(après.metadata?.html, REAL_HTML);
  });

  it('9. déterminisme : même entrée → même résultat', () => {
    const s = scenario();
    const a = updateComponentLabel(s, 'hero', 'Label X');
    const b = updateComponentLabel(s, 'hero', 'Label X');
    assert.deepEqual(a.applied, b.applied);
    assert.equal(a.state.components.get('hero')!.label, b.state.components.get('hero')!.label);
  });

  it('10. tous les champs du composant sont préservés (id, type, parentId, status, stage, order)', () => {
    const s = scenario();
    const heroAvant = s.components.get('hero')!;
    const après = updateComponentLabel(s, 'hero', 'Modifié').state.components.get('hero')!;
    assert.equal(après.id, heroAvant.id);
    assert.equal(après.type, heroAvant.type);
    assert.equal(après.parentId, heroAvant.parentId);
    assert.equal(après.status, heroAvant.status);
    assert.equal(après.stage, heroAvant.stage);
    assert.equal(après.order, heroAvant.order);
    assert.equal(après.error, heroAvant.error);
    // Seul le label change : les enfants (dérivés via parentId) sont inchangés
    assert.deepEqual(buildInspector(updateComponentLabel(s, 'hero', 'Modifié').state, 'hero')!.children, buildInspector(s, 'hero')!.children);
  });

  it('11. intégration : le nouveau label est vu par le renderer et l inspector', () => {
    let s = scenario();
    s = updateComponentLabel(s, 'hero', 'Bannière IA').state;
    const model = renderPreview(s);
    assert.equal(model.flat.find((n) => n.id === 'hero')!.label, 'Bannière IA');
    assert.equal(model.selectedLabel, undefined);
    const inspector = buildInspector(s, 'hero');
    assert.equal(inspector!.label, 'Bannière IA');
    assert.equal(inspector!.metadata?.html, REAL_HTML, 'l inspector montre toujours le HTML réel intact');
  });
});
