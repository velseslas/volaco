/**
 * ÉTAPE 23 — ÉDITION DES IMAGES RÉELLES IA : updateImageSource.
 *
 * Les 19 cas du brief. La cible est une balise <img> localisée par un chemin
 * d'éléments dans metadata.html ; SEUL l'attribut src change — tous les
 * autres attributs et le reste du HTML sont intacts. La valeur src est une
 * VALEUR D'ATTRIBUT échappée — jamais interprétée comme HTML.
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
  updateImageSource,
  updateComponentLabel,
  updateComponentVariant,
  resizeComponent,
  moveComponent,
  updateTextContent
} from '../../src/preview-builder/editing.js';
import { renderPreview, buildInspector } from '../../src/preview-builder/renderer.js';

const HTML = '<div class="galerie"><img src="a.png" alt="A" width="100"><img src="b.png" class="thumb"></div><p>Légende</p>';
// Chemins : div=[0] → img1=[0,0], img2=[0,1] ; p=[1]

function scenario(): PreviewBuildState {
  const events: PreviewBuildEvent[] = [
    { kind: 'BUILD_STARTED', stage: 'content', timestamp: 1 },
    { kind: 'COMPONENT_CREATED', component: { id: 'galerie', type: 'hero', label: 'Galerie', metadata: { html: HTML } }, timestamp: 2 },
    { kind: 'COMPONENT_READY', componentId: 'galerie', timestamp: 3 },
    { kind: 'COMPONENT_CREATED', component: { id: 'footer', type: 'footer', label: 'Pied' }, timestamp: 4 }
  ];
  return applyBuildEvents(createPreviewBuildState(), events);
}

describe('ÉTAPE 23 : updateImageSource', () => {
  it('1. image valide : src remplacé, appliqué', () => {
    const s = scenario();
    const result = updateImageSource(s, 'galerie', [0, 0], 'nouvelle.png');
    assert.equal(result.applied, true);
    const html = String(result.state.components.get('galerie')!.metadata!.html);
    assert.ok(html.includes('src="nouvelle.png"'), 'nouveau src présent');
  });

  it('2. plusieurs images : seule la cible change', () => {
    const s = scenario();
    const result = updateImageSource(s, 'galerie', [0, 1], 'c.png');
    const html = String(result.state.components.get('galerie')!.metadata!.html);
    assert.ok(html.includes('src="c.png"'), 'img2 modifiée');
    assert.ok(html.includes('src="a.png"'), 'img1 intacte');
  });

  it('3. chemin valide profond ([0,0] dans le conteneur)', () => {
    const s = scenario();
    const result = updateImageSource(s, 'galerie', [0, 0], 'x.png');
    assert.equal(result.applied, true);
  });

  it('4. chemin invalide → invalid-path, même référence', () => {
    const s = scenario();
    for (const path of [[9], [0, 9], [], [-1]]) {
      const result = updateImageSource(s, 'galerie', path as number[], 'x.png');
      assert.equal(result.reason, 'invalid-path');
      assert.equal(result.applied, false);
      assert.equal(result.state, s);
    }
  });

  it('5. composant inexistant → unknown-component', () => {
    const s = scenario();
    const result = updateImageSource(s, 'fantome', [0, 0], 'x.png');
    assert.equal(result.reason, 'unknown-component');
    assert.equal(result.state, s);
  });

  it('6. absence de HTML → missing-content', () => {
    const s = scenario();
    const result = updateImageSource(s, 'footer', [0], 'x.png');
    assert.equal(result.reason, 'missing-content');
    assert.equal(result.state, s);
  });

  it('7. cible non-image (div, p) → not-image', () => {
    const s = scenario();
    assert.equal(updateImageSource(s, 'galerie', [0], 'x.png').reason, 'not-image');
    assert.equal(updateImageSource(s, 'galerie', [1], 'x.png').reason, 'not-image');
  });

  it('8. src vide (même espaces) → empty-src', () => {
    const s = scenario();
    for (const vide of ['', '   ']) {
      const result = updateImageSource(s, 'galerie', [0, 0], vide);
      assert.equal(result.reason, 'empty-src');
      assert.equal(result.applied, false);
    }
  });

  it('9. src inchangé → unchanged (même référence)', () => {
    const s = scenario();
    const result = updateImageSource(s, 'galerie', [0, 0], 'a.png');
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'unchanged');
    assert.equal(result.state, s);
  });

  it('10. immutabilité : l ancien state et son HTML intacts', () => {
    const s = scenario();
    const htmlAvant = String(s.components.get('galerie')!.metadata!.html);
    updateImageSource(s, 'galerie', [0, 0], 'nouvelle.png');
    assert.equal(String(s.components.get('galerie')!.metadata!.html), htmlAvant);
  });

  it('11. autres composants inchangés par référence', () => {
    const s = scenario();
    const footerAvant = s.components.get('footer');
    const result = updateImageSource(s, 'galerie', [0, 0], 'nouvelle.png');
    assert.ok(footerAvant && result.state.components.get('footer') === footerAvant);
  });

  it('12. HTML hors de l image inchangé (paragraphe intact)', () => {
    const s = scenario();
    const html = String(updateImageSource(s, 'galerie', [0, 0], 'nouvelle.png').state.components.get('galerie')!.metadata!.html);
    assert.ok(html.includes('<p>Légende</p>'), 'le paragraphe est intact');
  });

  it('13. autres attributs conservés (alt, width, class)', () => {
    const s = scenario();
    const html = String(updateImageSource(s, 'galerie', [0, 0], 'nouvelle.png').state.components.get('galerie')!.metadata!.html);
    assert.ok(html.includes('alt="A"'), 'alt conservé');
    assert.ok(html.includes('width="100"'), 'width conservé');
    const html2 = String(updateImageSource(s, 'galerie', [0, 1], 'd.png').state.components.get('galerie')!.metadata!.html);
    assert.ok(html2.includes('class="thumb"'), 'class conservée');
  });

  it('14. data-pv-id conservé (id inchangé)', () => {
    const s = scenario();
    const result = updateImageSource(s, 'galerie', [0, 0], 'nouvelle.png');
    assert.equal(result.state.components.get('galerie')!.id, 'galerie');
  });

  it('15. label É16, variant É17, size É21, parent É18, order conservés', () => {
    let s = updateComponentLabel(scenario(), 'galerie', 'Ma Galerie').state;
    s = updateComponentVariant(s, 'galerie', 'featured').state;
    s = resizeComponent(s, 'galerie', 500, 250).state;
    s = moveComponent(s, 'galerie', 'footer', 0).state;
    const avant = s.components.get('galerie')!;
    const après = updateImageSource(s, 'galerie', [0, 0], 'nouvelle.png').state.components.get('galerie')!;
    assert.equal(après.label, 'Ma Galerie');
    assert.equal(après.variant, 'featured');
    assert.deepEqual(après.size, avant.size);
    assert.equal(après.parentId, 'footer');
    assert.equal(après.order, avant.order);
  });

  it('16. caractères spéciaux du src échappés (attribut)', () => {
    const s = scenario();
    const result = updateImageSource(s, 'galerie', [0, 0], 'im & ages/photo "speciale" <1>.png');
    const html = String(result.state.components.get('galerie')!.metadata!.html);
    assert.ok(html.includes('src="im &amp; ages/photo &quot;speciale&quot; &lt;1&gt;.png"'), 'src échappé en attribut');
    assert.ok(!/<img src="im & /.test(html), 'jamais de quote non échappée');
  });

  it('17. tentative d injection (" ><script>) traitée comme VALEUR d attribut', () => {
    const s = scenario();
    const result = updateImageSource(s, 'galerie', [0, 0], 'x"><script>alert(1)</script>');
    const html = String(result.state.components.get('galerie')!.metadata!.html);
    assert.ok(!html.includes('<script>'), 'aucun script réel injecté');
    assert.ok(html.includes('&quot;&gt;&lt;script&gt;'), 'la valeur reste dans l attribut, échappée');
    assert.ok(html.includes('alt="A"'), 'la structure de l img tient toujours');
  });

  it('18. intégration : inspector expose le nouveau src ; img sans src → ajouté', () => {
    let s = updateImageSource(scenario(), 'galerie', [0, 0], 'nouvelle.png').state;
    const inspector = buildInspector(s, 'galerie');
    assert.ok(String(inspector!.metadata!.html).includes('src="nouvelle.png"'));
    // img SANS attribut src → le src est AJOUTÉ
    let s2 = applyBuildEvents(createPreviewBuildState(), [
      { kind: 'BUILD_STARTED', stage: 'content', timestamp: 1 },
      { kind: 'COMPONENT_CREATED', component: { id: 'g', type: 'hero', metadata: { html: '<div><img alt="sans src"></div>' } }, timestamp: 2 }
    ]);
    const added = updateImageSource(s2, 'g', [0, 0], 'ajoutee.png');
    assert.equal(added.applied, true);
    assert.ok(String(added.state.components.get('g')!.metadata!.html).includes('src="ajoutee.png"'));
    assert.ok(String(added.state.components.get('g')!.metadata!.html).includes('alt="sans src"'));
  });

  it('19. RESET et nouvelle génération sans fuite', () => {
    let s = updateImageSource(scenario(), 'galerie', [0, 0], 'nouvelle.png').state;
    s = applyBuildEvents(s, [{ kind: 'BUILD_STARTED', stage: 'structure', timestamp: 100 }]);
    assert.equal(s.components.size, 0);
    const fresh = applyBuildEvents(s, [
      { kind: 'COMPONENT_CREATED', component: { id: 'galerie', type: 'hero', metadata: { html: '<div><img src="a.png"></div>' } }, timestamp: 101 }
    ]);
    assert.ok(String(fresh.components.get('galerie')!.metadata!.html).includes('src="a.png"'));
    assert.ok(!String(fresh.components.get('galerie')!.metadata!.html).includes('nouvelle.png'), 'aucune fuite');
  });

  it('20. texte É22 et variant/size toujours fonctionnels avec updateImageSource', () => {
    let s = updateTextContent(scenario(), 'galerie', [1], 'Nouvelle légende').state;
    s = updateImageSource(s, 'galerie', [0, 0], 'n.png').state;
    const html = String(s.components.get('galerie')!.metadata!.html);
    assert.ok(html.includes('Nouvelle légende'), 'le texte É22 est conservé');
    assert.ok(html.includes('src="n.png"'), 'l image É23 appliquée');
    s = updateComponentVariant(s, 'galerie', 'compact').state;
    s = resizeComponent(s, 'galerie', 400, 200).state;
    const c = s.components.get('galerie')!;
    assert.equal(c.variant, 'compact');
    assert.deepEqual(c.size, { width: 400, height: 200 });
  });
});
