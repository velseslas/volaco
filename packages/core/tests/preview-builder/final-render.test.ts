/**
 * ÉTAPE 12 — RENDU FINAL PREMIUM + COHÉRENCE VISUELLE.
 *
 * Garanties (brief, minimum 10) :
 *  1. le preview final est cohérent avec plusieurs types (UNE interface) ;
 *  2. le HTML réel de l'IA reste PRIORITAIRE sur tout fallback ;
 *  3. un composant terminé est STABLE (jamais re-rendu, jamais ré-animé) ;
 *  4. la transition building → completed révèle le contenu final ;
 *  5. aucun timer métier dans le HTML des visuels ;
 *  6. aucun state parallèle (sélecteurs purs, dérivés du state) ;
 *  7. DOM incrémental conservé (politique de non-re-rendu) ;
 *  8. responsive SANS modification du state (viewports = classes CSS) ;
 *  9. reduced-motion (animations neutralisées, chip ✓ invisible par défaut) ;
 * 10. PREVIEW READY stable (le build terminé ne peut pas repartir).
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
import { renderPreview, buildFocus, buildTimeline, shouldRefreshNode } from '../../src/preview-builder/renderer.js';
import { renderComponentVisual } from '../../src/preview-builder/visuals.js';
import { demoSseChunks } from '../../src/preview-builder/mocks.js';
import { consumeSseFrame } from '../../src/preview-builder/adapter.js';

const REAL_HTML = '<section><h1>Dashboard</h1><p>Analysez vos données.</p><a href="#">Voir</a></section>';

function completed(type: string, metadata?: Record<string, unknown>): string {
  return renderComponentVisual({ id: 'n-' + type, type, label: type, ...(metadata ? { metadata } : {}) }, 'completed');
}

function page(): string {
  return readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder.html'), 'utf8');
}

describe('ÉTAPE 12 : rendu final premium + cohérence', () => {
  it('1. preview final cohérent : tous les types produisent UNE interface structurée', () => {
    const header = completed('header', { title: 'MonApp' });
    const sidebar = completed('sidebar', { items: 4 });
    const hero = completed('hero', { title: 'Bienvenue', subtitle: 'Pilotez votre activité' });
    const card = completed('card', { title: 'Revenus', value: '12 456 €', delta: '+12%' });
    const chart = completed('chart', { bars: [40, 65, 50, 80] });
    const footer = completed('footer', { columns: 3 });

    // Cohérence : chaque type a sa structure sémantique, tous partagent le
    // même langage visuel (révélation pvz-anim, aucun ghost en final).
    for (const [name, html] of [['header', header], ['sidebar', sidebar], ['hero', hero], ['card', card], ['chart', chart], ['footer', footer]] as const) {
      assert.ok(html.startsWith('<div class="pvz-'), `${name} : structure pvz-*`);
      assert.ok(html.includes('pvz-anim'), `${name} : révélation cohérente`);
      assert.ok(!html.includes('pv-ghost'), `${name} : aucune zone fantôme dans le final`);
    }
    assert.ok(hero.includes('pvz-hero-title') && hero.includes('pvz-hero-cta'), 'hero composé (titre + action)');
    assert.ok(card.includes('pvz-card-value') && card.includes('pvz-card-delta'), 'carte composée (valeur + delta)');
    assert.ok(footer.includes('pvz-foot-head'), 'footer en colonnes groupées');
    assert.ok(chart.includes('pvz-col'), 'graphique à colonnes réelles');
  });

  it('2. le HTML RÉEL de l IA reste prioritaire sur tout fallback premium', () => {
    for (const type of ['header', 'hero', 'card', 'chart', 'type-inconnu']) {
      const html = renderComponentVisual({ id: 'x', type, label: type, metadata: { html: REAL_HTML, title: 'Fallback', value: 'x', bars: [1, 2] } }, 'completed');
      assert.ok(html.includes('pvz-real'), `${type} : le réel est affiché`);
      assert.ok(html.includes('<h1>Dashboard</h1>'), `${type} : contenu IA intact`);
      assert.ok(!html.includes('Fallback'), `${type} : le fallback ne remplace pas le réel`);
    }
  });

  it('3. un composant terminé est STABLE : rendu identique, objet non recréé', () => {
    const component = { id: 'c1', type: 'card', label: 'Revenus', metadata: { html: REAL_HTML } };
    assert.equal(renderComponentVisual(component, 'completed'), renderComponentVisual(component, 'completed'));
    let s: PreviewBuildState = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'c1', type: 'card' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'c1', timestamp: 3 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: 'c1', timestamp: 4 });
    const frozen = s.components.get('c1');
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'c2', type: 'chart' }, timestamp: 5 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'c2', timestamp: 6 });
    assert.ok(frozen && s.components.get('c1') === frozen, 'les événements des autres ne recréent pas le terminé');
  });

  it('4. transition building → completed : la structure cède la place au contenu', () => {
    const component = { id: 'c1', type: 'card', label: 'Revenus', metadata: { title: 'Revenus', value: '12 456 €', html: REAL_HTML } };
    const building = renderComponentVisual(component, 'building');
    const done = renderComponentVisual(component, 'completed');
    assert.notEqual(building, done, 'les deux modes produisent des rendus distincts');
    assert.ok(building.includes('pv-ghost') && !building.includes('12 456 €'), 'building : structure, pas de contenu final');
    assert.ok(!done.includes('pv-ghost'), 'completed : plus aucune fantôme');
    assert.ok(done.includes('pvz-real'), 'completed : contenu réel révélé');
  });

  it('5. aucun timer métier dans le HTML des visuels (tous types, tous modes)', () => {
    const types = ['header', 'sidebar', 'hero', 'content', 'card', 'chart', 'table', 'footer', 'inconnu'];
    for (const type of types) {
      for (const mode of ['building', 'completed'] as const) {
        const html = renderComponentVisual({ id: 't', type, label: 'T' }, mode);
        for (const forbidden of ['setTimeout', 'setInterval', 'addEventListener', 'requestAnimationFrame', 'javascript:']) {
          assert.ok(!html.includes(forbidden), `${forbidden} interdit (${type}/${mode})`);
        }
      }
    }
  });

  it('6. aucun state parallèle : les sélecteurs restent purs et dérivés', () => {
    let s: PreviewBuildState = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'c1', type: 'card' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'c1', timestamp: 3 });
    const model1 = renderPreview(s);
    const model2 = renderPreview(s);
    assert.deepEqual(model1, model2, 'renderPreview pur');
    assert.deepEqual(buildTimeline(s), buildTimeline(s), 'buildTimeline pur');
    assert.equal(buildFocus(s)?.id, 'c1');
    assert.equal(model1.lastCompletedId, undefined, 'pas encore de stabilisé');
    s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: 'c1', timestamp: 4 });
    assert.equal(renderPreview(s).lastCompletedId, 'c1', 'dernier stabilisé dérivé du state');
  });

  it('7. DOM incrémental conservé : le terminé n est jamais réécrit', () => {
    assert.equal(shouldRefreshNode({ statusChanged: false, focusChanged: true, nextStatus: 'completed' }), false);
    assert.equal(shouldRefreshNode({ statusChanged: false, focusChanged: false, nextStatus: 'completed' }), false);
    assert.equal(shouldRefreshNode({ statusChanged: true, focusChanged: false, nextStatus: 'completed' }), true, 'une seule écriture à la transition');
  });

  it('8. responsive SANS modification du state : les viewports ne font que classer', () => {
    const src = page();
    const appJs = readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder-app.js'), 'utf8');
    const handlerStart = appJs.indexOf("document.querySelectorAll('.vp-btn')");
    assert.ok(handlerStart > 0, 'le handler viewport existe');
    const handler = appJs.slice(handlerStart, handlerStart + 600);
    assert.ok(handler.includes('classList.add') && handler.includes('classList.remove'), 'bascule par classes CSS uniquement');
    for (const forbidden in { applyBuildEvent: 1, consume: 1 }) {
      assert.ok(!handler.includes(forbidden), `${forbidden} interdit dans le handler viewport`);
    }
  });

  it('9. reduced-motion : animations neutralisées et chip ✓ invisible par défaut', () => {
    const source = readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder.html'), 'utf8');
    assert.ok(source.includes('@media (prefers-reduced-motion: reduce)'));
    assert.ok(source.includes('animation: none !important'), 'toutes les animations neutralisées');
    const chipRule = source.slice(source.indexOf('.pv-node.completed::after'));
    assert.ok(chipRule.includes('opacity: 0'), 'le chip ✓ est invisible sans animation (reduced-motion inclus)');
    assert.ok(chipRule.includes('pointer-events: none'), 'le chip ne capte jamais le pointeur');
  });

  it('10. PREVIEW READY stable : le build terminé ne peut pas repartir', () => {
    const events: Parameters<typeof applyBuildEvent>[1][] = [];
    for (const frame of demoSseChunks()) consumeSseFrame(frame, (e) => events.push(e));
    let s: PreviewBuildState = applyBuildEvents(createPreviewBuildState(), events);
    assert.equal(renderPreview(s).statusLabel, 'PREVIEW READY');
    // Un retardataires après la fin est IGNORÉ (hors cycle) : pas de redémarrage
    const before = s;
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'ghost', type: 'card' }, timestamp: 999 });
    assert.equal(s.components.size, before.components.size, 'aucun composant ajouté après la fin');
    assert.equal(renderPreview(s).statusLabel, 'PREVIEW READY', 'le statut final reste stable');
    assert.equal(renderPreview(s).counts.completed, renderPreview(s).counts.total);
  });
});
