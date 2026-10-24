/**
 * PATCH SECTEUR-LIBRE (22/10/2026) — requête photo dérivée du texte.
 *
 * Preuves exigées :
 *  - un métier du lexique produit SA requête (caserne, plombier, ébéniste…) ;
 *  - l'expression la plus SPÉCIFIQUE gagne (« salle de sport » > « coach ») ;
 *  - accents/casse indifférents (fold), négations retirées ;
 *  - sujet hors lexique → null (repli générique chez l'appelant, jamais un
 *    métier inventé) ;
 *  - invariants de table : requêtes sobres (3-6 mots anglais, minuscules,
 *    jamais d'URL ni de photo-ID), motifs foldés ;
 *  - déterminisme strict (même texte → même résultat).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSectorPhotoQuery, SECTOR_QUERY_ENTRIES } from '../../src/image/sector-queries.js';

describe('deriveSectorPhotoQuery — lexique métiers déterministe', () => {
  it('1. caserne de pompier → requête pompier (texte libre, accents/casse ignorés)', () => {
    assert.equal(deriveSectorPhotoQuery("crée in site d'une caserne de pompier"), 'firefighter fire station rescue');
    assert.equal(deriveSectorPhotoQuery('CASERNE DE POMPIERS VOLONTAIRES'), 'firefighter fire station rescue');
  });

  it('2. métiers du bâtiment : plombier, ébéniste, couvreur', () => {
    assert.equal(deriveSectorPhotoQuery('un site pour un plombier chauffagiste'), 'plumber pipes bathroom repair');
    assert.equal(deriveSectorPhotoQuery('CRÉER UN SITE POUR UN ÉBÉNISTE'), 'cabinetmaker fine furniture wood');
    assert.equal(deriveSectorPhotoQuery('entreprise de couverture et toiture'), 'roofer roof tiles work');
  });

  it('3. l’expression la plus spécifique l’emporte (salle de sport > coach sportif)', () => {
    assert.equal(
      deriveSectorPhotoQuery('salle de sport avec coach sportif et cours collectifs'),
      'gym fitness training weights'
    );
  });

  it('4. négation : « sans photos de pompier » ne dérive aucun métier', () => {
    assert.equal(deriveSectorPhotoQuery('un site sans photos de pompier ni camion'), null);
  });

  it('5. sujet hors lexique → null (repli générique, aucune invention)', () => {
    assert.equal(deriveSectorPhotoQuery('site pour un collectionneur de timbres rares'), null);
    assert.equal(deriveSectorPhotoQuery(''), null);
  });

  it('6. déterminisme : deux appels identiques → résultat identique', () => {
    const text = 'création du site d’un fleuriste';
    assert.equal(deriveSectorPhotoQuery(text), deriveSectorPhotoQuery(text));
    assert.equal(deriveSectorPhotoQuery(text), 'florist flower shop bouquet');
  });

  it('7. invariants de table : requêtes sobres, motifs foldés, aucune URL/ID', () => {
    assert.ok(SECTOR_QUERY_ENTRIES.length >= 100, 'lexique réellement fourni (>= 100 entrées)');
    for (const entry of SECTOR_QUERY_ENTRIES) {
      assert.match(entry.pattern, /^[a-z0-9 |'-]+$/, `motif foldé : ${entry.pattern}`);
      const words = entry.query.split(' ');
      assert.ok(words.length >= 3 && words.length <= 6, `3-6 mots : ${entry.query}`);
      assert.match(entry.query, /^[a-z ]+$/, `minuscules ASCII : ${entry.query}`);
      assert.ok(!/https?:|photo-|www\./i.test(entry.query), `jamais d URL/ID : ${entry.query}`);
    }
  });
});
