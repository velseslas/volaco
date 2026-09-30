/**
 * ÉTAPE 24 — ÉDITION DES LIENS RÉELS IA : updateLinkHref.
 *
 * Les 23 cas du brief. La cible est une balise <a> localisée par un chemin
 * d'éléments dans metadata.html ; SEUL l'attribut href change. Les schémas
 * dangereux (javascript:, vbscript:, data: — y compris variantes encodées,
 * entités et espacement) sont refusés avec 'unsafe-href'.
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
  updateLinkHref,
  updateTextContent,
  updateImageSource,
  updateComponentLabel,
  updateComponentVariant,
  resizeComponent,
  moveComponent
} from '../../src/preview-builder/editing.js';
import { buildInspector } from '../../src/preview-builder/renderer.js';

const HTML = '<nav><a href="/accueil" class="nav-link">Accueil</a><a href="#contact" target="_blank" rel="noopener">Contact</a></nav><p>Texte</p>';
// Chemins : nav=[0] → a1=[0,0], a2=[0,1] ; p=[1]

function scenario(): PreviewBuildState {
  const events: PreviewBuildEvent[] = [
    { kind: 'BUILD_STARTED', stage: 'content', timestamp: 1 },
    { kind: 'COMPONENT_CREATED', component: { id: 'header', type: 'header', label: 'En-tête', metadata: { html: HTML } }, timestamp: 2 },
    { kind: 'COMPONENT_READY', componentId: 'header', timestamp: 3 },
    { kind: 'COMPONENT_CREATED', component: { id: 'footer', type: 'footer', label: 'Pied' }, timestamp: 4 }
  ];
  return applyBuildEvents(createPreviewBuildState(), events);
}

const htmlOf = (s: PreviewBuildState, id: string) => String(s.components.get(id)!.metadata!.html);

describe('ÉTAPE 24 : updateLinkHref', () => {
  it('1. lien valide : href remplacé, appliqué', () => {
    const result = updateLinkHref(scenario(), 'header', [0, 0], 'https://exemple.fr/');
    assert.equal(result.applied, true);
    assert.ok(htmlOf(result.state, 'header').includes('href="https://exemple.fr/"'));
  });

  it('2. plusieurs liens indépendants dans le même composant', () => {
    const s = scenario();
    const r = updateLinkHref(s, 'header', [0, 1], 'https://contact.fr/');
    assert.ok(htmlOf(r.state, 'header').includes('href="https://contact.fr/"'), 'a2 modifié');
    assert.ok(htmlOf(r.state, 'header').includes('href="/accueil"'), 'a1 intact');
  });

  it('3. chemin valide profond', () => {
    const result = updateLinkHref(scenario(), 'header', [0, 1], '/x');
    assert.equal(result.applied, true);
  });

  it('4. chemin invalide → invalid-path, même référence', () => {
    const s = scenario();
    for (const path of [[9], [0, 9], [], [-1]]) {
      const result = updateLinkHref(s, 'header', path as number[], '/x');
      assert.equal(result.reason, 'invalid-path');
      assert.equal(result.state, s);
    }
  });

  it('5. composant inexistant → unknown-component', () => {
    const result = updateLinkHref(scenario(), 'fantome', [0, 0], '/x');
    assert.equal(result.reason, 'unknown-component');
  });

  it('6. absence de HTML → missing-content', () => {
    const result = updateLinkHref(scenario(), 'footer', [0], '/x');
    assert.equal(result.reason, 'missing-content');
  });

  it('7. cible non-link (nav, p) → not-link', () => {
    assert.equal(updateLinkHref(scenario(), 'header', [0], '/x').reason, 'not-link');
    assert.equal(updateLinkHref(scenario(), 'header', [1], '/x').reason, 'not-link');
  });

  it('8. href vide (même espaces) → empty-href', () => {
    for (const vide of ['', '   ']) {
      const result = updateLinkHref(scenario(), 'header', [0, 0], vide);
      assert.equal(result.reason, 'empty-href');
      assert.equal(result.applied, false);
    }
  });

  it('9. href inchangé → unchanged + MÊME référence', () => {
    const s = scenario();
    const result = updateLinkHref(s, 'header', [0, 0], '/accueil');
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'unchanged');
    assert.equal(result.state, s);
  });

  it('10. immutabilité : l ancien state intact', () => {
    const s = scenario();
    const avant = htmlOf(s, 'header');
    updateLinkHref(s, 'header', [0, 0], '/autre');
    assert.equal(htmlOf(s, 'header'), avant);
  });

  it('11. autres composants inchangés par référence', () => {
    const s = scenario();
    const footerAvant = s.components.get('footer');
    const result = updateLinkHref(s, 'header', [0, 0], '/autre');
    assert.ok(footerAvant && result.state.components.get('footer') === footerAvant);
    assert.equal(result.state.components.get('footer')!.metadata, footerAvant!.metadata);
  });

  it('12. autres attributs du <a> conservés (class, target, rel)', () => {
    const s = scenario();
    const r1 = htmlOf(updateLinkHref(s, 'header', [0, 0], '/nouveau').state, 'header');
    assert.ok(r1.includes('class="nav-link"'), 'class conservée');
    const r2 = htmlOf(updateLinkHref(s, 'header', [0, 1], '/nouveau').state, 'header');
    assert.ok(r2.includes('target="_blank"') && r2.includes('rel="noopener"'), 'target et rel conservés');
  });

  it('13. HTML hors du lien strictement conservé', () => {
    const html = htmlOf(updateLinkHref(scenario(), 'header', [0, 0], '/nouveau').state, 'header');
    assert.ok(html.includes('<p>Texte</p>'));
    assert.ok(html.includes('href="#contact"'));
    assert.ok(html.includes('>Accueil</a>'), 'le texte du lien est intact');
  });

  it('14. data-pv-id conservé (id inchangé)', () => {
    const result = updateLinkHref(scenario(), 'header', [0, 0], '/nouveau');
    assert.equal(result.state.components.get('header')!.id, 'header');
  });

  it('15. label/variant/size/parent/order conservés', () => {
    let s = updateComponentLabel(scenario(), 'header', 'Mon Header').state;
    s = updateComponentVariant(s, 'header', 'compact').state;
    s = resizeComponent(s, 'header', 500, 250).state;
    s = moveComponent(s, 'header', 'footer', 0).state;
    const avant = s.components.get('header')!;
    const après = updateLinkHref(s, 'header', [0, 0], '/nouveau').state.components.get('header')!;
    assert.equal(après.label, 'Mon Header');
    assert.equal(après.variant, 'compact');
    assert.deepEqual(après.size, avant.size);
    assert.equal(après.parentId, 'footer');
    assert.equal(après.order, avant.order);
    assert.equal(après.status, avant.status);
    assert.equal(après.stage, avant.stage);
  });

  it('16. http://, https://, chemins relatifs et #anchor acceptés', () => {
    for (const href of ['http://exemple.fr', 'https://exemple.fr/a?b=1', 'chemin/relatif', '/absolu', '#section', 'mailto:contact@x.fr']) {
      const result = updateLinkHref(scenario(), 'header', [0, 0], href);
      assert.equal(result.applied, true, `accepté: ${href}`);
    }
  });

  it('17. javascript: refusé (unsafe-href)', () => {
    for (const href of ['javascript:alert(1)', 'JavaScript:alert(1)', '  javascript:x  ']) {
      const result = updateLinkHref(scenario(), 'header', [0, 0], href);
      assert.equal(result.applied, false);
      assert.equal(result.reason, 'unsafe-href');
    }
  });

  it('18. variantes encodées/espacées refusées', () => {
    const hostile = [
      'java\tscript:alert(1)',        // tabulation dans le schéma
      'java script:alert(1)',          // espace dans le schéma
      'jav%61script:alert(1)',         // %xx
      '%6A%61%76%61%73%63%72%69%70%74:alert(1)', // tout encodé
      '&#106;avascript:alert(1)',      // entité décimale
      '&#x6A;avascript:alert(1)',      // entité hexadécimale
      '\njavascript:alert(1)',         // saut de ligne
      'vbscript:msgbox(1)',            // vbscript
      'data:text/html;base64,PHNjcmlwdD4=',     // data:
      'jaVaScRiPt:alert(1)'            // casse
    ];
    for (const href of hostile) {
      const result = updateLinkHref(scenario(), 'header', [0, 0], href);
      assert.equal(result.applied, false, `refusé attendu: ${JSON.stringify(href)}`);
      assert.equal(result.reason, 'unsafe-href', `raison unsafe-href: ${JSON.stringify(href)}`);
    }
  });

  it('19. caractères spéciaux correctement échappés en attribut', () => {
    const result = updateLinkHref(scenario(), 'header', [0, 0], '/chercher?q=a & b "c" <d>');
    const html = htmlOf(result.state, 'header');
    assert.ok(html.includes('href="/chercher?q=a &amp; b &quot;c&quot; &lt;d&gt;"'), 'valeur échappée');
  });

  it('20. tentative d injection HTML neutralisée', () => {
    const result = updateLinkHref(scenario(), 'header', [0, 0], '/ok"><script>alert(1)</script>');
    const html = htmlOf(result.state, 'header');
    assert.ok(!html.includes('<script>'), 'aucun script réel');
    assert.ok(html.includes('&quot;&gt;&lt;script&gt;'), 'la valeur reste dans l attribut');
    assert.ok(html.includes('class="nav-link"'), 'structure du <a> intacte');
  });

  it('21. RESET : nouvelle construction sans édition', () => {
    let s = updateLinkHref(scenario(), 'header', [0, 0], '/nouveau').state;
    s = applyBuildEvents(s, [{ kind: 'BUILD_STARTED', stage: 'structure', timestamp: 100 }]);
    assert.equal(s.components.size, 0);
  });

  it('22. nouvelle génération sans fuite des href', () => {
    let s = updateLinkHref(scenario(), 'header', [0, 0], '/nouveau').state;
    s = applyBuildEvents(s, [
      { kind: 'BUILD_STARTED', stage: 'content', timestamp: 100 },
      { kind: 'COMPONENT_CREATED', component: { id: 'header', type: 'header', metadata: { html: '<nav><a href="/accueil">A</a></nav>' } }, timestamp: 101 }
    ]);
    assert.ok(htmlOf(s, 'header').includes('href="/accueil"'));
    assert.ok(!htmlOf(s, 'header').includes('/nouveau'), 'aucune fuite');
  });

  it('23. compatibilité complète É22 texte + É23 image', () => {
    let s = scenario();
    // texte É22 sur le <p>
    s = updateTextContent(s, 'header', [1], 'Nouveau texte').state;
    // image É23 sur un HTML enrichi
    s = applyBuildEvents(updateLinkHref(s, 'header', [0, 0], '/nouveau').state, [
      { kind: 'BUILD_STARTED', stage: 'content', timestamp: 50 },
      { kind: 'COMPONENT_CREATED', component: { id: 'h2', type: 'header', metadata: { html: '<nav><a href="/a">A</a><img src="a.png"></nav><p>Txt</p>' } }, timestamp: 51 }
    ]);
    s = updateLinkHref(s, 'h2', [0, 0], '/lien-edite').state;
    s = updateImageSource(s, 'h2', [0, 1], 'img-editee.png').state;
    s = updateTextContent(s, 'h2', [1], 'Texte édité').state;
    const html = htmlOf(s, 'h2');
    assert.ok(html.includes('href="/lien-edite"'), 'lien É24');
    assert.ok(html.includes('src="img-editee.png"'), 'image É23');
    assert.ok(html.includes('Texte édité'), 'texte É22');
    assert.ok(html.includes('<nav>') && html.includes('</nav>'), 'structure intacte');
    const inspector = buildInspector(s, 'h2');
    assert.equal(inspector!.hasRealHtml, true);
  });
});
