/**
 * LOT UNSPLASH-DYN (18/10) — source d'images dynamique par clé usager.
 *
 * Preuves exigées :
 *   - recherche réelle (fetch INJECTÉ, aucun réseau) → photos canoniques :
 *     params exotiques de l'API jetés, photo-ID strict, dédup, métadonnées ;
 *   - clé vide → zéro appel ; HTTP 401 → erreur SANS la clé ; formes
 *     inattendues (JSON vide, results non-tableau) → erreur ;
 *   - formes dangereuses (http://, hôte étranger, slug invalide) ignorées ;
 *   - sanitize SANS options : sortie byte-identique au comportement
 *     historique (3 variantes d'appel) ;
 *   - adoption : photos réelles D'ABORD (URLs canoniques exactes), réserve
 *     déterministe ensuite, picsum en dernier recours théorique ;
 *   - URL dynamique déjà présente : conservée (replaced 0) ;
 *   - hors-secteur vérifié → réécrit vers les dynamiques (poolOverride) ;
 *   - dédup : la photo dynamique en double reçoit la dyn suivante ;
 *   - idempotence : double passage → 0 réécriture ;
 *   - THEME_PHOTO_QUERY : 12 thèmes (lot coiffeur), sobre, sans URL/ID ;
 *   - buildImageBrief + poolOverride : IDs réels listés, étiquette vraie ;
 *     sans override : comportement historique inchangé ;
 *   - journal d'adoptions : validation stricte (slugs), dédup, relecture,
 *     fichier corrompu → vide, jamais d'exception ;
 *   - politique + porte : ID adopté conforme (borné à images.unsplash.com),
 *     hors journal strictement inchangé, imageGateInspect défaut lit le
 *     journal — conflit des portes soldé.
 *
 * Réseau : aucun (fetch injecté). Disque : uniquement le journal d'adoptions
 * dans le data dir de la suite (scratch du harnais), jamais le dépôt.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeImageSources,
  resolveDynamicSearchQuery,
  type DynamicImageAdoption,
} from '../src/routes/conversation.js';
import {
  buildImageBrief,
  IMAGE_THEMES,
  THEME_IMAGE_RESOURCES,
} from '../../../packages/core/src/image/theme.js';
import {
  canonicalUnsplashPhotoUrl,
  searchThemedUnsplashPhotos,
  THEME_PHOTO_QUERY,
  unsplashPhotoIdFromUrl,
} from '../../../packages/core/src/image/unsplash-dynamic.js';
import { inspectAppImageSources } from '../../../packages/core/src/image/app-policy.js';
import { imageGateInspect } from '../src/middleware/image-gate.js';
import { adoptedImageIds, recordAdoptedImageIds } from '../../../packages/core/src/image/image-adoptions.js';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const POOL_RESTO = THEME_IMAGE_RESOURCES.restaurant.unsplash;
const POOL_ANI = THEME_IMAGE_RESOURCES.animalier.unsplash;

const ID_A = 'photo-1546069901-ba9599a7e63c';
const ID_B = 'photo-1552566626-52f8b828add9';
const URL_A = canonicalUnsplashPhotoUrl(ID_A);
const URL_B = canonicalUnsplashPhotoUrl(ID_B);

const img = (src: string, alt = 'x') => `<img src="${src}" alt="${alt}">`;

/** Stub fetch traçable : aucune requête réelle ne sort de la suite. */
function stubFetch(responder: (url: string) => { status: number; payload?: unknown; throwError?: Error }) {
  const calls: { url: string; headers: Record<string, string> | undefined }[] = [];
  const fn = (async (input: unknown, init?: unknown) => {
    const url = String(input);
    const headers = (init as { headers?: Record<string, string> } | undefined)?.headers;
    calls.push({ url, headers });
    const r = responder(url);
    if (r.throwError) throw r.throwError;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.payload,
    };
  }) as unknown as typeof fetch;
  return { calls, fn };
}

/** Fixture à la FORME réelle de /search/photos (params exotiques inclus). */
const PHOTO_A = {
  id: 'IgWN6oRfl1g',
  urls: { regular: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?ixlib=rb-4.0.3&ixid=M3wxMjA&auto=format&fit=crop&w=1080&q=80' },
  width: 4000,
  height: 3000,
  alt_description: 'table de restaurant dressée pour le service',
  user: { name: 'Jane Photographe' },
};
const PHOTO_B = {
  id: 'xYz123',
  urls: { regular: 'https://images.unsplash.com/photo-1552566626-52f8b828add9?ixid=abcdef&w=1080' },
  width: 3000,
  height: 2000,
  alt_description: null,
  description: 'salle de restaurant chaleureuse',
  user: { name: 'John Doe' },
};

describe('searchThemedUnsplashPhotos (fetch injecté — zéro réseau réel)', () => {
  it('1. recherche réelle → photos canoniques : params exotiques jetés, dédup, métadonnées, en-tête', async () => {
    const { calls, fn } = stubFetch(() => ({ status: 200, payload: { total: 3, results: [PHOTO_A, PHOTO_B, PHOTO_A] } }));
    const photos = await searchThemedUnsplashPhotos({ query: THEME_PHOTO_QUERY.restaurant, count: 10, apiKey: 'test-key-123', fetchImpl: fn });
    assert.equal(photos.length, 2, 'doublon de photo dédupliqué');
    assert.equal(photos[0]!.id, ID_A);
    assert.equal(photos[0]!.url, URL_A, 'URL RECONSTRUITE canonique');
    assert.ok(!photos[0]!.url.includes('ixid'), 'paramètre exotique ixid jeté');
    assert.ok(!photos[0]!.url.includes('ixlib'), 'paramètre exotique ixlib jeté');
    assert.equal(photos[0]!.width, 4000);
    assert.equal(photos[0]!.height, 3000);
    assert.equal(photos[0]!.alt, 'table de restaurant dressée pour le service');
    assert.equal(photos[0]!.credit, 'Jane Photographe');
    assert.equal(photos[1]!.id, ID_B);
    assert.equal(photos[1]!.alt, 'salle de restaurant chaleureuse', 'description utilisée quand alt_description absent');
    assert.equal(calls.length, 1, 'UNE requête par exécution');
    assert.match(calls[0]!.url, /^https:\/\/api\.unsplash\.com\/search\/photos\?query=restaurant%20meal%20plating%20table&per_page=10&orientation=landscape$/);
    assert.equal(calls[0]!.headers!['Authorization'], 'Client-ID test-key-123', 'schéma Client-ID');
  });

  it('2. clé vide → zéro appel réseau, tableau vide', async () => {
    const { calls, fn } = stubFetch(() => { throw new Error('ne doit jamais être appelé'); });
    assert.deepEqual(await searchThemedUnsplashPhotos({ query: 'restaurant', count: 5, apiKey: '   ', fetchImpl: fn }), []);
    assert.equal(calls.length, 0);
  });

  it('3. HTTP 401 → erreur SANS la clé dans le message', async () => {
    const { fn } = stubFetch(() => ({ status: 401 }));
    await assert.rejects(
      () => searchThemedUnsplashPhotos({ query: 'restaurant', count: 5, apiKey: 'secret-key-xyz', fetchImpl: fn }),
      (error: Error) => {
        assert.match(error.message, /HTTP 401/);
        assert.ok(!error.message.includes('secret-key-xyz'), 'la clé ne fuit jamais dans l\'erreur');
        return true;
      }
    );
  });

  it('4. formes inattendues (results absent, results non-tableau, JSON illisible) → erreur → repli appelant', async () => {
    const r1 = stubFetch(() => ({ status: 200, payload: { total: 0 } }));
    await assert.rejects(() => searchThemedUnsplashPhotos({ query: 'restaurant', count: 5, apiKey: 'k', fetchImpl: r1.fn }));
    const r2 = stubFetch(() => ({ status: 200, payload: { results: 'nope' } }));
    await assert.rejects(() => searchThemedUnsplashPhotos({ query: 'restaurant', count: 5, apiKey: 'k', fetchImpl: r2.fn }));
    const r3 = stubFetch(() => ({ status: 200, payload: null }));
    await assert.rejects(() => searchThemedUnsplashPhotos({ query: 'restaurant', count: 5, apiKey: 'k', fetchImpl: r3.fn }));
  });

  it('5. formes dangereuses ignorées : http://, hôte étranger, slug traversant, regular absent → []', async () => {
    const evil = [
      { urls: { regular: 'http://images.unsplash.com/photo-1234567890-abc' }, width: 1, height: 1 },
      { urls: { regular: 'https://evil.example.com/photo-1234567890-abc' }, width: 1, height: 1 },
      { urls: { regular: 'https://images.unsplash.com/photo-..%2F..%2Fsecret' }, width: 1, height: 1 },
      { urls: { regular: 'javascript:alert(1)' }, width: 1, height: 1 },
      { urls: { full: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=2000' } },
    ];
    const { fn } = stubFetch(() => ({ status: 200, payload: { results: evil } }));
    const photos = await searchThemedUnsplashPhotos({ query: 'restaurant', count: 5, apiKey: 'k', fetchImpl: fn });
    assert.deepEqual(photos.map((p) => p.id), ['photo-1504674900247-0877df9cc836'], 'seule la forme valide (urls.full) est adoptée');
    assert.equal(unsplashPhotoIdFromUrl('https://images.unsplash.com/photo-..%2Fx'), null);
    assert.equal(unsplashPhotoIdFromUrl('http://images.unsplash.com/photo-1234567890-abc'), null, 'https exigé');
  });

  it('6. per_page borné (1..30) et query encodée', async () => {
    const big = stubFetch(() => ({ status: 200, payload: { results: [] } }));
    await searchThemedUnsplashPhotos({ query: 'restaurant meal', count: 500, apiKey: 'k', fetchImpl: big.fn });
    assert.match(big.calls[0]!.url, /per_page=30/);
    const small = stubFetch(() => ({ status: 200, payload: { results: [] } }));
    await searchThemedUnsplashPhotos({ query: 'restaurant meal', count: 0, apiKey: 'k', fetchImpl: small.fn });
    assert.match(small.calls[0]!.url, /per_page=1/);
    assert.match(big.calls[0]!.url, /query=restaurant%20meal/, 'query encodée');
  });
});

describe('sanitizeImageSources + adoption dynamique', () => {
  const adoption = (ids: string[]): DynamicImageAdoption => ({ dynamicIds: new Set(ids), dynamicUrls: ids.map(canonicalUnsplashPhotoUrl) });

  it('7. sans options → sortie STRICTEMENT identique (3 variantes d\'appel)', () => {
    const html = img('https://loremflickr.com/1200/800/food?lock=7', 'plat') + img(URL_A);
    const a = sanitizeImageSources(html, 'restaurant');
    const b = sanitizeImageSources(html, 'restaurant', 0);
    const c = sanitizeImageSources(html, 'restaurant', 0, undefined);
    assert.equal(a.html, b.html);
    assert.equal(a.html, c.html);
    assert.equal(a.replaced, c.replaced);
    assert.equal(a.thematicRewrites, c.thematicRewrites);
  });

  it('8. photos réelles D\'ABORD (URLs canoniques exactes), réserve déterministe ensuite', () => {
    const html = img('https://loremflickr.com/1', 'a') + img('https://loremflickr.com/2', 'b') + img('https://loremflickr.com/3', 'c');
    const out = sanitizeImageSources(html, 'restaurant', 0, adoption([ID_A, ID_B]));
    assert.equal(out.replaced, 3);
    assert.ok(out.html.includes(URL_A), 'première image : URL dynamique canonique exacte');
    assert.ok(out.html.includes(URL_B), 'seconde image : dyn suivante');
    assert.ok(!out.html.includes('loremflickr'), 'aucune URL hallucinée');
    const ids = [...out.html.matchAll(/images\.unsplash\.com\/(photo-[A-Za-z0-9-]+)/g)].map((m) => m[1]!);
    assert.equal(ids.length, 3);
    assert.ok(POOL_RESTO.includes(ids[2]!), 'troisième image : réserve du thème après épuisement (jamais picsum) : ' + ids[2]);
  });

  it('9. URL dynamique déjà présente : CONSERVÉE telle quelle (replaced 0)', () => {
    const html = img(URL_A, 'photo réelle');
    const out = sanitizeImageSources(html, 'restaurant', 0, adoption([ID_A]));
    assert.equal(out.replaced, 0);
    assert.equal(out.html, html);
  });

  it('10. ID non adopté (vérifié d\'un autre temps ou inconnu) : réécrit vers le dynamique', () => {
    const unknown = 'photo-00000000000000000000';
    const out = sanitizeImageSources(img(`https://images.unsplash.com/${unknown}?w=800`), 'restaurant', 0, adoption([ID_A]));
    assert.ok(out.html.includes(URL_A), 'inconnu remplacé par la photo dynamique');
    assert.ok(!out.html.includes(unknown));
  });

  it('11. hors-secteur vérifié (chien animalier sur site restaurant) → réécrit vers les dynamiques', () => {
    const out = sanitizeImageSources(img(`https://images.unsplash.com/${POOL_ANI[0]}?auto=format&fit=crop&w=1200&q=80`), 'restaurant', 0, adoption([ID_A, ID_B]));
    assert.equal(out.thematicRewrites, 1, 'passe thématique tracée');
    assert.ok(!out.html.includes(POOL_ANI[0]!), 'ID animalier écarté');
    assert.ok(out.html.includes(ID_A), 'cible = photo réelle adoptée');
  });

  it('12. dédup : deux fois la même photo dynamique → la seconde reçoit la dyn suivante', () => {
    const html = img(URL_A, 'a') + img(URL_A, 'b');
    const out = sanitizeImageSources(html, 'restaurant', 0, adoption([ID_A, ID_B]));
    const ids = [...out.html.matchAll(/images\.unsplash\.com\/(photo-[A-Za-z0-9-]+)/g)].map((m) => m[1]!);
    assert.equal(ids.length, 2);
    assert.ok(new Set(ids).size === 2, 'plus de doublon après passage');
    for (const id of ids) assert.ok(id === ID_A || id === ID_B, 'les deux cibles restent dans les dynamiques : ' + id);
  });

  it('13. idempotence : le second passage ne réécrit plus rien', () => {
    const html = img('https://loremflickr.com/1', 'a') + img(`https://images.unsplash.com/${POOL_ANI[0]}?w=800`, 'b');
    const dyn = adoption([ID_A, ID_B]);
    const first = sanitizeImageSources(html, 'restaurant', 0, dyn);
    const second = sanitizeImageSources(first.html, 'restaurant', 0, dyn);
    assert.equal(second.replaced, 0);
    assert.equal(second.thematicRewrites, 0);
    assert.equal(second.html, first.html);
  });
});

describe('THEME_PHOTO_QUERY', () => {
  it('17 thèmes (LOT MÉTIERS inclus), requêtes sobres non vides, ASCII, sans URL/ID', () => {
    assert.equal(IMAGE_THEMES.length, 17);
    for (const theme of IMAGE_THEMES) {
      const q = THEME_PHOTO_QUERY[theme];
      assert.ok(typeof q === 'string' && q.trim().length > 0, 'requête absente : ' + theme);
      assert.match(q, /^[a-z0-9' -]+$/i, 'requête non ASCII/sale : ' + q);
      assert.ok(!/https?:|photo-/i.test(q), 'jamais d\'URL ni d\'ID dans la requête');
    }
  });
});

describe('buildImageBrief + poolOverride (photos réelles)', () => {
  it('15. override : les IDs réels du jour sont listés, étiquette vraie, réserve absente', () => {
    const brief = buildImageBrief('restaurant', 'create', 0, { poolOverride: [ID_A, ID_B] });
    assert.ok(brief.includes(ID_A) && brief.includes(ID_B), 'IDs réels listés');
    assert.ok(brief.includes('recherche réelle Unsplash'), 'l\'étiquette dit la vérité sur la provenance');
    assert.ok(!brief.includes(POOL_RESTO[0]!), 'la réserve statique n\'est plus listée quand des photos réelles existent');
    assert.ok(brief.includes('https://images.unsplash.com/<ID>?auto=format&fit=crop&w=1200&q=80'), 'format inchangé');
  });

  it('16. sans override : comportement historique STRICTEMENT inchangé', () => {
    const legacy = buildImageBrief('restaurant', 'create', 7);
    const same = buildImageBrief('restaurant', 'create', 7, undefined);
    assert.equal(legacy, same);
    assert.ok(legacy.includes('RÉSERVOIR vérifié'), 'étiquette historique');
    assert.ok(legacy.includes(POOL_RESTO[0]!), 'réserve déterministe listée');
  });
});

describe('journal d adoptions + politique (conflit des portes soldé)', () => {
  const DYN_ID = 'photo-9999999999999-abcdefabcdef';
  const DYN_URL = `https://images.unsplash.com/${DYN_ID}?auto=format&fit=crop&w=1200&q=80`;
  const SUITE_DATA = process.env.VOLACO_DATA_DIR ?? '';
  // Suite rejouable : le journal repart d'un état propre à chaque exécution
  // (scratch du harnais — jamais le dépôt).
  if (SUITE_DATA.length > 0) rmSync(join(SUITE_DATA, 'image-adoptions.json'), { force: true });

  it('17. sans journal : ID hors réservoir → violation ; option vide = historique strictement identique', () => {
    const content = img(DYN_URL);
    const legacy = inspectAppImageSources([{ path: 'index.html', content }]);
    assert.equal(legacy.violations.length, 1);
    assert.match(legacy.violations[0]!.reason, /réservoir vérifié/);
    const empty = inspectAppImageSources([{ path: 'index.html', content }], { adoptedIds: new Set() });
    assert.equal(empty.violations.length, 1, 'journal vide : comportement historique');
    assert.equal(empty.violations[0]!.url, legacy.violations[0]!.url);
  });

  it('18. ID adopté → conforme ; reclassement borné à images.unsplash.com', () => {
    const content = img(DYN_URL, 'photo réelle') + img(`https://evil.example.com/${DYN_ID}`, 'x');
    const inspection = inspectAppImageSources([{ path: 'index.html', content }], { adoptedIds: new Set([DYN_ID]) });
    assert.equal(inspection.violations.length, 1, 'seul l hôte interdit reste bloquant');
    assert.equal(inspection.violations[0]!.host, 'evil.example.com');
  });

  it('19. ID non adopté → violation conservée', () => {
    const other = 'photo-8888888888888-abcdefabcdef';
    const inspection = inspectAppImageSources(
      [{ path: 'index.html', content: img(`https://images.unsplash.com/${other}?w=800`) }],
      { adoptedIds: new Set([DYN_ID]) }
    );
    assert.equal(inspection.violations.length, 1);
    assert.ok(inspection.violations[0]!.url.includes('8888888888888'));
  });

  it('20. journal : validation stricte, dédup, relecture — seuls les slugs photo-… entrent', () => {
    assert.ok(SUITE_DATA.length > 0, 'VOLACO_DATA_DIR fourni par le harnais');
    const added = recordAdoptedImageIds([DYN_ID, 'NOT-AN-ID!!', DYN_ID, 'https://images.unsplash.com/photo-1-2?w=1']);
    assert.equal(added, 1, 'un seul ID nouveau (invalides rejetés, doublon dédupliqué)');
    assert.ok(adoptedImageIds().has(DYN_ID));
    assert.equal(recordAdoptedImageIds([DYN_ID]), 0, 'rejeu : rien de nouveau');
    const raw = readFileSync(join(SUITE_DATA, 'image-adoptions.json'), 'utf8');
    const parsed = JSON.parse(raw) as { ids: string[] };
    assert.deepEqual(parsed.ids, [DYN_ID], 'le fichier ne contient QUE le slug validé');
  });

  it('21. porte d écriture (imageGateInspect défaut) : le journal rend l ID adopté propre', () => {
    recordAdoptedImageIds([DYN_ID]);
    const clean = imageGateInspect([{ path: 'index.html', content: img(DYN_URL) }]);
    assert.equal(clean.kind, 'clean', 'aucune injection d inspecteur : le journal est lu réellement');
    const other = 'photo-7777777777777-abcdefabcdef';
    const refused = imageGateInspect([{ path: 'index.html', content: img(`https://images.unsplash.com/${other}?w=800`) }]);
    assert.equal(refused.kind, 'violations', 'ID hors journal toujours refusé par la porte');
    assert.equal(refused.imageIssues.length, 1);
  });

  it('22. journal corrompu → ensemble vide, jamais d exception (fail-safe)', () => {
    const file = join(SUITE_DATA, 'image-adoptions.json');
    const backup = existsSync(file) ? readFileSync(file, 'utf8') : null;
    writeFileSync(file, '{ pas du json', 'utf8');
    assert.equal(adoptedImageIds().size, 0);
    assert.equal(imageGateInspect([{ path: 'index.html', content: img(DYN_URL) }]).kind, 'violations');
    if (backup !== null) writeFileSync(file, backup, 'utf8');
  });
});

describe('LOT COIFFEUR (18/10) — la barbierie reçoit des photos de barbier', () => {
  it('23. requête dynamique coiffeur : vocabulaire barbier, sobre, sans URL/ID', () => {
    const q = THEME_PHOTO_QUERY.coiffeur;
    assert.ok(typeof q === 'string' && q.trim().length > 0);
    assert.match(q, /^[a-z0-9' -]+$/i);
    assert.ok(!/https?:|photo-/i.test(q), 'jamais d URL ni d ID');
    assert.match(q, /barber|haircut/i, 'la requête nomme le métier');
  });

  it('24. pertinence : une photo restaurant sur un contenu coiffeur part vers la réserve barbier, idempotent', () => {
    const html = img(`https://images.unsplash.com/${POOL_RESTO[0]}?auto=format&fit=crop&w=1200&q=80`);
    const once = sanitizeImageSources(html, 'coiffeur', 0);
    assert.ok(once.thematicRewrites >= 1, 'la photo d un autre secteur est remplacée');
    assert.ok(
      THEME_IMAGE_RESOURCES.coiffeur.unsplash.some((id) => once.html.includes(id)),
      'la remplaçante vient de la réserve coiffeur'
    );
    const twice = sanitizeImageSources(once.html, 'coiffeur', 0);
    assert.equal(twice.thematicRewrites, 0);
    assert.equal(twice.html, once.html);
  });
});

describe('PATCH SECTEUR-LIBRE (22/10) — requête photo dérivée du texte', () => {
  it('25. thème mappé → requête du thème, aucune dérivation', () => {
    const r = resolveDynamicSearchQuery('restaurant', 'crée un site de restaurant', '');
    assert.deepEqual(r, { query: THEME_PHOTO_QUERY.restaurant, derived: false });
  });

  it('26. thème autre + caserne de pompier → requête métier dérivée', () => {
    const r = resolveDynamicSearchQuery('autre', "crée in site d'une caserne de pompier", '');
    assert.equal(r.query, 'firefighter fire station rescue');
    assert.equal(r.derived, true);
  });

  it('27. thème autre + titre porteur du métier → dérivation par le contexte', () => {
    const r = resolveDynamicSearchQuery('autre', 'ajoute une galerie photos', 'Caserne de pompiers');
    assert.equal(r.query, 'firefighter fire station rescue');
    assert.equal(r.derived, true);
  });

  it('28. thème autre + sujet inconnu → repli générique historique, derived=false', () => {
    const r = resolveDynamicSearchQuery('autre', 'site pour un collectionneur de timbres rares', '');
    assert.deepEqual(r, { query: THEME_PHOTO_QUERY.autre, derived: false });
  });

  it('29. négation : « sans photos de pompier » ne dérive pas firefighter', () => {
    const r = resolveDynamicSearchQuery('autre', 'un site sans photos de pompier ni camion', '');
    assert.equal(r.derived, false);
    assert.equal(r.query, THEME_PHOTO_QUERY.autre);
  });
});
