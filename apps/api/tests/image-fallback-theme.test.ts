/**
 * PATCH P0 — F1/F2/F4 : sanitizer et fallback d'image LIÉS AU THÈME.
 *
 * Preuves exigées (spéc patch) :
 *   - URL autorisée conservée à l'identique ;
 *   - URL hors réservoir → ressource du THÈME (jamais une photo aléatoire
 *     quand le réservoir suffit) ;
 *   - 'autre' → réservoir d'ambiance neutre vérifiée (T0.5) — le repli
 *     picsum historique ne survit qu'à défaut de réservoir (théorique) ;
 *   - réservoir trop petit ('animalier' : 1 ID) → répétition assumée,
 *     documentée, jamais de picsum aléatoire ;
 *   - fallback onerror sans boucle (this.onerror=null AVANT l'échange) ;
 *   - rotation anti-répétition sur plusieurs images / plusieurs sections ;
 *   - traçabilité reçu → conservé (buildFinalImageTrace).
 *
 * Pur et déterministe : aucune IA, aucun réseau, aucun disque.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addImageFallbacks, buildFinalImageTrace, sanitizeImageSources } from '../src/routes/conversation.js';
import { THEME_IMAGE_RESOURCES, type SectionImage } from '../../../packages/core/src/image/theme.js';

const POOL_RESTO = THEME_IMAGE_RESOURCES.restaurant.unsplash;
const POOL_ANI = THEME_IMAGE_RESOURCES.animalier.unsplash;
const POOL_AUTRE = THEME_IMAGE_RESOURCES.autre.unsplash;

const sec = (name: string, inner: string) => `<div class="vibe-stitched" data-section="${name}">${inner}</div>`;
const img = (src: string, alt: string) => `<img src="${src}" alt="${alt}">`;
const unsplashIds = (html: string): string[] =>
  [...html.matchAll(/images\.unsplash\.com\/(photo-[A-Za-z0-9-]+)/g)].map((m) => m[1]!);

describe('F1 — sanitizeImageSources(theme)', () => {
  it('1. URLs autorisées conservées à l\'identique (réservoir, picsum, data:, src vide)', () => {
    for (const id of POOL_RESTO) {
      const html = img(`https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80`, 'plat');
      const out = sanitizeImageSources(html, 'restaurant');
      assert.equal(out.replaced, 0);
      assert.equal(out.html, html, 'URL du réservoir non retouchée');
    }
    assert.equal(sanitizeImageSources(img('https://picsum.photos/seed/resto-1/800/520', 'x'), 'restaurant').replaced, 0);
    assert.equal(sanitizeImageSources(img('data:image/png;base64,AAA', 'x'), 'restaurant').replaced, 0);
    assert.equal(sanitizeImageSources('<img alt="rien">', 'restaurant').replaced, 0);
  });

  it('2. hors réservoir → ID vérifié du thème (2 sections, images DISTINCTES, zéro générique)', () => {
    const html = sec('hero', img('https://loremflickr.com/1200/800/food?lock=7', 'plat signature'))
      + sec('galerie', img('https://images.unsplash.com/photo-9999999999-aaaaaaaaaa?auto=format&fit=crop&w=1200&q=80', 'salle'));
    const out = sanitizeImageSources(html, 'restaurant');
    assert.equal(out.replaced, 2, 'deux réécritures tracées');
    const ids = unsplashIds(out.html);
    assert.equal(ids.length, 2);
    assert.ok(!out.html.includes('loremflickr'), 'URLs hallucinées absentes du HTML final');
    assert.ok(!out.html.includes('picsum.photos'), 'aucune photo aléatoire quand le réservoir suffit');
    assert.ok(new Set(ids).size === 2, 'rotation : pas de répétition tant que le réservoir suffit');
    for (const id of ids) assert.ok(POOL_RESTO.includes(id), 'ID du réservoir restaurant : ' + id);
  });

  it('3. anti-répétition : un ID déjà affiché n\'est pas redonné en premier', () => {
    const html = sec('hero', img(`https://images.unsplash.com/${POOL_RESTO[0]}?auto=format&fit=crop&w=1200&q=80`, 'déjà affichée'))
      + sec('galerie', img('https://loremflickr.com/1200/800/food', 'autre'));
    const out = sanitizeImageSources(html, 'restaurant');
    assert.equal(out.replaced, 1);
    assert.equal((out.html.match(new RegExp(POOL_RESTO[0]!.replace(/[-]/g, '\\$&'), 'g')) || []).length, 1, 'pas de doublon de l\'ID déjà affiché');
    assert.ok(out.html.includes(POOL_RESTO[1]!), 'ID suivant du réservoir utilisé');
  });

  it('4. réservoir trop petit (animalier : 1 ID) → répétition assumée, jamais de picsum aléatoire', () => {
    assert.equal(POOL_ANI.length, 1, 'préambule du cas : le pool animalier tient dans une seule image');
    const html = sec('hero', img('https://loremflickr.com/1', 'chien'))
      + sec('galerie', img('https://loremflickr.com/2', 'chat'));
    const out = sanitizeImageSources(html, 'animalier');
    assert.equal(out.replaced, 2);
    const ids = unsplashIds(out.html);
    assert.deepEqual(ids, [POOL_ANI[0], POOL_ANI[0]], 'pool épuisé → répétition documentée');
    assert.ok(!out.html.includes('picsum.photos'), 'aucune substitution générique');
  });

  it('5. T0.5 — "autre" possède un réservoir d\'ambiance neutre ; remplacement déterministe dedans', () => {
    assert.ok(POOL_AUTRE.length >= 12, 'préambule : 12 images d\'ambiance vérifiées');
    const a = sanitizeImageSources(img('https://loremflickr.com/1200/800/bakery?lock=3', 'Croissant chaud'), 'autre');
    const b = sanitizeImageSources(img('https://loremflickr.com/1200/800/bakery?lock=3', 'Croissant chaud'), 'autre');
    assert.equal(a.replaced, 1);
    const ids = unsplashIds(a.html);
    assert.equal(ids.length, 1);
    assert.ok(POOL_AUTRE.includes(ids[0]!), 'ID du réservoir d\'ambiance : ' + ids[0]);
    assert.ok(!a.html.includes('picsum.photos'), 'plus de photo aléatoire : le réservoir suffit');
    assert.equal(a.html, b.html, 'déterministe');
  });

  it('6. protocole dangereux (javascript:) réécrit vers le thème, sans trace du protocole', () => {
    const out = sanitizeImageSources(img('javascript:alert(1)', 'x'), 'restaurant');
    assert.equal(out.replaced, 1);
    assert.ok(!out.html.includes('javascript:'));
    const ids = unsplashIds(out.html);
    assert.equal(ids.length, 1);
    assert.ok(POOL_RESTO.includes(ids[0]!));
  });
});

describe('F2 — addImageFallbacks(theme)', () => {
  it('7. onerror du repli reste dans le thème (2 images, distinctes, sans boucle)', () => {
    const html = sec('hero', img('https://exemple.test/a.png', 'a'))
      + sec('galerie', img('https://exemple.test/b.png', 'b > c'));
    const out = addImageFallbacks(html, 'restaurant');
    const srcs = [...out.matchAll(/onerror="this\.onerror=null;this\.src='([^']+)'/g)].map((m) => m[1]!);
    assert.equal(srcs.length, 2, 'les deux http(s) sans gestionnaire équipées');
    for (const s of srcs) {
      assert.match(s, /^https:\/\/images\.unsplash\.com\/photo-/i, 'repli du réservoir du thème, pas du générique');
      assert.match(s, /auto=format&fit=crop&w=1200&q=80$/, 'format conforme au brief');
    }
    assert.ok(new Set(srcs).size === 2, 'images distinctes');
    assert.ok(out.includes('alt="b > c"'), 'attributs préservés (apostrophe hors alt)');
  });

  it('8. T0.5 — repli par défaut (autre) tiré du réservoir d\'ambiance : rotation déterministe', () => {
    const out = addImageFallbacks('<img src="https://a.test/1.png"><img src="https://b.test/2.png">');
    const srcs = [...out.matchAll(/onerror="this\.onerror=null;this\.src='([^']+)'/g)].map((m) => m[1]!);
    assert.equal(srcs.length, 2);
    const ids = srcs.map((s) => /photo-[0-9a-z-]+/.exec(s)?.[0] ?? '');
    for (const id of ids) assert.ok(POOL_AUTRE.includes(id), 'repli du réservoir T0.5 : ' + id);
    assert.ok(new Set(ids).size === 2, 'images distinctes tant que le réservoir a des libres');
    const again = addImageFallbacks('<img src="https://a.test/1.png"><img src="https://b.test/2.png">');
    assert.equal(again, out, 'même entrée → même replis (déterministe)');
  });

  it('9. pas de boucle : onerror=null AVANT l\'échange ; custom onerror intact ; data: ignoré', () => {
    const custom = '<img src="https://x.test/a.png" onerror="custom()">';
    assert.equal(addImageFallbacks(custom, 'restaurant'), custom, 'gestionnaire existant conservé');
    assert.equal(addImageFallbacks('<img src="data:image/png;base64,xx">', 'restaurant'), '<img src="data:image/png;base64,xx">', 'data: intact');

  });
});

describe('F4 — buildFinalImageTrace (reçu → conservé)', () => {
  it('10. paire par index, `received` uniquement quand la source a été réécrite', () => {
    const id = POOL_RESTO[0]!;
    const received: SectionImage[] = [
      { section: 'hero', src: 'https://loremflickr.com/1200/800/food?lock=7' },
      { section: 'galerie', src: `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80` },
    ];
    const final: SectionImage[] = [
      { section: 'hero', src: `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80` },
      { section: 'galerie', src: `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80` },
    ];
    const trace = buildFinalImageTrace(received, final);
    assert.equal(trace.length, 2);
    assert.equal(trace[0]!.received, 'https://loremflickr.com/1200/800/food?lock=7', 'URL reçue conservée pour examen');
    assert.equal(trace[0]!.final, final[0]!.src);
    assert.equal(trace[1]!.received, undefined, 'source conservée à l\'identique : pas de bruit');
  });

  it('11. borné à 20 et srcs tronquées à 120 caractères (aucun secret, concision)', () => {
    const long = 'https://loremflickr.com/' + 'a'.repeat(300);
    const received: SectionImage[] = Array.from({ length: 25 }, (_, i) => ({ section: `s${i}`, src: long }));
    const final: SectionImage[] = Array.from({ length: 25 }, (_, i) => ({ section: `s${i}`, src: 'https://picsum.photos/seed/x/800/520' }));
    const trace = buildFinalImageTrace(received, final);
    assert.equal(trace.length, 20);
    const first = trace[0]!;
    assert.equal(first.received!.length, 120, 'src reçue tronquée à 120');
    assert.ok(first.received !== undefined, 'paire reçue présente');
    assert.equal(first.final, 'https://picsum.photos/seed/x/800/520', 'src finale courte : intacte, pas de marge artificielle');
  });
});
