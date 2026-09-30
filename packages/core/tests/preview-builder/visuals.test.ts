/**
 * ÉTAPES 05+10 — tests du Visual Component System enrichi.
 * ÉTAPE 05 : registry ouvert, fallback, pureté, modes building/completed.
 * ÉTAPE 10 : visuels enrichis par type (hero/footer/…), données RÉELLES
 * (metadata.html prioritaire à completed), aucun timer JS, anti-flicker.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasVisual,
  registerVisual,
  renderComponentVisual
} from '../../src/preview-builder/visuals.js';
import type { VisualComponent } from '../../src/preview-builder/visuals.js';

const comp = (overrides: Partial<VisualComponent> = {}): VisualComponent => ({
  id: 'c1',
  type: 'card',
  label: 'Revenue',
  metadata: { title: 'Revenue', value: '$124,500', delta: '↑ 18.4%' },
  ...overrides
});

describe('ÉTAPES 05+10 : Visual Component System enrichi', () => {
  it('1-4. tous les types ont un visuel distinct : header/sidebar/hero/card/chart/content/footer', () => {
    for (const type of ['header', 'sidebar', 'hero', 'card', 'chart', 'content', 'footer']) {
      assert.ok(hasVisual(type), `visuel « ${type} » enregistré`);
      const done = renderComponentVisual(comp({ type, label: 'Z' }), 'completed');
      assert.ok(done.length > 20, `${type} completed non vide`);
      const building = renderComponentVisual(comp({ type, label: 'Z' }), 'building');
      assert.ok(building.includes('pv-ghost'), `${type} building = titre + zones ghost`);
      assert.ok(building.includes('pvz-anim'), `${type} building : titre révélé par CSS`);
    }
    // Structures distinctes
    assert.ok(renderComponentVisual(comp({ type: 'header' }), 'completed').includes('pvz-header'));
    assert.ok(renderComponentVisual(comp({ type: 'sidebar' }), 'completed').includes('pvz-sidebar'));
    assert.ok(renderComponentVisual(comp({ type: 'hero' }), 'completed').includes('pvz-hero'));
    assert.ok(renderComponentVisual(comp({ type: 'footer' }), 'completed').includes('pvz-footer'));
    assert.ok(renderComponentVisual(comp(), 'completed').includes('$124,500'), 'card = valeur réelle');
  });

  it('5. registry OUVERT : un type inconnu utilise le générique, puis extension sans toucher au moteur', () => {
    assert.equal(hasVisual('mystique'), false);
    const b = renderComponentVisual(comp({ type: 'mystique', label: 'Mystère' }), 'building');
    const d = renderComponentVisual(comp({ type: 'mystique', label: 'Mystère' }), 'completed');
    assert.ok(b.includes('pv-ghost'), 'générique building = ghosts aussi');
    assert.ok(d.includes('Mystère') && d.includes('mystique'));
    registerVisual('mystique', (c) => `<div class="pvz-hero pvz-anim">${c.label}</div>`);
    assert.equal(hasVisual('mystique'), true);
    assert.ok(renderComponentVisual(comp({ type: 'mystique', label: 'M' }), 'completed').includes('pvz-hero'));
  });

  it('6. building : titre révélé, contenu final ABSENT (révélation progressive)', () => {
    const building = renderComponentVisual(comp(), 'building');
    assert.ok(building.includes('Revenue'), 'titre révélé pendant la construction');
    assert.ok(building.includes('pv-ghost'), 'zones de construction présentes');
    assert.ok(!building.includes('$124,500'), 'la valeur finale n’est pas montrée en building');
    assert.ok(!building.includes('pvz-card-value'), 'pas de bloc de valeur finale');
  });

  it('7. completed : le contenu RÉEL est affiché (valeur + delta), plus aucune zone fantôme', () => {
    const html = renderComponentVisual(comp(), 'completed');
    assert.ok(html.includes('Revenue'));
    assert.ok(html.includes('$124,500'));
    assert.ok(html.includes('↑ 18.4%'));
    assert.ok(!html.includes('pv-ghost'));
  });

  it('8. hero : building = titre + ghosts ; completed = titre + sous-titre', () => {
    const c = comp({ type: 'hero', label: 'Bienvenue', metadata: { title: 'Bienvenue', subtitle: 'Votre espace' } });
    assert.ok(renderComponentVisual(c, 'building').includes('Bienvenue'));
    const done = renderComponentVisual(c, 'completed');
    assert.ok(done.includes('Bienvenue') && done.includes('Votre espace'));
  });

  it('9. footer : building = ghosts ; completed = colonnes réelles', () => {
    const c = comp({ type: 'footer', label: 'Pied', metadata: { columns: 4 } });
    assert.ok(renderComponentVisual(c, 'building').includes('pv-ghost'));
    const done = renderComponentVisual(c, 'completed');
    assert.ok(done.includes('Colonne 1') && done.includes('Colonne 4'));
  });

  it('10. chart : building = barres fantômes ; completed = barres réelles depuis metadata', () => {
    const c = comp({ type: 'chart', metadata: { bars: [30, 60, 90] } });
    assert.ok(renderComponentVisual(c, 'building').includes('pv-ghost'));
    const done = renderComponentVisual(c, 'completed');
    assert.equal((done.match(/pvz-col/g) || []).length, 3, 'une barre par donnée réelle');
  });

  it('11. DONNÉES RÉELLES : metadata.html (généré par l’IA) prioritaire à completed', () => {
    const c = comp({
      type: 'card',
      metadata: { title: 'Revenue', html: '<section data-section="revenue"><h2>Revenue réel</h2><p>Contenu IA</p></section>' }
    });
    const html = renderComponentVisual(c, 'completed');
    assert.ok(html.includes('Revenue réel'), 'le HTML réel de l’IA est affiché');
    assert.ok(html.includes('pvz-real'), 'enveloppé pour le reveal CSS');
    assert.ok(renderComponentVisual(c, 'building').includes('pv-ghost'), 'building reste l’état de construction');
  });

  it('12. les valeurs mock ne fuient pas quand les données réelles n’existent pas', () => {
    const c = comp({ type: 'card', metadata: { title: 'Seulement un titre' } });
    const html = renderComponentVisual(c, 'completed');
    assert.ok(html.includes('Seulement un titre'));
    assert.ok(!html.includes('$124,500'), 'aucune valeur mock codée en dur');
    assert.ok(html.includes('—'), 'valeur absente = — neutre');
  });

  it('13. PUR : déterministe, aucune mutation de l’entrée', () => {
    const c = comp();
    assert.equal(renderComponentVisual(c, 'completed'), renderComponentVisual(c, 'completed'));
    const copy = JSON.parse(JSON.stringify(c));
    renderComponentVisual(c, 'building');
    renderComponentVisual(c, 'completed');
    assert.deepEqual(c, copy);
  });

  it('14. reduced-motion : aucun timer JS, aucun handler inline dans le HTML généré', () => {
    const html = renderComponentVisual(comp(), 'completed') + renderComponentVisual(comp(), 'building');
    assert.ok(!html.includes('setTimeout'), 'aucun timer');
    assert.ok(!html.includes('addEventListener'), 'aucun handler inline');
  });
});
