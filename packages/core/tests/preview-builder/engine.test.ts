/**
 * PREVIEW BUILDER — tests du moteur de construction progressive.
 * Garanties : lifecycle complet, règles de visibilité (pending caché /
 * building affiché / completed affiché), immutabilité de l'état, tolérance
 * aux événements hors cycle, replay déterministe, scénario mocké complet.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBuildEvent,
  applyBuildEvents,
  createPreviewBuildState,
  pendingComponents,
  visibleComponents
} from '../../src/preview-builder/engine.js';
import { demoBuildScript, scriptToEvents } from '../../src/preview-builder/mocks.js';

describe('Preview Builder : moteur de construction progressive', () => {
  it('1. idle → building → completed : le cycle nominal', () => {
    let s = createPreviewBuildState();
    assert.equal(s.status, 'idle');
    assert.equal(s.stage, 'idle');

    s = applyBuildEvent(s, { kind: 'BUILD_STARTED', stage: 'structure', timestamp: 1 });
    assert.equal(s.status, 'building');
    assert.equal(s.stage, 'structure');
    assert.equal(s.startedAt, 1);

    s = applyBuildEvent(s, { kind: 'STAGE_ENTERED', stage: 'components', timestamp: 2 });
    assert.equal(s.stage, 'components');

    s = applyBuildEvent(s, {
      kind: 'COMPONENT_CREATED',
      component: { id: 'c1', type: 'card', label: 'Carte 1' },
      timestamp: 3
    });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'c1', timestamp: 4 });
    const building = visibleComponents(s);
    assert.equal(building.length, 1);
    assert.equal(building[0]!.status, 'building');

    s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: 'c1', timestamp: 5 });
    s = applyBuildEvent(s, { kind: 'BUILD_COMPLETED', timestamp: 6 });
    assert.equal(s.status, 'completed');
    assert.equal(s.stage, 'completed');
    assert.equal(s.completedAt, 6);
    assert.equal(visibleComponents(s)[0]!.status, 'completed');
  });

  it('2. visibilité : pending caché, building affiché, completed affiché', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'a', type: 'card' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'b', type: 'card' }, timestamp: 3 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'c', type: 'card' }, timestamp: 4 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'b', timestamp: 5 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: 'c', timestamp: 6 });

    assert.deepEqual(pendingComponents(s).map((c) => c.id), ['a']);
    assert.deepEqual(visibleComponents(s).map((c) => c.id), ['b', 'c']);
  });

  it('3. ids inconnus et événements hors cycle sont IGNORÉS, jamais fatalistes', () => {
    let s = createPreviewBuildState();
    // Hors cycle : aucun composant ne peut être créé sans BUILD_STARTED
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'x', type: 'card' }, timestamp: 1 });
    assert.equal(s.components.size, 0);
    s = applyBuildEvent(s, { kind: 'COMPONENT_BUILDING', componentId: 'inconnu', timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'STYLE_APPLIED', componentId: 'inconnu', timestamp: 3 });
    s = applyBuildEvent(s, { kind: 'BUILD_COMPLETED', timestamp: 4 });
    assert.equal(s.status, 'idle');
    assert.equal(s.ignoredCount, 4);
    // Mais le journal conserve TOUT (traçabilité)
    assert.equal(s.events.length, 4);

    // Id inconnu pendant le build : ignoré sans casser
    s = applyBuildEvent(s, { kind: 'BUILD_STARTED', timestamp: 5 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_READY', componentId: 'fantome', timestamp: 6 });
    assert.equal(s.components.size, 0);
    assert.equal(s.status, 'building');
  });

  it('4. BUILD_FAILED → état error avec message, stage error', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = applyBuildEvent(s, { kind: 'BUILD_FAILED', error: 'Génération interrompue', timestamp: 2 });
    assert.equal(s.status, 'error');
    assert.equal(s.stage, 'error');
    assert.equal(s.error, 'Génération interrompue');
  });

  it('5. BUILD_STARTED réinitialise les composants (nouvelle construction)', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'old', type: 'card' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'BUILD_COMPLETED', timestamp: 3 });
    s = applyBuildEvent(s, { kind: 'BUILD_STARTED', timestamp: 4 });
    assert.equal(s.components.size, 0);
    assert.equal(s.status, 'building');
    assert.equal(s.completedAt, undefined);
  });

  it('6. immutabilité : l’état précédent n’est jamais muté', () => {
    const s0 = createPreviewBuildState();
    const s1 = applyBuildEvent(s0, { kind: 'BUILD_STARTED', timestamp: 1 });
    const s2 = applyBuildEvent(s1, { kind: 'COMPONENT_CREATED', component: { id: 'c', type: 'card' }, timestamp: 2 });

    assert.equal(s0.status, 'idle');
    assert.equal(s1.components.size, 0);
    assert.equal(s2.components.size, 1);
    assert.equal(s1.events.length, 1);
    assert.equal(s0.events.length, 0);
  });

  it('7. STYLE_APPLIED : marque le composant et peut faire avancer le stage', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'c', type: 'card' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'STYLE_APPLIED', componentId: 'c', stage: 'styling', timestamp: 3 });
    assert.equal(s.components.get('c')!.metadata?.styleApplied, true);
    assert.equal(s.stage, 'styling');
  });

  it('8. SECTION_COMPLETED : la section est marquée terminée', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = applyBuildEvent(s, { kind: 'SECTION_COMPLETED', sectionId: 'sec-main', timestamp: 2 });
    assert.ok(s.completedSections.has('sec-main'));
  });

  it('9. BUILD_RESET : retour à idle complet', () => {
    let s = applyBuildEvent(createPreviewBuildState(), { kind: 'BUILD_STARTED', timestamp: 1 });
    s = applyBuildEvent(s, { kind: 'COMPONENT_CREATED', component: { id: 'c', type: 'card' }, timestamp: 2 });
    s = applyBuildEvent(s, { kind: 'BUILD_RESET', timestamp: 3 });
    assert.equal(s.status, 'idle');
    assert.equal(s.components.size, 0);
    assert.equal(s.events.length, 0);
  });

  it('10. replay déterministe : la même séquence produit le même état', () => {
    const events = scriptToEvents(demoBuildScript(), 1000);
    const a = applyBuildEvents(createPreviewBuildState(), events);
    const b = applyBuildEvents(createPreviewBuildState(), events);
    assert.deepEqual([...a.components.keys()], [...b.components.keys()]);
    assert.equal(a.status, b.status);
    assert.equal(a.stage, b.stage);
    assert.equal(visibleComponents(a).length, visibleComponents(b).length);
  });
});

describe('Preview Builder : scénario de démonstration mocké', () => {
  it('11. le scénario démo se termine completed avec tous les composants prêts', () => {
    const events = scriptToEvents(demoBuildScript(), 1);
    const final = applyBuildEvents(createPreviewBuildState(), events);
    assert.equal(final.status, 'completed');
    const visible = visibleComponents(final);
    assert.equal(visible.length, 6, 'header + sidebar + content + 2 cards + chart');
    assert.ok(visible.every((c) => c.status === 'completed'));
    assert.equal(final.completedSections.has('comp-content'), true);
  });

  it('12. pendant le scénario, les composants apparaissent PROGRESSIVEMENT', () => {
    const events = scriptToEvents(demoBuildScript(), 1);
    let s = createPreviewBuildState();
    const atCreation: number[] = [];
    const atBuilding: number[] = [];
    for (const e of events) {
      s = applyBuildEvent(s, e);
      // Un composant CREATED est pending → volontairement NON affiché ;
      // il devient visible dès COMPONENT_BUILDING : progression réelle.
      if (e.kind === 'COMPONENT_CREATED') atCreation.push(visibleComponents(s).length);
      if (e.kind === 'COMPONENT_BUILDING') atBuilding.push(visibleComponents(s).length);
    }
    assert.deepEqual(atCreation, [0, 1, 2, 3, 4, 5], 'créé = pending, pas encore affiché');
    assert.deepEqual(atBuilding, [1, 2, 3, 4, 5, 6], 'building = affiché, un par un');
  });
});
