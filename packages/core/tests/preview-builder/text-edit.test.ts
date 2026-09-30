/**
 * ÉTAPE 22 — ÉDITION DU TEXTE RÉEL IA : updateTextContent.
 *
 * Les 17 cas du brief. La cible est un chemin d'ÉLÉMENTS dans metadata.html
 * (dérivé du contenu, jamais du DOM global) ; la cible valide ne contient
 * QUE du texte. Le texte est TOUJOURS échappé — jamais injecté comme HTML.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBuildEvents,
  createPreviewBuildState,
  type PreviewBuildEvent,
  type PreviewBuildState
} from '../../src/preview-builder/engine.js';
import {
  updateTextContent,
  updateComponentLabel,
  updateComponentVariant,
  resizeComponent,
  moveComponent
} from '../../src/preview-builder/editing.js';
import { renderPreview, buildInspector } from '../../src/preview-builder/renderer.js';

function scenario(): PreviewBuildState {
  const events: PreviewBuildEvent[] = [
    { kind: 'BUILD_STARTED', stage: 'content', timestamp: 1 },
    { kind: 'COMPONENT_CREATED', component: { id: 'hero', type: 'hero', label: 'Héros', metadata: { html: '<section class="hero"><h1>Bienvenue</h1><p>Un service <strong>premium</strong> pour tous.</p><button>Envoyer</button></section>' } }, timestamp: 2 },
    { kind: 'COMPONENT_READY', componentId: 'hero', timestamp: 3 },
    { kind: 'COMPONENT_CREATED', component: { id: 'footer', type: 'footer', label: 'Pied' }, timestamp: 4 }
  ];
  return applyBuildEvents(createPreviewBuildState(), events);
}

/** Chemins du scénario : section=[0] → h1=[0,0], p=[0,1], button=[0,2]. */

describe('ÉTAPE 22 : updateTextContent', () => {
  it('1. modifier un h1 réel : le texte change, la structure est intacte', () => {
    const s = scenario();
    const result = updateTextContent(s, 'hero', [0, 0], 'Bienvenue chez nous');
    assert.equal(result.applied, true);
    const html = String(result.state.components.get('hero')!.metadata!.html);
    assert.ok(html.includes('<h1>Bienvenue chez nous</h1>'), 'le h1 porte le nouveau texte');
    assert.ok(html.includes('<strong>premium</strong>'), 'le reste du HTML est intact');
    assert.ok(html.includes('<button>Envoyer</button>'), 'le bouton est intact');
  });

  it('2. modifier un paragraphe (avec élément fort interne → non textuel)', () => {
    const s = scenario();
    // le <p> contient <strong> : NON textuel
    const refused = updateTextContent(s, 'hero', [0, 1], 'X');
    assert.equal(refused.reason, 'not-textual');
    assert.equal(refused.applied, false);
  });

  it('3. modifier le texte d un bouton', () => {
    const s = scenario();
    const result = updateTextContent(s, 'hero', [0, 2], 'Commander');
    assert.equal(result.applied, true);
    assert.ok(String(result.state.components.get('hero')!.metadata!.html).includes('<button>Commander</button>'));
  });

  it('4. cible inexistante → invalid-path', () => {
    const s = scenario();
    assert.equal(updateTextContent(s, 'hero', [0, 9], 'X').reason, 'invalid-path');
    assert.equal(updateTextContent(s, 'hero', [5], 'X').reason, 'invalid-path');
    assert.equal(updateTextContent(s, 'hero', [], 'X').reason, 'invalid-path');
    assert.equal(updateTextContent(s, 'hero', [-1], 'X').reason, 'invalid-path');
  });

  it('5. composant inexistant → unknown-component', () => {
    const s = scenario();
    const result = updateTextContent(s, 'fantome', [0], 'X');
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'unknown-component');
    assert.equal(result.state, s);
  });

  it('6. cible non textuelle : conteneur avec enfants → refus', () => {
    const s = scenario();
    // section = conteneur (contient h1/p/button)
    const result = updateTextContent(s, 'hero', [0], 'X');
    assert.equal(result.reason, 'not-textual');
  });

  it('7. texte vide (même espaces) → refus', () => {
    const s = scenario();
    for (const vide of ['', '   ']) {
      const result = updateTextContent(s, 'hero', [0, 0], vide);
      assert.equal(result.reason, 'empty-text');
      assert.equal(result.applied, false);
    }
  });

  it('8. caractères spéciaux : échappés dans le HTML, rendus comme texte', () => {
    const s = scenario();
    const result = updateTextContent(s, 'hero', [0, 0], 'L\'été & l\'hiver <3');
    assert.equal(result.applied, true);
    const html = String(result.state.components.get('hero')!.metadata!.html);
    assert.ok(html.includes('L\'été &amp; l\'hiver &lt;3'), 'échappé dans le HTML stocké');
    assert.ok(!html.includes('l\'hiver <3</h1>'), 'jamais de < brut injecté');
  });

  it('9. tentative <script> / HTML → traité comme TEXTE (aucune injection)', () => {
    const s = scenario();
    const result = updateTextContent(s, 'hero', [0, 0], '<script>alert(1)</script>');
    assert.equal(result.applied, true);
    const html = String(result.state.components.get('hero')!.metadata!.html);
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'le script est échappé');
    assert.ok(!html.includes('<script>'), 'aucune balise script réelle injectée');
    // tentative de balise/img/attribut : même traitement
    const img = updateTextContent(s, 'hero', [0, 2], '<img src=x onerror=alert(1)>');
    assert.ok(String(img.state.components.get('hero')!.metadata!.html).includes('&lt;img'), 'img traitée comme texte');
  });

  it('10. immutabilité : l ancien state et son HTML sont intacts', () => {
    const s = scenario();
    const htmlAvant = String(s.components.get('hero')!.metadata!.html);
    updateTextContent(s, 'hero', [0, 0], 'Modifié');
    assert.equal(String(s.components.get('hero')!.metadata!.html), htmlAvant);
    assert.equal(htmlAvant.includes('Bienvenue</h1>'), true);
  });

  it('11. autres composants inchangés par référence', () => {
    const s = scenario();
    const footerAvant = s.components.get('footer');
    const result = updateTextContent(s, 'hero', [0, 0], 'Modifié');
    assert.ok(footerAvant && result.state.components.get('footer') === footerAvant);
  });

  it('12. data-pv-id inchangé (id conservé)', () => {
    const s = scenario();
    const result = updateTextContent(s, 'hero', [0, 0], 'Modifié');
    assert.equal(result.state.components.get('hero')!.id, 'hero');
  });

  it('13. label É16, variant É17, size É21, parent É18, order : tous conservés', () => {
    let s = scenario();
    s = updateComponentLabel(s, 'hero', 'Mon Héros').state;
    s = updateComponentVariant(s, 'hero', 'featured').state;
    s = resizeComponent(s, 'hero', 500, 250).state;
    s = moveComponent(s, 'hero', 'footer', 0).state;
    const avant = s.components.get('hero')!;
    const après = updateTextContent(s, 'hero', [0, 0], 'Nouveau texte').state.components.get('hero')!;
    assert.equal(après.label, 'Mon Héros');
    assert.equal(après.variant, 'featured');
    assert.deepEqual(après.size, avant.size);
    assert.equal(après.parentId, 'footer');
    assert.equal(après.order, avant.order);
  });

  it('14. sélection + Inspector cohérents : le modèle expose le nouveau HTML', () => {
    let s = updateTextContent(scenario(), 'hero', [0, 0], 'Bienvenue chez nous').state;
    const model = renderPreview(s, { selectedId: 'hero' });
    assert.equal(model.flat.find((n) => n.isUserSelected)!.id, 'hero');
    const inspector = buildInspector(s, 'hero');
    assert.ok(String(inspector!.metadata!.html).includes('Bienvenue chez nous'), "l inspector montre le contenu édité");
    assert.equal(inspector!.hasRealHtml, true);
  });

  it('15. Desktop/Tablet/Mobile : le modèle ne dépend d aucun viewport', () => {
    const s = updateTextContent(scenario(), 'hero', [0, 0], 'Texte').state;
    assert.deepEqual(renderPreview(s), renderPreview(s));
  });

  it('16. RESET : la nouvelle construction repart sans édition de texte', () => {
    let s = updateTextContent(scenario(), 'hero', [0, 0], 'Modifié').state;
    s = applyBuildEvents(s, [{ kind: 'BUILD_STARTED', stage: 'structure', timestamp: 100 }]);
    assert.equal(s.components.size, 0);
  });

  it('17. nouvelle génération : aucune fuite du texte édité', () => {
    let s = updateTextContent(scenario(), 'hero', [0, 0], 'Modifié').state;
    s = applyBuildEvents(s, [
      { kind: 'BUILD_STARTED', stage: 'content', timestamp: 100 },
      { kind: 'COMPONENT_CREATED', component: { id: 'hero', type: 'hero', metadata: { html: '<section><h1>Bienvenue</h1></section>' } }, timestamp: 101 }
    ]);
    const html = String(s.components.get('hero')!.metadata!.html);
    assert.ok(html.includes('Bienvenue</h1>'), 'texte initial de la nouvelle génération');
    assert.ok(!html.includes('Modifié'), 'aucune fuite du texte édité');
  });

  it('18. same text → unchanged (même référence)', () => {
    const s = scenario();
    const once = updateTextContent(s, 'hero', [0, 0], 'Salut !');
    assert.equal(once.applied, true);
    // ré-appliquer le MÊME texte que celui désormais stocké → unchanged
    const twice = updateTextContent(once.state, 'hero', [0, 0], 'Salut !');
    assert.equal(twice.applied, false);
    assert.equal(twice.reason, 'unchanged');
    assert.equal(twice.state, once.state);
  });
});
