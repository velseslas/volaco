/**
 * ÉTAPE 11 — CONSTRUCTION VISUELLE TEMPS RÉEL : les 14 garanties du brief.
 *
 * - la phase `building` montre une STRUCTURE temporaire crédible (ghosts),
 *   jamais le contenu final ;
 * - à `completed`, le HTML RÉEL de l'IA est révélé, prioritaire sur tout
 *   fallback, puis devient STABLE (jamais re-rendu, jamais ré-animé) ;
 * - le passage de témoin (focus c1 → focus c2) est déterministe et identique
 *   dans le canvas, l'arbre et la barre d'état (UN seul buildFocus dérivé) ;
 * - AUCUN timer métier, AUCUN state parallèle, AUCUN deuxième moteur :
 *   STATE → RENDER → CSS, l'animation n'est jamais la source de vérité.
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
import {
  renderPreview,
  buildFocus,
  buildTimeline,
  shouldRefreshNode
} from '../../src/preview-builder/renderer.js';
import { renderComponentVisual } from '../../src/preview-builder/visuals.js';
import { demoSseChunks } from '../../src/preview-builder/mocks.js';
import { consumeSseFrame } from '../../src/preview-builder/adapter.js';

const REAL_HTML = '<section class="temoignages"><h2>Ce qu ils en disent</h2><blockquote>Citation cliente</blockquote></section>';

function started(): PreviewBuildState {
  return applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
}

describe('ÉTAPE 11 : construction visuelle temps réel', () => {
  it('1. building affiche la STRUCTURE temporaire (ghosts), jamais le contenu final', () => {
    const building = renderComponentVisual({ id: 'c1', type: 'card', label: 'Revenue', metadata: { title: 'Revenue', value: '$124,500' } }, 'building');
    assert.ok(building.includes('pvz-card-title'), 'le titre est révélé tôt');
    assert.ok(building.includes('pv-ghost'), 'des zones fantômes structurent la carte');
    assert.ok(!building.includes('$124,500'), 'la valeur finale reste absente pendant le building');
    assert.ok(!building.includes('pvz-real'), 'pas de contenu réel pendant le building');

    const chart = renderComponentVisual({ id: 'c2', type: 'chart', label: 'Activité' }, 'building');
    assert.ok(chart.includes('pvz-col-ghost'), 'le graphique montre des COLONNES fantômes (silhouette finale)');
  });

  it('2. completed affiche le contenu RÉEL (metadata.html généré par l IA)', () => {
    const html = renderComponentVisual({ id: 'c1', type: 'temoignages', label: 'Témoignages', metadata: { html: REAL_HTML } }, 'completed');
    assert.ok(html.includes('pvz-real'), 'le HTML réel est enveloppé pour le reveal CSS');
    assert.ok(html.includes('blockquote'), 'le contenu réel est présent tel quel');
  });

  it('3. le contenu réel est PRIORITAIRE sur tout fallback (même pour un type connu)', () => {
    const html = renderComponentVisual(
      { id: 'c1', type: 'chart', label: 'Graphique', metadata: { bars: [10, 20], html: REAL_HTML } },
      'completed'
    );
    assert.ok(html.includes('pvz-real'), 'le HTML réel gagne');
    assert.ok(!html.includes('pvz-col"'), 'le fallback barres ne remplace pas le réel');
  });

  it('4. un composant terminé reste STABLE : rendu identique et objet inchangé', () => {
    const component = { id: 'c1', type: 'card', label: 'Revenue', metadata: { html: REAL_HTML } };
    assert.equal(renderComponentVisual(component, 'completed'), renderComponentVisual(component, 'completed'), 'pur : même entrée → même HTML');

    // Modèle : les événements des AUTRES composants ne recréent pas l'objet c1
    let s = started();
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'c1', type: 'card' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'c1', timestamp: 3 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: 'c1', timestamp: 4 });
    const c1Avant = s.components.get('c1');
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'c2', type: 'chart' }, timestamp: 5 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'c2', timestamp: 6 });
    assert.ok(c1Avant && s.components.get('c1') === c1Avant, 'immuabilité : c1 achevé n est pas recréé (aucun signal de re-rendu)');
  });

  it('5. le composant SUIVANT reçoit le focus quand le précédent se stabilise', () => {
    let s = started();
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'c1', type: 'card' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'c1', timestamp: 3 });
    assert.equal(buildFocus(s)?.id, 'c1');
    s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: 'c1', timestamp: 4 });
    assert.equal(buildFocus(s)?.id, undefined, 'pas de focus entre les deux composants');
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'c2', type: 'chart' }, timestamp: 5 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'c2', timestamp: 6 });
    assert.equal(buildFocus(s)?.id, 'c2', 'le témoin passe à c2');
  });

  it('6. focus UNIQUE : canvas, tree et statusbar lisent le même buildFocus', () => {
    let s = started();
    s = applyBuildEvents(s, [
      { kind: 'COMPONENT_CREATED', component: { id: 'h', type: 'header' }, timestamp: 2 },
      { kind: 'COMPONENT_BUILDING', componentId: 'h', timestamp: 3 },
      { kind: 'COMPONENT_READY', componentId: 'h', timestamp: 4 },
      { kind: 'COMPONENT_CREATED', component: { id: 'rev', type: 'card' }, timestamp: 5 },
      { kind: 'COMPONENT_BUILDING', componentId: 'rev', timestamp: 6 }
    ]);
    const model = renderPreview(s);
    assert.equal(model.focusId, 'rev');
    assert.equal(buildFocus(s)?.id, model.focusId, 'buildFocus(state) = model.focusId (source unique)');
    const focused = model.flat.filter((n) => n.isBuildFocus);
    assert.equal(focused.length, 1, 'UN seul nœud focus dans le canvas ET l arbre');
    assert.equal(focused[0]!.id, model.focusId);
    assert.equal(model.lastCompletedId, 'h', 'le dernier stabilisé est dérivé (statut « ✓ h ready »)');
  });

  it('7. un composant terminé ne redémarre JAMAIS son animation (politique pure)', () => {
    assert.equal(shouldRefreshNode({ statusChanged: false, focusChanged: true, nextStatus: 'completed' }), false, 'focus seul + completed → PAS de re-rendu');
    assert.equal(shouldRefreshNode({ statusChanged: false, focusChanged: true, nextStatus: 'error' }), false, 'focus seul + error → pas de re-rendu');
    assert.equal(shouldRefreshNode({ statusChanged: false, focusChanged: true, nextStatus: 'building' }), true, 'focus seul + building → bannière ◉ ajoutée');
    assert.equal(shouldRefreshNode({ statusChanged: true, focusChanged: false, nextStatus: 'completed' }), true, 'transition de statut → révélation (une seule fois)');
  });

  it('8. aucun timer métier dans le HTML généré', () => {
    const types: Array<[{ id: string; type: string; label?: string; metadata?: Record<string, unknown> }, 'building' | 'completed']> = [
      [{ id: 'a', type: 'header', label: 'H' }, 'building'],
      [{ id: 'b', type: 'sidebar', label: 'S' }, 'building'],
      [{ id: 'c', type: 'hero', label: 'Hero' }, 'building'],
      [{ id: 'd', type: 'card', label: 'C' }, 'building'],
      [{ id: 'e', type: 'chart', label: 'G' }, 'building'],
      [{ id: 'f', type: 'footer', label: 'F' }, 'building'],
      [{ id: 'g', type: 'card', label: 'C', metadata: { html: REAL_HTML } }, 'completed']
    ];
    for (const [component, mode] of types) {
      const html = renderComponentVisual(component, mode);
      for (const forbidden of ['setTimeout', 'setInterval', 'addEventListener', 'javascript:']) {
        assert.ok(!html.includes(forbidden), `${forbidden} interdit dans le HTML des visuels`);
      }
    }
  });

  it('9. aucun state parallèle : les sélecteurs sont purs et dérivés du state', () => {
    let s = started();
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'c1', type: 'card' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'c1', timestamp: 3 });
    const before = s;
    const focus1 = buildFocus(s);
    const timeline1 = buildTimeline(s);
    const model1 = renderPreview(s);
    const focus2 = buildFocus(s);
    const timeline2 = buildTimeline(s);
    const model2 = renderPreview(s);
    assert.ok(s === before, 'le state n est pas muté par les sélecteurs');
    assert.deepEqual(timeline1, timeline2);
    assert.deepEqual(model1, model2);
    assert.equal(focus1?.id, focus2?.id);
  });

  it('10. reduced-motion : la page neutralise les animations (state → rendu conservé)', () => {
    // Les tests tournent depuis la racine du dépôt (scripts/run-tests.mjs)
    const page = readFileSync(join(process.cwd(), 'apps', 'studio', 'preview-builder.html'), 'utf8');
    assert.ok(page.includes('@media (prefers-reduced-motion: reduce)'), 'le media query existe');
    const reduced = page.slice(page.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.ok(reduced.includes('animation: none !important'), 'toutes les animations sont neutralisées sans casser le rendu');
  });

  it('11. DOM incrémental conservé : un nœud achevé n est réécrit à AUCUN moment', () => {
    // Séquence de vie d'un nœud : création(pending) → building → completed,
    // puis le build continue autour : après la révélation, plus AUCUN refresh.
    const refreshes: boolean[] = [];
    // '' = élément fraîchement créé (dataset.pvStatus vide), comme la page
    let prevStatus: string = '';
    let prevFocus = false;
    const steps: Array<{ status: 'pending' | 'building' | 'completed' | 'error'; focus: boolean }> = [
      { status: 'pending', focus: false },
      { status: 'building', focus: true },
      { status: 'completed', focus: true },
      { status: 'completed', focus: false }, // passage de témoin : classe seule
      { status: 'completed', focus: false }
    ];
    for (const step of steps) {
      const refresh = shouldRefreshNode({
        statusChanged: step.status !== prevStatus,
        focusChanged: step.focus !== prevFocus,
        nextStatus: step.status
      });
      refreshes.push(refresh);
      prevStatus = step.status;
      prevFocus = step.focus;
    }
    assert.deepEqual(refreshes, [true, true, true, false, false], 'exactement 3 écritures DOM, puis stabilité définitive');
  });

  it('12. plusieurs composants terminés restent VISIBLES dans le canvas', () => {
    let s = started();
    const ids = ['header', 'sidebar', 'hero'];
    let t = 2;
    for (const id of ids) {
      s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id, type: id }, timestamp: t++ });
      s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: id, timestamp: t++ });
      s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: id, timestamp: t++ });
    }
    const model = renderPreview(s);
    assert.equal(model.canvas.length, 3, 'les trois terminés coexistent');
    assert.ok(model.canvas.every((n) => n.status === 'completed' && n.canvasVisible));
    assert.equal(model.counts.completed, 3);
  });

  it('13. passage de témoin DÉTERMINISTE : même scénario → même séquence de focus', () => {
    const events: PreviewBuildEvent[] = [];
    let t = 1;
    events.push({ kind: 'BUILD_STARTED', timestamp: t++ });
    for (const id of ['c1', 'c2', 'c3']) {
      events.push({ kind: 'COMPONENT_CREATED', component: { id, type: 'card' }, timestamp: t++ });
      events.push({ kind: 'COMPONENT_BUILDING', componentId: id, timestamp: t++ });
      events.push({ kind: 'COMPONENT_READY', componentId: id, timestamp: t++ });
    }
    events.push({ kind: 'BUILD_COMPLETED', timestamp: t });

    const focusSequence = (): Array<string | undefined> => {
      let s = createPreviewBuildState();
      return events.map((e) => {
        s = applyBuildEvent(s, e);
        return buildFocus(s)?.id;
      });
    };
    assert.deepEqual(focusSequence(), focusSequence(), 'replay identique');
    const sequence = focusSequence();
    // Transitions de témoin : on compresse les « trous » (aucun focus entre
    // deux composants) — la séquence utile reste c1 → c2 → c3 → pose finale.
    const handoffs = sequence.filter((id, i) => id !== undefined && id !== sequence[i - 1]);
    assert.deepEqual(handoffs, ['c1', 'c2', 'c3'], 'le témoin passe de c1 à c2 à c3');
    assert.equal(sequence[sequence.length - 1], undefined, 'à la fin, plus aucun focus (build posé)');
  });

  it('14. génération complète (vocabulaire réel + bruit hostile) → PREVIEW READY', () => {
    const events: PreviewBuildEvent[] = [];
    let accepted = 0;
    for (const frame of demoSseChunks()) {
      const result = consumeSseFrame(frame, (e) => { events.push(e); accepted += 1; });
      assert.equal(result.rejected, 0, 'aucune frame valide rejetée');
    }
    assert.ok(accepted > 0, 'le flux a produit des événements');
    const finalState = applyBuildEvents(createPreviewBuildState(), events);
    assert.equal(finalState.status, 'completed');
    const model = renderPreview(finalState);
    assert.equal(model.statusLabel, 'PREVIEW READY');
    assert.ok(model.counts.total > 0 && model.counts.completed === model.counts.total, 'tous les composants sont stabilisés');
    // Données réelles : chaque section terminée a reçu son HTML (section_end)
    for (const node of model.flat) {
      assert.ok(node.metadata && typeof node.metadata.html === 'string' && node.metadata.html.length > 0, `${node.id} porte son contenu réel`);
    }
  });
});
