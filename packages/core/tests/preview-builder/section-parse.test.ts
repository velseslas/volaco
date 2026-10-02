/**
 * E40 — EXTRACTION DES SECTIONS D'UN HTML SERVEUR (extractSections).
 *
 * Sert à reconstruire le canvas du Builder depuis un HTML restauré par
 * rollback. Le découpage DOIT réutiliser la convention de blocs du serveur
 * (conversation.ts) : ce qui est extrait est ce que le serveur remplacerait.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractSections } from '../../src/preview-builder/section-parse.js';

const wrap = (name: string, inner: string): string => `<div class="vibe-stitched" data-section="${name}">${inner}</div>`;

describe('E40 : extractSections', () => {
  it('1. deux sections : noms et intérieurs exacts', () => {
    const html = '<html><body>\n'
      + wrap('header', '<header><span>Logo</span></header>') + '\n'
      + wrap('hero', '<section><h1>Titre</h1></section>') + '\n'
      + '</body></html>';
    const sections = extractSections(html);
    assert.deepEqual(sections.map((s) => s.name), ['header', 'hero']);
    assert.equal(sections[0]?.html, '<header><span>Logo</span></header>');
    assert.equal(sections[1]?.html, '<section><h1>Titre</h1></section>');
  });

  it('2. divs imbriqués dans la section : l intérieur reste complet', () => {
    const inner = '<section><div class="a"><div class="b">x</div></div><p>fin</p></section>';
    const sections = extractSections('<body>' + wrap('hero', inner) + '</body>');
    assert.equal(sections[0]?.html, inner);
  });

  it('3. section unique en fin de document (avant </body>)', () => {
    const sections = extractSections('<body>' + wrap('footer', '<footer>bas</footer>') + '\n</body>');
    assert.deepEqual(sections.map((s) => s.name), ['footer']);
    assert.equal(sections[0]?.html, '<footer>bas</footer>');
  });

  it('4. aucun wrapper data-section → tableau vide', () => {
    assert.deepEqual(extractSections('<html><body><div>rien</div></body></html>'), []);
    assert.deepEqual(extractSections(''), []);
  });

  it('5. cap maxSections : ne diverge jamais', () => {
    const html = Array.from({ length: 10 }, (_, i) => wrap('s' + i, '<p>x' + i + '</p>')).join('');
    assert.equal(extractSections(html, 5).length, 5);
  });

  it('6. cohérence aller-retour avec le format d assemblage serveur', () => {
    // un HTML généré par le serveur → extractSections → les intérieurs
    // ré-assemblés avec wrapper redonnent le même document section par section
    const inner = '<header class="h"><nav>x</nav></header>';
    const html = '<body>' + wrap('header', inner) + '</body>';
    const sections = extractSections(html);
    assert.equal(sections.length, 1);
    assert.ok(html.includes('data-section="header">' + sections[0]!.html + '</div>'));
  });

  it('7. reconstruction d état : RESET → STARTED → CREATED/READY par section (séquence E40)', async () => {
    // la séquence du Builder après restauration : sans BUILD_STARTED, le
    // moteur ignore CREATED/READY (statut 'building' requis).
    const engine = await import('../../src/preview-builder/engine.js');
    const html = '<body>'
      + wrap('header', '<header><span>Logo</span></header>') + '\n'
      + wrap('hero', '<section><h1>Titre</h1></section>')
      + '</body>';
    const sections = extractSections(html);
    let state = engine.createPreviewBuildState();
    state = engine.applyBuildEvent(state, { kind: 'BUILD_RESET', timestamp: 1 });
    state = engine.applyBuildEvent(state, { kind: 'BUILD_STARTED', stage: 'content', timestamp: 2 });
    for (const s of sections) {
      state = engine.applyBuildEvent(state, { kind: 'COMPONENT_CREATED', component: { id: s.name, type: s.name, label: s.name }, timestamp: 3 });
      state = engine.applyBuildEvent(state, { kind: 'COMPONENT_READY', componentId: s.name, metadata: { html: s.html }, timestamp: 4 });
    }
    state = engine.applyBuildEvent(state, { kind: 'BUILD_COMPLETED', timestamp: 5 });
    assert.equal(state.components.size, 2);
    assert.equal(state.components.get('hero')?.metadata?.html, '<section><h1>Titre</h1></section>');
    // et SANS BUILD_STARTED : rien n'est créé (garde du moteur respectée)
    let empty = engine.createPreviewBuildState();
    empty = engine.applyBuildEvent(empty, { kind: 'BUILD_RESET', timestamp: 1 });
    empty = engine.applyBuildEvent(empty, { kind: 'COMPONENT_CREATED', component: { id: 'x', type: 'x', label: 'x' }, timestamp: 2 });
    assert.equal(empty.components.size, 0);
  });
});
