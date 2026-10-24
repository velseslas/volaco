/**
 * B3 — SANITIZER IMAGES À LA SAUVEGARDE.
 *
 * Le prompt seul ne suffit pas : le LLM récite parfois des URLs de mémoire
 * (loremflickr 500 — prouvé rév n°97 : 7 URLs malgré le réservoir imposé).
 * sanitizeImageSources réécrit toute <img> d'hôte non autorisé vers un ID
 * du réservoir du thème (T0.5 : 'autre' a lui aussi son réservoir d'ambiance
 * neutre vérifiée), avant stockage — en création comme en modification.
 *
 * Pur et déterministe : aucune IA, aucun réseau, aucun disque.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeImageSources, VERIFIED_UNSPLASH_IDS } from '../src/routes/conversation.js';
import { THEME_IMAGE_RESOURCES } from '../../../packages/core/src/image/theme.js';

const POOL_AUTRE = THEME_IMAGE_RESOURCES.autre.unsplash;

const img = (src: string, extra = '') => `<img src="${src}" alt="Croissant chaud" ${extra}>`.replace(' >', '>');

describe('B3 — sanitizer images', () => {
  it('réécrit loremflickr vers le réservoir T0.5 (défaut other : ambiance neutre, déterministe)', () => {
    const a = sanitizeImageSources(img('https://loremflickr.com/1200/800/bakery?lock=3'));
    const b = sanitizeImageSources(img('https://loremflickr.com/1200/800/bakery?lock=3'));
    assert.equal(a.replaced, 1);
    assert.ok(POOL_AUTRE.some((id) => a.html.includes(id)), 'ID du réservoir d\'ambiance : ' + a.html.slice(0, 140));
    assert.equal(a.html, b.html);
  });

  it('réécrit un ID Unsplash inventé (404 garanti) mais ne traite JAMAIS un vérifié comme poison', () => {
    const fake = sanitizeImageSources(img('https://images.unsplash.com/photo-0000000000-ffffffffffff?auto=format&fit=crop&w=1200&q=80'));
    assert.equal(fake.replaced, 1);
    assert.ok(POOL_AUTRE.some((id) => fake.html.includes(id)), 'réécrit vers le réservoir T0.5, pas vers une URL aléatoire');
    // PATCH PERTINENCE : un ID vérifié peut être ROTATIONNÉ vers le thème
    // (thematicRewrites > 0) — mais il ne doit jamais être compté comme
    // poison (replaced = 0) ni disparaître silencieusement : soit il est
    // gardé tel quel, soit la rotation est comptée.
    let keptVerbatim = 0;
    let thematicRotated = 0;
    for (const id of VERIFIED_UNSPLASH_IDS) {
      const r = sanitizeImageSources(img(`https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80`));
      assert.equal(r.replaced, 0, `ID vérifié ${id} ne doit pas être traité comme poison`);
      if (r.html.includes(id)) keptVerbatim += 1;
      else {
        assert.ok(r.thematicRewrites >= 1, `ID vérifié ${id} réécrit doit être compté en thematicRewrites (jamais silencieux)`);
        thematicRotated += 1;
      }
    }
    assert.ok(keptVerbatim + thematicRotated === [...VERIFIED_UNSPLASH_IDS].length, 'chaque ID vérifié est gardé ou rotationné, sans perte');
  });

  it('garde picsum, data: et src vide intacts', () => {
    assert.equal(sanitizeImageSources(img('https://picsum.photos/seed/bakery-1/800/520')).replaced, 0);
    assert.equal(sanitizeImageSources(img('data:image/png;base64,AAA')).replaced, 0);
    assert.equal(sanitizeImageSources('<img alt="rien">').replaced, 0);
  });

  it('réécrit protocole non-http et URL relative vers le réservoir du thème', () => {
    assert.equal(sanitizeImageSources(img('javascript:alert(1)')).replaced, 1);
    const rel = sanitizeImageSources(img('/uploads/photo.jpg'));
    assert.equal(rel.replaced, 1);
    assert.ok(POOL_AUTRE.some((id) => rel.html.includes(id)) || rel.html.includes('croissant-chaud-1'));
  });
});
