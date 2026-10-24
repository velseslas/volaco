/**
 * PATCH PERTINENCE (patch C) — la CONFORMITÉ d'une URL Unsplash vérifiée ne
 * prouve PAS sa PERTINENCE de sujet. Ce fichier verrouille les 10 exigences
 * du mandat :
 *  1-5 : détection ciblée + réécriture (avocat, dentiste, université,
 *        immobilier, laboratoire de contrôle qualité) ;
 *  6-7 : préservation des images conformes + idempotence stricte ;
 *  8   : la SÉCURITÉ reste inchangée (refus React / réécriture chat) ;
 *  9   : UNE règle commune chat HTML / React + rotation seedée déterministe ;
 *  10  : modification / réparation : pas de réintroduction hors secteur.
 * Unitaire pur : aucun serveur, aucune IA, aucun réseau ; dist/ intact.
 */
process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImageBrief,
  detectImageTheme,
  poolRotationSeed,
  rotatePool,
  THEME_IMAGE_RESOURCES,
  thematicImageRewrite,
  unsplashThemeOf,
} from '../../../packages/core/src/image/theme.js';
import {
  formatImageViolations,
  inspectAppImageSources,
} from '../../../packages/core/src/image/app-policy.js';
import { sanitizeImageSources } from '../src/routes/conversation.js';

const PIZZA = 'photo-1513104890138-7c749659a591';      // pool restaurant (1er)
const BURGER = 'photo-1568901346375-23c9450c58cd';     // hors réservoir (lot B : remplacé par des plats)
const GARAGE = 'photo-1494976388531-d1058494cdd8';    // pool garage (1er)
const CLINIQUE_A = 'photo-1576091160399-112ba8d25d1d';  // pool clinique (1er)
const LEGACY_SALON = 'photo-1560066984-138dadb4c035';   // LEGACY (coiffure, sans thème)
const RESTO_POOL = THEME_IMAGE_RESOURCES.restaurant.unsplash;
const CLINIQUE_POOL = THEME_IMAGE_RESOURCES.clinique.unsplash;
const AUTRE_POOL = THEME_IMAGE_RESOURCES.autre.unsplash;
const AVOCAT_POOL = THEME_IMAGE_RESOURCES.avocat.unsplash;   // lot B (17/10)
const IMMO_POOL = THEME_IMAGE_RESOURCES.immobilier.unsplash; // lot B (17/10)

const QUAL = '?auto=format&fit=crop&w=1200&q=80';
const img = (id: string): string => `<img src="https://images.unsplash.com/${id}${QUAL}" alt="vérifiée">`;
const htmlOf = (...ids: string[]): string =>
  `<!DOCTYPE html><html><head><title>Site</title></head><body>${ids.map(img).join('\n')}</body></html>`;

/** IDs Unsplash littéraux présents dans un contenu (HTML ou TSX). */
function unsplashIds(text: string): string[] {
  const out: string[] = [];
  const re = /photo-[A-Za-z0-9-]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[0] ?? '');
  return [...new Set(out.filter((v) => v.length > 0))];
}

describe('PATCH PERTINENCE — détection ciblée (faux positifs sectoriels)', () => {
  it('5a. « laboratoire de contrôle qualité » n est PAS garage (→ autre/neutre)', () => {
    const theme = detectImageTheme('Site du laboratoire de contrôle qualité MetroTest — analyses métrologie');
    assert.notEqual(theme, 'garage');
    assert.equal(theme, 'autre');
    // régression préservée : un VRAI garage reste garage
    assert.equal(detectImageTheme('garage automobile — réparation entretien vidange pneus'), 'garage');
  });

  it('5b. « agence immobilière » n est PAS restaurant ni hôtel (lot B : c est Immobilier)', () => {
    const theme = detectImageTheme(
      'Agence immobilière de la Presqu île — vente, location d appartements T3 avec cuisine équipée'
    );
    assert.notEqual(theme, 'restaurant');
    assert.notEqual(theme, 'hotel');
    assert.equal(theme, 'immobilier', 'lot B : le secteur a son thème et son réservoir');
    // régression préservée : un vrai restaurant reste restaurant
    assert.equal(detectImageTheme('bistrot parisien cosy'), 'restaurant');
  });

  it('5c. « cabinet d avocat » n est PAS clinique — et il a son thème (lot B)', () => {
    const theme = detectImageTheme('Cabinet Martel, avocat en droit des sociétés — consultations');
    assert.notEqual(theme, 'clinique');
    assert.equal(theme, 'avocat', 'lot B : les mots avocat/droit créditent le secteur juridique');
    // régression préservée : cabinet médical/dentaire reste clinique
    assert.equal(detectImageTheme('cabinet dentaire à Annecy'), 'clinique');
    assert.equal(detectImageTheme('cabinet médical Arcachon'), 'clinique');
  });
});

describe('PATCH PERTINENCE — réécriture thématique (chat HTML et React)', () => {
  it('1. cabinet d avocat : la pizza ne passe pas (→ réservoir avocat, lot B)', () => {
    const theme = detectImageTheme('Cabinet Martel, avocat en droit des sociétés');
    assert.equal(theme, 'avocat');
    const step = thematicImageRewrite(htmlOf(PIZZA), theme);
    assert.equal(step.rewrites, 1, 'la pizza est réécrite');
    assert.ok(!step.content.includes(PIZZA), 'plus aucune image restaurant');
    for (const id of unsplashIds(step.content)) {
      assert.ok(AVOCAT_POOL.includes(id), 'ID ' + id + ' hors réservoir avocat');
    }
  });

  it('2. dentiste → réservoir clinique (pizza et resort chassés)', () => {
    assert.equal(detectImageTheme('Cabinet dentaire du Parc — implants et consultations'), 'clinique');
    // Le burger a quitté la liste autorisée (lot B) ; le 2e intrus d'un
    // autre secteur est désormais l'ID resort hôtelier (autorisé mais
    // HORS secteur santé) — exactement la sémantique testée ici.
    const step = sanitizeImageSources(htmlOf(PIZZA, 'photo-1582719508461-905c673771fd'), 'clinique');
    assert.equal(step.replaced, 0, 'aucune URL interdite : la sécurité ne compte rien');
    assert.equal(step.thematicRewrites, 2, 'deux images d un autre secteur réécrites');
    assert.ok(!step.html.includes(PIZZA), 'pizza absente');
    assert.ok(!step.html.includes('photo-1582719508461-905c673771fd'), 'resort absent');
    for (const id of unsplashIds(step.html)) {
      assert.ok(CLINIQUE_POOL.includes(id), 'ID hors pool clinique : ' + id);
    }
  });

  it('3. université → réservoir neutre, JAMAIS restaurant', () => {
    assert.equal(detectImageTheme('Faculté des sciences — Université de Lyon, parcours et admission'), 'autre');
    const step = sanitizeImageSources(htmlOf(PIZZA), 'autre');
    assert.equal(step.replaced, 0);
    assert.equal(step.thematicRewrites, 1);
    const ids = unsplashIds(step.html);
    assert.ok(!ids.includes(PIZZA), 'plus de pizza sur un site universitaire');
    for (const id of ids) {
      assert.ok(!RESTO_POOL.includes(id), 'aucun ID restaurant sur université');
      assert.ok(AUTRE_POOL.includes(id), 'ID du réservoir neutre');
    }
  });

  it('4. immobilier : même avec « cuisine équipée », les images restaurant partent', () => {
    const theme = detectImageTheme('Agence immobilière — appartements T3 avec cuisine équipée');
    assert.notEqual(theme, 'restaurant');
    const step = thematicImageRewrite(htmlOf(PIZZA, BURGER), theme);
    assert.ok(step.rewrites >= 1, 'au moins une réécriture');
    for (const id of unsplashIds(step.content)) {
      assert.ok(!RESTO_POOL.includes(id), 'aucune image restaurant conservée');
    }
  });

  it('5d. laboratoire de contrôle qualité : l image garage est réécrite vers le neutre', () => {
    const theme = detectImageTheme('Laboratoire de contrôle qualité MetroTest');
    assert.equal(theme, 'autre');
    const step = thematicImageRewrite(htmlOf(GARAGE), theme);
    const ids = unsplashIds(step.content);
    assert.ok(!ids.includes(GARAGE), 'image garage réécrite');
    assert.ok(AUTRE_POOL.includes(ids[0] ?? ''), 'remplacée par le neutre');
  });

  it('6. restaurant : ses images pertinentes sont INTACTES (0 réécriture)', () => {
    assert.equal(detectImageTheme('bistrot parisien cosy'), 'restaurant');
    const avant = htmlOf(PIZZA, 'photo-1555939594-58d7cb561ad1');
    const step = thematicImageRewrite(avant, 'restaurant');
    assert.equal(step.rewrites, 0, 'aucune image conforme touchée');
    assert.equal(step.content, avant);
  });

  it('7. image déjà conforme : inchangée + idempotence stricte', () => {
    const src = htmlOf(CLINIQUE_A);
    const first = thematicImageRewrite(src, 'clinique');
    assert.equal(first.rewrites, 0);
    assert.equal(first.content, src);
    const second = thematicImageRewrite(first.content, 'clinique');
    assert.equal(second.rewrites, 0, 'second passage : aucune réécriture');
    assert.equal(second.content, first.content, 'aucun changement de contenu');
  });

  it('8. la SÉCURITÉ reste intacte : interdit refusé (React) et réécrit (chat)', () => {
    // (a) React : la barrière L2 (app-policy) refuse toujours l hôte interdit
    const inspection = inspectAppImageSources([{
      path: 'src/App.tsx',
      content: 'export default function App() {\n'
        + '  return (\n'
        + '    <img src="https://loremflickr.com/1200/800/room" alt="x" />\n'
        + '  );\n'
        + '}\n'
    }]);
    assert.equal(inspection.violations.length, 1, 'clean n est PAS déclaré pour un interdit');
    assert.equal(inspection.violations[0]!.kind, 'img-src');
    assert.match(formatImageViolations(inspection).join('\n'), /loremflickr/);
    // (b) chat : le sanitizer réécrit VERS LE THÈME, sans confondre les deux
    // mécanismes (replaced = sécurité ; thematicRewrites = pertinence).
    const step = sanitizeImageSources(
      '<!DOCTYPE html><body><img src="https://loremflickr.com/1200/800/food" alt="hors réservoir">'
        + img(PIZZA) + '</body>',
      'clinique'
    );
    assert.ok(!step.html.includes('loremflickr'), 'hôte interdit parti');
    assert.equal(step.replaced, 1, 'UNE réécriture de SÉCURITÉ');
    assert.equal(step.thematicRewrites, 1, 'UNE réécriture de PERTINENCE (la pizza)');
    for (const id of unsplashIds(step.html)) {
      assert.ok(CLINIQUE_POOL.includes(id), 'les deux images finissent dans le pool clinique');
    }
  });
});

describe('PATCH PERTINENCE — rotation déterministe et cohérence multi-parcours', () => {
  it('9a. rotation seedée : stable pour une même clé, variable entre clés, 0 = historique', () => {
    assert.equal(rotatePool(CLINIQUE_POOL, 0)[0], CLINIQUE_A, 'seed 0 = ordre historique');
    assert.equal(rotatePool(CLINIQUE_POOL, 1)[0], CLINIQUE_POOL[1], 'offset = seed % longueur');
    assert.equal(poolRotationSeed('req-a'), poolRotationSeed('req-a'), 'déterministe');
    assert.notEqual(poolRotationSeed('req-a'), poolRotationSeed('req-b'), 'clés distinctes → seeds distincts');
  });

  it('9b. UNE seule règle : chat (HTML) et React (TSX) → même image de remplacement', () => {
    const seed = poolRotationSeed('generation-coherence');
    const tsx = 'export default function App() {\n'
      + '  return (\n'
      + `    <img src={"https://images.unsplash.com/${PIZZA}${QUAL}"} alt="a" />\n`
      + '  );\n'
      + '}\n';
    const a = thematicImageRewrite(tsx, 'clinique', seed);
    const b = thematicImageRewrite(htmlOf(PIZZA), 'clinique', seed);
    const idsA = unsplashIds(a.content);
    const idsB = unsplashIds(b.content);
    assert.deepEqual(idsA, idsB, 'même cible dans les deux parcours');
    assert.equal(idsA.length, 1);
    assert.ok(CLINIQUE_POOL.includes(idsA[0] ?? ''), 'remplacée par le réservoir clinique');
    assert.equal(unsplashThemeOf(idsA[0] ?? ''), 'clinique', 'sujet = thème courant');
  });

  it('9c. le brief seedé reste EXCLUSIF au réservoir et change seulement d ordre', () => {
    const briefS = buildImageBrief('restaurant', 'create', poolRotationSeed('gen-x'));
    for (const id of RESTO_POOL) {
      assert.ok(briefS.includes(id), 'tous les IDs restent proposés : ' + id);
    }
    assert.equal(buildImageBrief('restaurant', 'create'), buildImageBrief('restaurant', 'create'), 'pur et déterministe');
    assert.equal(rotatePool(RESTO_POOL, 3)[0], RESTO_POOL[3], 'l ordre tourne de seed % longueur');
    assert.equal(rotatePool(RESTO_POOL, 0)[0], PIZZA, 'seed 0 = pizza en tête (ordres historiques inchangés)');
  });
});

describe('PATCH PERTINENCE — modification / réparation sans réintroduction', () => {
  it('10a. une pizza rajoutée sur un site clinique est remplacée SANS dupliquer la conforme', () => {
    const candidatEdite = htmlOf(CLINIQUE_A, PIZZA);
    const step = thematicImageRewrite(candidatEdite, 'clinique');
    const ids = unsplashIds(step.content);
    assert.ok(!ids.includes(PIZZA), 'pizza chassée');
    assert.ok(ids.includes(CLINIQUE_A), 'image conforme préservée');
    assert.ok(ids.includes(CLINIQUE_POOL[1] ?? ''), 'le remplacement prend un ID dispo (pas de duplication)');
  });

  it('10b. brief modify clinique : aucune image restaurant proposée', () => {
    const brief = buildImageBrief('clinique', 'modify');
    assert.ok(!brief.includes(PIZZA));
    assert.ok(!brief.includes(BURGER));
    assert.ok(brief.includes(CLINIQUE_A), 'brief modify = réservoir clinique');
  });

  it('10c. LEGACY (ID sans thème garanti) : réécrit vers le secteur courant', () => {
    assert.equal(unsplashThemeOf(LEGACY_SALON), null, 'aucune étiquette de sujet pour LEGACY');
    const step = thematicImageRewrite(htmlOf(LEGACY_SALON), 'clinique');
    assert.equal(step.rewrites, 1, 'remplacé');
    assert.ok(CLINIQUE_POOL.includes(unsplashIds(step.content)[0] ?? ''), 'cible = pool clinique');
  });
});

describe('LOT B (17/10) — détection : négations, chambre→immobilier, algérien', () => {
  it('B1. « Aucune image de restaurant… » d un LABO ne crée PAS restaurant (preuve utilisateur)', () => {
    const theme = detectImageTheme(
      'crée un site pour mon laboratoire d\'analyses médicales MetroLab. '
      + 'Aucune image de restaurant, pizza ou burger. Style épuré, blanc, microscope, équipe de techniciens,'
    );
    assert.notEqual(theme, 'restaurant', 'la négation ne doit pas créer le thème interdit');
    assert.equal(theme, 'clinique', 'les mots medical/laboratoire d analyses crédent le secteur santé');
    const step = thematicImageRewrite(htmlOf(PIZZA, BURGER), theme);
    assert.ok(!step.content.includes(PIZZA) && !step.content.includes(BURGER), 'aucune nourriture');
    for (const id of unsplashIds(step.content)) {
      assert.ok(CLINIQUE_POOL.includes(id), 'réserve clinique : ' + id);
    }
  });

  it('B2. « 4 chambres » de l\'AGENCE → immobilier, PAS hotel (preuve resort 1582719…)', () => {
    const theme = detectImageTheme('crée un site pour mon agence : 4 chambres, prix attractif');
    assert.notEqual(theme, 'hotel', 'le mot « chambres » d un site de biens ne fait pas un hôtel');
    assert.equal(theme, 'immobilier');
    const step = thematicImageRewrite(htmlOf('photo-1582719508461-905c673771fd'), theme);
    const ids = unsplashIds(step.content);
    for (const id of ids) {
      assert.ok(IMMO_POOL.includes(id), 'photo immobilière : ' + id);
      assert.notEqual(id, 'photo-1582719508461-905c673771fd', 'plus aucun resort');
    }
  });

  it('B3. le mot « garage » d une annonce immobilière ne reclass pas le site', () => {
    const theme = detectImageTheme('villa 4 chambres avec garage et terrain — agence des coteaux');
    assert.equal(theme, 'immobilier');
  });

  it('B4. restau algérien → restaurant (couscous/tajine crédent la cuisine)', () => {
    assert.equal(detectImageTheme('site pour mon restau algérien : couscous, tajine et chorba maison'), 'restaurant');
    assert.equal(detectImageTheme('traiteur algérien, cuisine fait maison sur commande'), 'restaurant');
    const brief = buildImageBrief('restaurant', 'create');
    for (const id of RESTO_POOL) assert.ok(brief.includes(id), 'brief algérien = réservoir vérifié : ' + id);
  });
});

describe('LOT B (17/10) — déduplication stricte des <img> (11× même photo → interdit)', () => {
  it('D1. 3 fois la même image conforme → 3 IDs du réservoir (ordre roté, seed 0)', () => {
    const src = htmlOf(CLINIQUE_A, CLINIQUE_A, CLINIQUE_A);
    const step = thematicImageRewrite(src, 'clinique');
    const ids = unsplashIds(step.content);
    assert.deepEqual(new Set(ids).size, 3, 'trois positions, trois images différentes');
    assert.ok(ids.includes(CLINIQUE_A), 'le premier porteur est conservé');
    for (const id of ids) assert.ok(CLINIQUE_POOL.includes(id), 'tous du pool clinique');
  });

  it('D2. idempotence : un second passage ne réécrit RIEN (sanitize double flux)', () => {
    const first = thematicImageRewrite(htmlOf(CLINIQUE_A, CLINIQUE_A, CLINIQUE_A), 'clinique');
    const second = thematicImageRewrite(first.content, 'clinique');
    assert.equal(second.rewrites, 0, 'stabilisé au premier passage');
    assert.equal(second.content, first.content, 'contenu inchangé au second passage');
  });

  it('D3. via sanitizeImageSources : les images conformes redondantes partent du HTML final', () => {
    const step = sanitizeImageSources(htmlOf(CLINIQUE_A, CLINIQUE_A, CLINIQUE_A), 'clinique');
    const ids = unsplashIds(step.html);
    assert.deepEqual(new Set(ids).size, 3, 'aucune photo caractérielle répétée');
    const again = sanitizeImageSources(step.html, 'clinique');
    assert.equal(again.thematicRewrites, 0, 'idempotent au 2e passage complet');
  });

  it('D4. images conformes NON dupliquées : préservées verbatim (10a reste vrai)', () => {
    const avant = htmlOf(CLINIQUE_A, 'photo-1559839734-2b71ea197ec2');
    const step = thematicImageRewrite(avant, 'clinique');
    assert.equal(step.rewrites, 0);
    assert.equal(step.content, avant);
  });
});
