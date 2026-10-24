/**
 * B2 — ORDRE CANONIQUE EN MODIFICATION.
 *
 * Le merge préserve l'ordre d'arrivée : footer émis en 2e, ajout inséré
 * avant </body> (après le footer). canonicalSectionOrderBlocks permute les
 * blocs data-section entre eux (header → hero → contenu → closing → footer
 * TOUJOURS dernier), sans toucher au reste du document.
 *
 * Pur et déterministe : aucune IA, aucun réseau, aucun disque.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSectionOrderBlocks } from '../src/routes/conversation.js';

const wrap = (name: string, inner: string) => `<div class="vibe-stitched" data-section="${name}">${inner}</div>`;

describe('B2 — ordre canonique en modification', () => {
  it('remet le footer dernier quand le LLM l\'émet en 2e', () => {
    const html = '<html><body>'
      + wrap('header', '<header>H</header>')
      + wrap('footer', '<footer>F</footer>')
      + wrap('menu', '<section>M</section>')
      + '</body></html>';
    const out = canonicalSectionOrderBlocks(html);
    const order = [...out.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(order, ['header', 'menu', 'footer']);
  });

  it('replace un ajout tombé après le footer (repli avant </body>)', () => {
    const html = '<html><body>'
      + wrap('header', '<header>H</header>')
      + wrap('footer', '<footer>F</footer>')
      + wrap('avis', '<section>A</section>')
      + '</body></html>';
    const out = canonicalSectionOrderBlocks(html);
    const order = [...out.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(order, ['header', 'avis', 'footer']);
  });

  it('ne touche ni au contenu hors-blocs ni aux doublons (stables)', () => {
    const html = '<html><body><p>intro</p>'
      + wrap('footer', '<footer>1</footer>')
      + wrap('footer', '<footer>2</footer>')
      + '<script>x</script></body></html>';
    const out = canonicalSectionOrderBlocks(html);
    assert.ok(out.includes('<p>intro</p>'));
    assert.ok(out.includes('<script>x</script>'));
    const footers = [...out.matchAll(/<footer>(.*?)<\/footer>/g)].map((m) => m[1]);
    assert.deepEqual(footers, ['1', '2']);
  });

  it('laisse intact un document à 0 ou 1 section', () => {
    const solo = '<html><body>' + wrap('hero', '<section>H</section>') + '</body></html>';
    assert.equal(canonicalSectionOrderBlocks(solo), solo);
    assert.equal(canonicalSectionOrderBlocks('<html><body>rien</body></html>'), '<html><body>rien</body></html>');
  });
});
