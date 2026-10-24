/**
 * PATCH P1 — THÈME GELATO : sous-thème du domaine gourmand.
 *
 * Preuves exigées (spéc approuvée + ajustements utilisateur) :
 *   1. Détection ×3 : vocabulaire métier gelato (gelateria, bar à glaces,
 *      glacier artisanal…) → 'gelato' — même quand « bar » capterait la
 *      demande côté restaurant ;
 *   2. ACTIVITÉ PRINCIPALE : une gelateria qui propose AUSSI des produits
 *      salés (paninis, sandwichs) reste gelato ; à l'inverse, un
 *      restaurant/pizzeria/snack/boulangerie qui propose des glaces ne
 *      bascule JAMAIS vers gelato (rivaux présents) ;
 *   3. Sanitizer gelato : URL du réservoir conservée À L'IDENTIQUE ;
 *   4. Hors-réservoir remplacé par des IDs du réservoir gelato (rotation
 *      anti-répétition), jamais picsum quand le réservoir suffit ;
 *   5. Fallbacks (=onerror) toujours tirés du réservoir gelato, garde
 *      anti-boucle intacte ;
 *   6. Zéro régression : contrats/détection des autres secteurs inchangés
 *      (restaurant garde sa palette et son CTA, thèmes concurrents conservés) ;
 *   7. Titre de page en contexte (voie réparation/modification) : « Glaces
 *      artisanales faites maison » → gelato.
 *
 * Pur et déterministe : aucune IA, aucun réseau, aucun disque.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addImageFallbacks, sanitizeImageSources, VERIFIED_UNSPLASH_IDS } from '../src/routes/conversation.js';
import {
  allVerifiedUnsplashIds,
  buildImageBrief,
  buildSectorContract,
  detectImageTheme,
  IMAGE_THEMES,
  pageTitleHint,
  THEME_IMAGE_RESOURCES,
} from '../../../packages/core/src/image/theme.js';

const POOL = THEME_IMAGE_RESOURCES.gelato.unsplash;
const POOL_SET = new Set(POOL);

describe('P1 gelato : détection — activité principale d\u2019abord', () => {
  it('1. vocabulaire métier → gelato (même face au mot générique « bar »)', () => {
    assert.equal(detectImageTheme('crée un site pour ma gelateria artisanale'), 'gelato');
    assert.equal(detectImageTheme('Glacier du Port : bar à glaces et glaces à l\'italienne'), 'gelato');
    assert.equal(detectImageTheme('gelato maison, sorbets et sundaes au salon de glaces'), 'gelato');
    assert.equal(detectImageTheme('mon salon de thé et glacier, cornets et coupes glacées'), 'gelato');
  });

  it('2. activité principale : gelateria + produits salés reste gelato (décision utilisateur)', () => {
    assert.equal(
      detectImageTheme('Gelateria La Bella : gelato artisanal, cornets, paninis et sandwichs salés'),
      'gelato',
    );
    assert.equal(detectImageTheme('glaces artisanales à l\'italienne, club sandwich et salades'), 'gelato');
  });

  it('2bis. faux positifs bloqués : restaurant/snack/boulangerie avec gelato → jamais gelato', () => {
    assert.equal(detectImageTheme('pizzeria avec carte de gelatos'), 'restaurant');
    assert.equal(detectImageTheme('snack-glacier du port, burgers et glaces'), 'restaurant');
    assert.equal(detectImageTheme('restaurant avec glaces en dessert'), 'restaurant');
    assert.equal(detectImageTheme('boulangerie avec sorbet maison l\'été'), 'restaurant');
    // « glacier » de montagne : 1 seul medium (< 2) → autre.
    assert.equal(detectImageTheme('randonnée au glacier d\'Argentière'), 'autre');
  });

  it('7. titre de page comme contexte (voie réparation / modification)', () => {
    const html = '<html><head><title>Glaces artisanales faites maison — La Roma</title></head><body></body></html>';
    assert.equal(pageTitleHint(html), 'Glaces artisanales faites maison — La Roma');
    assert.equal(detectImageTheme('met à jour les images', pageTitleHint(html)), 'gelato');
  });

  it('déterminisme : même entrée → même thème', () => {
    const p = 'gelateria et bar à glaces';
    assert.equal(detectImageTheme(p), detectImageTheme(p));
  });
});

describe('P1 gelato : réservoir vérifié', () => {
  it('3. 9 IDs uniques, tous présents dans la table globale des vérifiés', () => {
    assert.ok(POOL.length >= 9, 'réservoir gelato ≥ 9 IDs');
    assert.equal(new Set(POOL).size, POOL.length, 'IDs uniques');
    const global = allVerifiedUnsplashIds();
    for (const id of POOL) {
      assert.ok(global.includes(id), 'ID gelato enregistré comme vérifié : ' + id);
      assert.ok(VERIFIED_UNSPLASH_IDS.has(id), 'ID gelato dans VERIFIED_UNSPLASH_IDS : ' + id);
    }
    for (const id of POOL) {
      assert.match(id, /^photo-[0-9a-z-]+$/, 'format d\'ID Unsplash : ' + id);
    }
  });

  it('le brief de création cite tout le réservoir gelato + rôles hero/cartes/galerie', () => {
    const brief = buildImageBrief('gelato', 'create');
    assert.match(brief, /hero/);
    assert.match(brief, /cartes/);
    assert.match(brief, /galerie/);
    assert.match(brief, /RÉSERVOIR vérifié/);
    for (const id of POOL) {
      assert.ok(brief.includes(id), 'ID imposé dans le brief gelato : ' + id);
    }
    // Aucun IDRAFT : tout ID cité vient de la table vérifiée globale.
    const ids = [...brief.matchAll(/photo-[a-z0-9-]+/gi)].map((m) => m[0]);
    const allowed = new Set(allVerifiedUnsplashIds());
    for (const id of ids) assert.ok(allowed.has(id), 'ID non inventé : ' + id);
  });

  it('le brief de modification impose préservation + recopie', () => {
    const brief = buildImageBrief('gelato', 'modify');
    assert.match(brief, /PRÉSERVATION|préserv/i);
    assert.ok(brief.includes('recopie') || brief.includes('recopier'));
  });
});

describe('P1 gelato : sanitizer (F1) ', () => {
  it('4. URL du réservoir conservée à l\'identique', () => {
    const url = `https://images.unsplash.com/${POOL[0]}?auto=format&fit=crop&w=1200&q=80`;
    const html = `<section><img src="${url}" alt="vitrine"></section>`;
    const r = sanitizeImageSources(html, 'gelato');
    assert.equal(r.replaced, 0, 'aucune réécriture d\'URL autorisée');
    assert.ok(r.html.includes(url), 'URL conservée à l\'identique');
  });

  it('5. hors-réservoir → IDs du réservoir gelato, rotation sans doublon tant qu\'il reste des libres', () => {
    const html = [
      `<section data-section="hero"><img src="${`https://images.unsplash.com/${POOL[0]}?auto=format&fit=crop&w=1200&q=80`}" alt="hero autorisé"></section>`,
      '<section data-section="carte"><img src="https://loremflickr.com/1200/800/pizza" alt="pizza hallucinée"></section>',
      '<section data-section="galerie"><img src="https://images.unsplash.com/photo-000999888777-zzz-fake" alt="id inventé"></section>',
    ].join('\n');
    const r = sanitizeImageSources(html, 'gelato');
    assert.equal(r.replaced, 2, '2 réécritures (loremflickr + id inventé)');
    const outIds = [...r.html.matchAll(/images\.unsplash\.com\/(photo-[A-Za-z0-9-]+)/gi)].map((m) => m[1] ?? '');
    assert.equal(outIds.length, 3);
    for (const id of outIds) assert.ok(POOL_SET.has(id), 'seulement du réservoir gelato : ' + id);
    const replacedIds = outIds.filter((id) => id !== POOL[0]);
    assert.equal(replacedIds.length, 2, '2 remplacements effectués');
    assert.equal(new Set(replacedIds).size, 2, 'rotation : ids distincts tant que le réservoir a des libres');
    assert.doesNotMatch(r.html, /loremflickr/, 'loremflickr éradiqué');
    assert.doesNotMatch(r.html, /picsum\.photos/, 'pas de picsum : le réservoir gelato suffit');
  });
});

describe('P1 gelato : fallbacks onerror (F2)', () => {
  it('6. chaque img http(s) reçoit un onerror du réservoir gelato, garde anti-boucle', () => {
    const html =
      `<section><img src="https://images.unsplash.com/${POOL[8]}?auto=format&fit=crop&w=1200&q=80" alt="produit">` +
      '<img src="https://exemple-faux.tld/cornet.jpg" alt="externe"></section>';
    const out = addImageFallbacks(html, 'gelato');
    const fallbacks = [...out.matchAll(/onerror="this\.onerror=null;this\.src='([^']+)'/gi)].map((m) => m[1] ?? '');
    assert.equal(fallbacks.length, 2, '2 img ont reçu un fallback (aucune déjà protégée)');
    for (const f of fallbacks) {
      assert.match(f, /^https:\/\/images\.unsplash\.com\/photo-[0-9a-z-]+\?auto=format&fit=crop&w=1200&q=80$/, 'fallback = réservoir gelato : ' + f);
      const id = /photo-[0-9a-z-]+/.exec(f)![0];
      assert.ok(POOL_SET.has(id), 'fallback dans le pool gelato : ' + id);
    }
    // Anti-boucle (E46) : l'attribut porte `this.onerror=null` AVANT l'échange de src.
    assert.match(out, /this\.onerror=null;this\.src='https:\/\/images\.unsplash\.com\//);
  });

  it('img déjà protégée : jamais re-traitée (idempotent)', () => {
    const protectedImg =
      `<img src="https://exemple-faux.tld/a.jpg" onerror="this.onerror=null;this.src='https://images.unsplash.com/${POOL[1]}?auto=format&fit=crop&w=1200&q=80'">`;
    const out = addImageFallbacks(protectedImg, 'gelato');
    assert.equal(out, protectedImg, 'chaîne identique : aucune img déjà protégée re-traitée');
    assert.equal((out.match(/this\.onerror=null/gi) || []).length, 1, 'un seul garde anti-boucle');
    // Un 2e passage ne change strictement rien.
    assert.equal(addImageFallbacks(out, 'gelato'), out, 'idempotent au 2e passage');
  });
});

describe('P1 gelato : zéro régression des autres secteurs', () => {
  it('8. restaurant : contrat inchangé (palette, CTA, sections)', () => {
    const c = buildSectorContract('restaurant', 'create');
    assert.match(c, /#fff8f0/, 'palette restaurant intacte');
    assert.match(c, /#c2410c/, 'accent restaurant intact');
    assert.match(c, /Réserver une table/, 'CTA restaurant intact');
    assert.match(c, /reservation/, 'sections restaurant intactes');
    assert.doesNotMatch(c, /#84cc16/, 'aucun accent gelato injecté dans restaurant');
    // réservoir restaurant non touché
    const expectedFirst = 'photo-1513104890138-7c749659a591';
    assert.equal(THEME_IMAGE_RESOURCES.restaurant.unsplash[0], expectedFirst);
  });

  it('9. détection des thèmes concurrents inchangée', () => {
    assert.equal(detectImageTheme('bistrot parisien cosy'), 'restaurant');
    assert.equal(detectImageTheme('site vitrine pour ma clinique dentaire'), 'clinique');
    assert.equal(detectImageTheme('pizzeria napolitaine'), 'restaurant');
    assert.equal(detectImageTheme('garage automobile réparation'), 'garage');
  });

  it('10. IMAGE_THEMES expose gelato SANS déplacer les autres', () => {
    assert.deepEqual(
      [...IMAGE_THEMES].slice(0, 2),
      ['restaurant', 'gelato'],
      'gelato inséré juste après restaurant',
    );
    assert.ok(IMAGE_THEMES.includes('clinique') && IMAGE_THEMES.includes('hotel') && IMAGE_THEMES.includes('garage')
      && IMAGE_THEMES.includes('boutique') && IMAGE_THEMES.includes('saas') && IMAGE_THEMES.includes('animalier')
      && IMAGE_THEMES.includes('autre'));
  });

  it('11. sanitize : thème par défaut \'autre\' → réservoir T0.5 ; img vides/data: jamais touchées', () => {
    assert.ok(POOL.length >= 1, 'pool gelato non vide (pré-condition)');
    // T0.5 : le défaut 'autre' a son réservoir d'ambiance — outsider → ce réservoir
    const r = sanitizeImageSources('<img src="https://loremflickr.com/9/9/x" alt="">');
    assert.equal(r.replaced, 1);
    const ids = [...r.html.matchAll(/photo-[0-9a-z-]+/gi)].map((m) => m[0]);
    for (const id of ids) {
      assert.ok(THEME_IMAGE_RESOURCES.autre.unsplash.includes(id), 'ID T0.5 attendu : ' + id);
    }
    // image vide / data: : untouched pour gelato aussi
    const dm = sanitizeImageSources('<img data-x="1"><img src="data:image/png;base64,AAAA" alt=""><img src="" alt="">', 'gelato');
    assert.equal(dm.replaced, 0);
  });

  it('12. picsum reste un hôte autorisé même avec gelato (comportement historique)', () => {
    const r = sanitizeImageSources('<img src="https://picsum.photos/seed/gelato-vitrine/800/520" alt="">', 'gelato');
    assert.equal(r.replaced, 0, 'picsum autorisé (host whitelist) — par politique historique');
  });
});
