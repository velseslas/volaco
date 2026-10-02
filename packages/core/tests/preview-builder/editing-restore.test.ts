/**
 * E42 — restoreComponentHtml : la commande pure d'annulation.
 *
 * L'undo du Builder restitue le HTML ANTÉRIEUR d'un composant (état réel
 * précédemment appliqué, jamais une entrée utilisateur) puis le serveur
 * resynchronise (persistSection). Contrat des commandes pures : immuable,
 * refus explicites, autres composants intacts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBuildEvents,
  createPreviewBuildState,
  type PreviewBuildEvent,
  type PreviewBuildState
} from '../../src/preview-builder/engine.js';
import { restoreComponentHtml, updateTextContent } from '../../src/preview-builder/editing.js';

function scenario(): PreviewBuildState {
  const events: PreviewBuildEvent[] = [
    { kind: 'BUILD_STARTED', stage: 'content', timestamp: 1 },
    { kind: 'COMPONENT_CREATED', component: { id: 'hero', type: 'hero', label: 'Hero', metadata: { html: '<section><h1>Original</h1></section>' } }, timestamp: 2 },
    { kind: 'COMPONENT_READY', componentId: 'hero', timestamp: 3 },
    { kind: 'COMPONENT_CREATED', component: { id: 'footer', type: 'footer', label: 'Footer', metadata: { html: '<footer>Bas</footer>' } }, timestamp: 4 },
    { kind: 'COMPONENT_READY', componentId: 'footer', timestamp: 5 }
  ];
  return applyBuildEvents(createPreviewBuildState(), events);
}

describe('E42 : restoreComponentHtml (undo)', () => {
  it('1. restitue le HTML antérieur après une édition, via le même canal pur', () => {
    const s0 = scenario();
    const edited = updateTextContent(s0, 'hero', [0, 0], 'Modifié par IA');
    assert.equal(edited.applied, true);

    const restored = restoreComponentHtml(edited.state, 'hero', '<section><h1>Original</h1></section>');
    assert.equal(restored.applied, true);
    assert.equal(restored.state.components.get('hero')?.metadata?.html, '<section><h1>Original</h1></section>');
    // immuabilité : les états intermédiaires ne sont pas mutés
    assert.ok(String(edited.state.components.get('hero')?.metadata?.html).includes('Modifié'));
    assert.ok(String(s0.components.get('hero')?.metadata?.html).includes('Original'));
  });

  it('2. les autres composants gardent leurs références', () => {
    const s0 = scenario();
    const restored = restoreComponentHtml(s0, 'hero', '<section><h1>Autre</h1></section>');
    assert.equal(restored.applied, true);
    assert.equal(restored.state.components.get('footer'), s0.components.get('footer'));
  });

  it('3. HTML identique → unchanged (même référence de state)', () => {
    const s0 = scenario();
    const result = restoreComponentHtml(s0, 'hero', '<section><h1>Original</h1></section>');
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'unchanged');
    assert.equal(result.state, s0);
  });

  it('4. refus : composant inconnu, contenu manquant', () => {
    const s0 = scenario();
    assert.equal(restoreComponentHtml(s0, 'inconnu', '<p>x</p>').reason, 'unknown-component');
    assert.equal(restoreComponentHtml(s0, 'hero', '   ').reason, 'missing-content');
    assert.equal(restoreComponentHtml(s0, 'hero', null as unknown as string).reason, 'missing-content');
  });

  it('5. chaîne complète édition → annulation → édition : l annulation ne verrouille rien', () => {
    let s = scenario();
    s = updateTextContent(s, 'hero', [0, 0], 'V1').state;
    const beforeUndo = s.components.get('hero')?.metadata?.html;
    s = restoreComponentHtml(s, 'hero', '<section><h1>Original</h1></section>').state;
    s = updateTextContent(s, 'hero', [0, 0], 'V2').state;
    assert.ok(String(s.components.get('hero')?.metadata?.html).includes('V2'));
    assert.notEqual(beforeUndo, String(s.components.get('hero')?.metadata?.html));
  });
});
