/**
 * ÉTAPE 05 — tests du Visual Component System + Progressive Content Reveal.
 * Brief : 1-4 visuels par type, 5 fallback générique, 6 registry pur,
 * 7 pending sans contenu final, 8 building = état de construction,
 * 9 completed = contenu final, 10 l'animation ne modifie pas le state,
 * 11 reduced-motion (aucun timing inline), 12 focus cohérent.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasVisual,
  registerVisual,
  renderComponentVisual
} from '../../src/preview-builder/visuals.js';
import {
  applyBuildEvent,
  applyBuildEvents,
  createPreviewBuildState
} from '../../src/preview-builder/engine.js';
import { renderPreview } from '../../src/preview-builder/renderer.js';
import type { VisualComponent } from '../../src/preview-builder/visuals.js';

const comp = (overrides: Partial<VisualComponent> = {}): VisualComponent => ({
  id: 'c1',
  type: 'card',
  label: 'Revenue',
  metadata: { title: 'Revenue', value: '$124,500', delta: '↑ 18.4%' },
  ...overrides
});

describe('ÉTAPE 05 : Visual Component System', () => {
  it('1-4. header, sidebar, card, chart possèdent chacun un renderer visuel distinct', () => {
    for (const type of ['header', 'sidebar', 'card', 'chart']) {
      assert.ok(hasVisual(type), `un visuel existe pour « ${type} »`);
      const html = renderComponentVisual(comp({ type, label: 'Titre' }), 'completed');
      assert.ok(html.length > 20, `${type} produit un visuel non vide`);
    }
    // Structures distinctes : le header a une nav, la card une valeur, le chart des barres
    assert.ok(renderComponentVisual(comp({ type: 'header' }), 'completed').includes('pvz-header'));
    assert.ok(renderComponentVisual(comp({ type: 'sidebar' }), 'completed').includes('pvz-sidebar'));
    assert.ok(renderComponentVisual(comp(), 'completed').includes('$124,500'), 'la card montre sa valeur réelle');
    assert.ok(renderComponentVisual(comp({ type: 'chart', metadata: { bars: [40, 80] } }), 'completed').includes('pvz-bars'));
  });

  it('5. un type inconnu utilise le renderer générique (extensibilité)', () => {
    assert.equal(hasVisual('hero'), false, 'hero n’est pas encore enregistré');
    const html = renderComponentVisual(comp({ type: 'hero', label: 'Bannière' }), 'completed');
    assert.ok(html.includes('pvz-generic'), 'fallback générique');
    assert.ok(html.includes('Bannière'));
    // Extension ouverte : registerVisual('hero', …) sans toucher au moteur
    registerVisual('hero', (c) => `<div class="pvz-hero pvz-anim">${c.label}</div>`);
    assert.equal(hasVisual('hero'), true);
    assert.ok(renderComponentVisual(comp({ type: 'hero', label: 'Bannière' }), 'completed').includes('pvz-hero'));
  });

  it('6. le registry ne modifie jamais le PreviewBuildState (pur)', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'c1', type: 'card', label: 'Revenue', metadata: { value: '$1' } }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'c1', timestamp: 3 });
    const before = JSON.stringify([...s.components.entries()]);
    renderComponentVisual(comp(), 'building');
    renderComponentVisual(comp(), 'completed');
    assert.equal(JSON.stringify([...s.components.entries()]), before, 'state intact');
    // Déterminisme : même entrée → même HTML
    assert.equal(renderComponentVisual(comp(), 'completed'), renderComponentVisual(comp(), 'completed'));
  });
});

describe('ÉTAPE 05 : Progressive Content Reveal', () => {
  it('7. pending n’affiche PAS le contenu final', () => {
    assert.equal(renderComponentVisual(comp(), 'pending'), '', 'pending = rien dans le canvas');
  });

  it('8. building affiche l’état de construction : titre révélé + zones ghost, PAS le contenu final', () => {
    const html = renderComponentVisual(comp(), 'building');
    assert.ok(html.includes('pv-ghost'), 'zones de construction présentes');
    assert.ok(html.includes('Revenue'), 'le titre se révèle en premier');
    assert.ok(!html.includes('$124,500'), 'la valeur finale n’est PAS encore montrée');
    assert.ok(!html.includes('pvz-card-value'), 'pas de bloc de valeur finale en building');
  });

  it('9. completed affiche le contenu final stable (titre + valeur + delta)', () => {
    const html = renderComponentVisual(comp(), 'completed');
    assert.ok(html.includes('Revenue'));
    assert.ok(html.includes('$124,500'));
    assert.ok(html.includes('↑ 18.4%'));
    assert.ok(!html.includes('pv-ghost'), 'plus aucune zone fantôme une fois terminé');
  });

  it('10. l’animation ne modifie pas le state : l’ordre des appels n’a aucun effet', () => {
    // Les 3 statuts du même composant produisent 3 HTML distincts, et
    // l'ordre d'appel n'a aucun effet (pas de mutation cachée).
    const building = renderComponentVisual(comp(), 'building');
    const completed = renderComponentVisual(comp(), 'completed');
    assert.equal(building, renderComponentVisual(comp(), 'building'));
    assert.equal(completed, renderComponentVisual(comp(), 'completed'));
    assert.notEqual(building, completed);
  });

  it('11. reduced-motion : aucun timing JS ni animation inline dans le HTML généré', () => {
    const html = renderComponentVisual(comp(), 'completed');
    assert.ok(!html.includes('setTimeout'), 'aucun timer embarqué');
    assert.ok(!html.includes('animation:'), 'aucune animation inline (elles vivent en CSS page, neutralisables)');
  });

  it('12. le Build Focus reste cohérent avec le registry (mêmes règles, même state)', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'card-01', type: 'card', label: 'Revenue', metadata: { value: '$124,500' } }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'card-01', timestamp: 3 });
    const model = renderPreview(s);
    assert.equal(model.focusId, 'card-01', 'focus inchangé (buildFocus réutilisé)');
    // Le visuel du nœud focus est bien celui du registry, au statut du state
    const node = model.canvas.find((n) => n.id === 'card-01')!;
    const html = renderComponentVisual({ id: node.id, type: node.type, label: node.label, ...(node.metadata !== undefined ? { metadata: node.metadata } : {}) }, node.status);
    assert.ok(html.includes('pv-ghost'), 'le nœud focus rend son état de construction');
  });
});
