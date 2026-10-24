/**
 * LOT POLISH (21/10) — PREUVES DES 4 POINTS RÉACTIVÉS.
 *
 *  1. TITRE : un titre hérité d'un autre secteur (« Authentic Italian
 *     Cuisine » sur un site barbier) est réconcilié avec le h1 réel ;
 *     un titre cohérent n'est jamais réécrit ;
 *  2. UNSPLASH : plafond par défaut 4 000 ms, UNE seule recherche par
 *     exécution, clé absente = zéro réseau, clé jamais dans l'URL ni dans
 *     un message d'erreur ;
 *  3. REFUS HONNÊTES Studio : sauvegarde/plan/corrections n'annoncent un
 *     succès qu'après une écriture serveur confirmée ; les anciens faux
 *     succès ont disparu du source livré ;
 *  4. non-régression : le titre correct du projet barbier reste intact.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { reconcilePageTitle } from '../../../packages/core/src/image/theme.js';
import { applyReconciledPageTitle, buildStudioShell } from '../src/routes/conversation.js';
import {
  THEME_PHOTO_QUERY,
  UNSPLASH_SEARCH_TIMEOUT_MS,
  canonicalUnsplashPhotoUrl,
  searchThemedUnsplashPhotos
} from '../../../packages/core/src/image/unsplash-dynamic.js';

const BARBER_BODY =
  '<p>Barbier de quartier : coupe homme, taille de barbe, rasage traditionnel et soins.</p>' +
  '<p>Notre équipe vous accueille du mardi au samedi dans un salon chaleureux.</p>' +
  '<p>Réservez votre rendez-vous en ligne ; chaque prestation est adaptée à votre style.</p>';

function barberHtml(h1: string, body = BARBER_BODY): string {
  return (
    '<!DOCTYPE html><html><head><title>Authentic Italian Cuisine</title></head>' +
    '<body><header><h1>' + h1 + '</h1></header><main>' + body + '</main></body></html>'
  );
}

describe('Titre — réconciliation titre hérité / contenu réel', () => {
  it('1. titre « Authentic Italian Cuisine » + h1 barbier → h1 réel (entités décodées)', () => {
    const out = reconcilePageTitle('Authentic Italian Cuisine', barberHtml('Coiffure &amp; Beauté'));
    assert.equal(out, 'Coiffure & Beauté');
    assert.ok(!/italian|cuisine/i.test(out), 'le titre hors secteur ne survit pas');
  });

  it('2. titre déjà cohérent (« Barbier & Co ») → conservé à l’identique', () => {
    const out = reconcilePageTitle('Barbier &amp; Co', barberHtml('Coiffure &amp; Beauté'));
    assert.equal(out, 'Barbier & Co');
  });

  it('3. titre neutre (aucun secteur détecté) → jamais réécrit', () => {
    assert.equal(reconcilePageTitle('Mon Site', barberHtml('Coiffure &amp; Beauté')), 'Mon Site');
    assert.equal(reconcilePageTitle('VibeCode Studio', barberHtml('Nos prestations')), 'VibeCode Studio');
  });

  it('4. sans h1 exploitable → titre conservé (aucune invention)', () => {
    const html = '<!DOCTYPE html><html><head><title>Authentic Italian Cuisine</title></head><body><p>Bienvenue.</p></body></html>';
    assert.equal(reconcilePageTitle('Authentic Italian Cuisine', html), 'Authentic Italian Cuisine');
  });

  it('4b. titre hérité + h1 pompier (secteur non mappé) → le h1 réel gagne', () => {
    // Vécu 22/10 : le mot « cuisine » du <title> hérité était compté dans le
    // corps et empêchait la réconciliation, alors que la page était une caserne.
    const body =
      '<p>Caserne de pompiers : interventions, secours et prévention.</p>' +
      '<p>Équipe de sapeurs-pompiers volontaires, matériel et entraînement.</p>' +
      '<p>Gardes 24h/24 et sensibilisation du public aux risques.</p>';
    const html =
      '<!DOCTYPE html><html><head><title>Authentic Italian Cuisine</title></head>' +
      '<body><header><h1>Caserne de Pompiers Moderne</h1></header><main>' + body + '</main></body></html>';
    const out = reconcilePageTitle('Authentic Italian Cuisine', html);
    assert.equal(out, 'Caserne de Pompiers Moderne');
    assert.ok(!/italian|cuisine/i.test(out), 'le titre hors secteur ne survit pas');
  });

  it('5. thème du titre réellement présent dans le corps → titre conservé', () => {
    const body =
      '<p>Notre cuisine italienne propose des pâtes fraîches, pizzas et desserts maison.</p>' +
      '<p>La carte change chaque saison ; réservez votre table au restaurant.</p>' +
      '<p>Une expérience gastronomique conviviale au cœur de la ville.</p>';
    const out = reconcilePageTitle(
      'Authentic Italian Cuisine',
      '<!DOCTYPE html><html><body><h1>Bienvenue</h1><main>' + body + '</main></body></html>'
    );
    assert.equal(out, 'Authentic Italian Cuisine');
  });

  it('6. thème du titre absent du corps + h1 neutre → h1 (preuve contraire)', () => {
    const body =
      '<p>Centre commercial : boutiques, parking gratuit et galerie marchande.</p>' +
      '<p>Horaires d’ouverture du lundi au samedi, accès PMR sur tous les niveaux.</p>' +
      '<p>Retrouvez les enseignes et les services pratiques de votre centre.</p>';
    const out = reconcilePageTitle(
      'Authentic Italian Cuisine',
      '<!DOCTYPE html><html><body><h1>Centre Commercial Moderne</h1><main>' + body + '</main></body></html>'
    );
    assert.equal(out, 'Centre Commercial Moderne');
  });

  it('6b. shell réel : titre barbier réconcilié, entité échappée UNE seule fois', () => {
    const shell = buildStudioShell(
      '<header><h1>Coiffure &amp; Beauté</h1></header><main>' + BARBER_BODY + '</main>',
      undefined,
      'Authentic Italian Cuisine'
    );
    assert.match(shell, /<title>Coiffure &amp; Beauté<\/title>/);
    assert.ok(!shell.includes('Italian Cuisine'));
    assert.ok(!shell.includes('&amp;amp;'), 'aucun double échappement');

    const coherent = buildStudioShell(
      '<header><h1>Coiffure &amp; Beauté</h1></header><main>' + BARBER_BODY + '</main>',
      undefined,
      'Barbier &amp; Co'
    );
    assert.match(coherent, /<title>Barbier &amp; Co<\/title>/);
  });

  it('6c. document COMPLET (mode modification) : titre réconcilié sans déplacer le contenu', () => {
    const full =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Authentic Italian Cuisine</title></head>' +
      '<body><header><h1>Coiffure &amp; Beauté</h1></header><main>' + BARBER_BODY + '</main></body></html>';
    const fixed = applyReconciledPageTitle(full);
    assert.match(fixed, /<title>Coiffure &amp; Beauté<\/title>/);
    assert.ok(!fixed.includes('Italian Cuisine'));
    assert.equal(fixed.replace(/<title>[\s\S]*?<\/title>/i, '<title>X</title>'), full.replace(/<title>[\s\S]*?<\/title>/i, '<title>X</title>'), 'aucun autre octet déplacé');

    const candidate = applyReconciledPageTitle(full, 'Barbier &amp; Co');
    assert.match(candidate, /<title>Barbier &amp; Co<\/title>/);
    assert.ok(!candidate.includes('PAGE_TITLE'));

    const noTitle =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><h1>Coiffure &amp; Beauté</h1><main>' +
      BARBER_BODY + '</main></body></html>';
    assert.match(applyReconciledPageTitle(noTitle), /<head><meta charset="UTF-8"><title>Coiffure &amp; Beauté<\/title><\/head>/);
  });
});

describe('Unsplash — plafond 4 s, une recherche, clé protégée', () => {
  it('7. plafond réseau par défaut = 4 000 ms (8 s → 4 s)', () => {
    assert.equal(UNSPLASH_SEARCH_TIMEOUT_MS, 4000);
  });

  it('8. une seule requête réseau pour N photos, URL canoniques, clé hors URL', async () => {
    let calls = 0;
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fakeFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls += 1;
      capturedUrl = String(input);
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              urls: { regular: 'https://images.unsplash.com/photo-abc123?w=800&q=70' },
              width: 1200,
              height: 800,
              alt_description: 'Barber cutting hair',
              user: { name: 'Studio Photo' }
            },
            {
              urls: { regular: 'https://images.unsplash.com/photo-def456?w=800&q=70' },
              width: 1200,
              height: 800,
              alt_description: 'Barber shop interior',
              user: { name: 'Studio Photo' }
            }
          ]
        })
      };
    }) as unknown as typeof fetch;

    const photos = await searchThemedUnsplashPhotos({
      query: THEME_PHOTO_QUERY.coiffeur,
      count: 4,
      apiKey: 'test-user-key',
      fetchImpl: fakeFetch
    });

    assert.equal(calls, 1, 'UNE seule recherche par exécution');
    assert.equal(photos.length, 2);
    assert.equal(photos[0]!.url, canonicalUnsplashPhotoUrl('photo-abc123'));
    assert.equal(photos[1]!.url, canonicalUnsplashPhotoUrl('photo-def456'));
    assert.ok(capturedUrl.includes('query=barber%20shop%20men%20haircut'));
    assert.ok(!capturedUrl.includes('test-user-key'), 'clé jamais dans l’URL');
    const headers = (capturedInit?.headers ?? {}) as Record<string, string>;
    assert.equal(headers.Authorization, 'Client-ID test-user-key');
  });

  it('9. sans clé utilisateur → zéro appel réseau (byte-identique)', async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      throw new Error('ne doit jamais être appelé');
    }) as unknown as typeof fetch;
    const photos = await searchThemedUnsplashPhotos({
      query: THEME_PHOTO_QUERY.coiffeur,
      count: 4,
      apiKey: '   ',
      fetchImpl: fakeFetch
    });
    assert.deepEqual(photos, []);
    assert.equal(calls, 0);
  });

  it('10. refus HTTP → erreur sans la clé (jamais loggée)', async () => {
    const fakeFetch = (async () => ({
      ok: false,
      status: 401,
      json: async () => ({})
    })) as unknown as typeof fetch;
    await assert.rejects(
      searchThemedUnsplashPhotos({
        query: THEME_PHOTO_QUERY.coiffeur,
        count: 4,
        apiKey: 'super-secret-key',
        fetchImpl: fakeFetch
      }),
      (err: unknown) => {
        const text = String(err);
        assert.ok(!text.includes('super-secret-key'));
        assert.ok(text.includes('401'));
        return true;
      }
    );
  });

  it('10b. call site unique et plafond explicite (pas seulement un défaut)', () => {
    const source = readFileSync(resolve(process.cwd(), 'apps/api/src/routes/conversation.ts'), 'utf8');
    const calls = source.match(/await searchThemedUnsplashPhotos\(\{/g) ?? [];
    assert.equal(calls.length, 1, 'une seule recherche dans la route de conversation');
    assert.match(source, /timeoutMs: UNSPLASH_SEARCH_TIMEOUT_MS/);
  });
});

describe('Studio — refus honnêtes (source livré)', () => {
  const studio = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');

  function sliceFrom(marker: string, length: number): string {
    const index = studio.indexOf(marker);
    assert.ok(index >= 0, 'marqueur absent : ' + marker);
    return studio.slice(index, index + length);
  }

  it('11. executeSaveCode est asynchrone et exige une écriture serveur confirmée', () => {
    const body = sliceFrom('async function executeSaveCode()', 8000);
    assert.match(body, /files\/content/);
    assert.match(body, /method: 'PUT'/);
    assert.match(body, /modifications NON enregistrées/);
    assert.match(body, /LOCALEMENT \(projet non synchronisé\)/);
    assert.ok(!body.includes('FileStore synchronisé'));
  });

  it('12. les générateurs legacy morts ont été retirés du Studio', () => {
    assert.ok(!studio.includes('function generateInstantApp('), 'routeur instantané encore présent');
    assert.ok(!studio.includes('function generateEngineeringPlan('), 'plan engine legacy encore présent');
    assert.ok(!studio.includes('async function executePlanAction('), 'exécuteur de plan legacy encore présent');
    assert.ok(!studio.includes('function dismissPlanAction('), 'archive de plan legacy encore présente');
    assert.ok(!studio.includes('window.activeEngineeringPlans'), 'registre de plans legacy encore présent');
  });

  it('13. autoHarmonizeApp n’annonce plus un succès sans correction réelle', () => {
    const body = sliceFrom('async function autoHarmonizeApp()', 24000);
    assert.match(body, /Aucune correction appliquée/);
    assert.match(body, /files\/content/);
    assert.match(body, /Corrections refusées par le serveur/);
    const globalOldSuccess = [
      'Harmonisation locale appliquée',
      "Corrections d'audit appliquées avec succès",
      'FileStore synchronisé',
      'Plan approuvé et exécuté avec succès'
    ];
    for (const old of globalOldSuccess) {
      assert.ok(!studio.includes(old), 'ancien faux succès encore présent : ' + old);
    }
  });
});
