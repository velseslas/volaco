/**
 * ÉTAPE 36 — INVENTAIRE DES ÉLÉMENTS ÉDITABLES (inventoryEditableElements).
 *
 * L'inventaire alimente l'édition IA par composant : ses paths DOIVENT être
 * directement consommables par les commandes pures (mêmes conventions que le
 * parseur commun locateElement — index d'éléments uniquement). Chaque cas
 * vérifie donc l'inventaire ET son application réelle via les commandes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBuildEvents,
  createPreviewBuildState,
  type PreviewBuildEvent,
  type PreviewBuildState
} from '../../src/preview-builder/engine.js';
import { inventoryEditableElements, updateTextContent, updateImageSource, updateLinkHref } from '../../src/preview-builder/editing.js';

function scenario(html: string): PreviewBuildState {
  const events: PreviewBuildEvent[] = [
    { kind: 'BUILD_STARTED', stage: 'content', timestamp: 1 },
    { kind: 'COMPONENT_CREATED', component: { id: 'c1', type: 'hero', label: 'C1', metadata: { html } }, timestamp: 2 },
    { kind: 'COMPONENT_READY', componentId: 'c1', timestamp: 3 }
  ];
  return applyBuildEvents(createPreviewBuildState(), events);
}

describe('ÉTAPE 36 : inventoryEditableElements', () => {
  it('1. textes, image et liens d un header + hero : paths conformes aux commandes pures', () => {
    const html = '<header><span>Logo</span><nav><a href="#menu">Menu</a></nav></header>'
      + '<section><h1>Bienvenue</h1><img src="https://images.unsplash.com/photo-1" alt="salon"></section>';
    const inv = inventoryEditableElements(html);

    const texts = inv.filter((e) => e.kind === 'text');
    const links = inv.filter((e) => e.kind === 'link');
    const images = inv.filter((e) => e.kind === 'image');

    // textes attendus : span "Logo" [0,0], h1 "Bienvenue" [1,0] — le <a> n'est
    // PAS un texte (c'est un lien), le <nav> et la <section> sont conteneurs.
    assert.deepEqual(texts.map((t) => [t.path, t.value]), [
      [[0, 0], 'Logo'],
      [[1, 0], 'Bienvenue']
    ]);
    assert.deepEqual(links, [{ path: [0, 1, 0], kind: 'link', tag: 'a', value: '#menu' }]);
    assert.deepEqual(images, [{ path: [1, 1], kind: 'image', tag: 'img', value: 'https://images.unsplash.com/photo-1' }]);

    // Cohérence réelle : chaque path inventorié est applicable par commande pure.
    const s = scenario(html);
    const logo = texts[0]!;
    assert.equal(updateTextContent(s, 'c1', logo.path, 'Maison').applied, true);
    const link = links[0]!;
    assert.equal(updateLinkHref(s, 'c1', link.path, '#reserver').applied, true);
    const img = images[0]!;
    assert.equal(updateImageSource(s, 'c1', img.path, 'https://images.unsplash.com/photo-2').applied, true);
  });

  it('2. un paragraphe contenant <strong> n est PAS un texte, mais le strong l est', () => {
    const html = '<p>Un service <strong>premium</strong> pour tous.</p>';
    const inv = inventoryEditableElements(html);
    // le <p> a un enfant élément → conteneur ; le strong est textuel.
    assert.ok(!inv.some((e) => e.tag === 'p'), 'le paragraphe conteneur est exclu');
    const strong = inv.find((e) => e.tag === 'strong');
    assert.ok(strong);
    assert.equal(strong.value, 'premium');
    assert.equal(updateTextContent(scenario(html), 'c1', strong.path, 'exceptionnel').applied, true);
  });

  it('3. script, style, title et commentaires : jamais inventoriés', () => {
    const html = '<div><script>if (a < b) { console.log("x"); }</script><style>.x { color: red; }</style>'
      + '<!-- commentaire --><h2>Titre visible</h2></div>';
    const inv = inventoryEditableElements(html);
    assert.equal(inv.length, 1);
    assert.equal(inv[0]?.value, 'Titre visible');
  });

  it('4. entités HTML : affichées telles quelles, le path reste applicable', () => {
    const html = '<h1>Café &amp; Thé</h1>';
    const inv = inventoryEditableElements(html);
    assert.equal(inv[0]?.value, 'Café & Thé');
    assert.equal(updateTextContent(scenario(html), 'c1', inv[0]!.path, 'Thé & Café').applied, true);
  });

  it('5. texte multi-chunks (élément + texte après enfant) : non textuel', () => {
    const html = '<div>Avant <b>gras</b> après</div>';
    const inv = inventoryEditableElements(html);
    assert.deepEqual(inv.map((e) => e.tag), ['b']);
  });

  it('6. borne maxElements : l inventaire ne diverge jamais', () => {
    const html = '<div>' + Array.from({ length: 30 }, (_, i) => '<p>Texte ' + i + '</p>').join('') + '</div>';
    const inv = inventoryEditableElements(html, 10);
    assert.equal(inv.length, 10);
  });

  it('7. HTML vide ou sans éditable → inventaire vide', () => {
    assert.deepEqual(inventoryEditableElements(''), []);
    assert.deepEqual(inventoryEditableElements('<div><br><hr></div>'), []);
  });
});
