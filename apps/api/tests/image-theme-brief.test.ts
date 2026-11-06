/**
 * PATCH P0 — PERTINENCE DES IMAGES : thème détecté côté serveur + brief
 * visuel par section injecté en création ET modification.
 *
 * Limite avouée : ces tests prouvent la DÉTECTION et les RÈGLES (texte/URL),
 * jamais le contenu réel des pixels (aucun modèle de vision ici).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANIMALIER_DOG_ID,
  allVerifiedUnsplashIds,
  buildImageBrief,
  buildSectorContract,
  detectImageTheme,
  extractSectionImages,
  IMAGE_THEMES,
  pageTitleHint,
  THEME_IMAGE_RESOURCES,
  type ImageTheme,
} from '../../../packages/core/src/image/theme.js';

describe('P0 — détection du thème (9 catégories)', () => {
  const cases: Array<[string, ImageTheme]> = [
    ['crée un site pour mon restaurant italien', 'restaurant'],
    ['I need a website for my hotel in Nice', 'hotel'],
    ['site vitrine pour ma clinique dentaire', 'clinique'],
    ['garage automobile réparation et vidange', 'garage'],
    ['boutique de vêtements en ligne', 'boutique'],
    ['landing page SaaS avec dashboard analytics', 'saas'],
    ['site pour mon chien et mon chat', 'animalier'],
    ['book an appointment at the vet clinic', 'animalier'],
    ['crée une gelateria artisanale', 'gelato'],
    // LOT MÉTIERS (30/10) — les 5 nouveaux secteurs mappés
    ['crée un site vitrine d\'une boucherie', 'boucherie'],
    ['dépannage chauffe-eau et fuite plombier', 'plombier'],
    ['serrurier urgence porte claquée et cylindre', 'serrurier'],
    ['pâtissière entremets et macarons maison', 'patisserie'],
    ['cordonnier ressemelage et réparation cuir', 'cordonnier'],
  ];
  for (const [prompt, expected] of cases) {
    it(`« ${prompt.slice(0, 40)}… » → ${expected}`, () => {
      assert.equal(detectImageTheme(prompt), expected);
    });
  }
  it('expose exactement 17 thèmes (LOT MÉTIERS : + boucherie, plombier, serrurier, patisserie, cordonnier)', () => {
    assert.deepEqual(
      [...IMAGE_THEMES].sort(),
      [
        'animalier', 'autre', 'avocat', 'boutique', 'boucherie', 'clinique',
        'cordonnier', 'coiffeur', 'garage', 'gelato', 'hotel', 'immobilier',
        'patisserie', 'plombier', 'restaurant', 'saas', 'serrurier',
      ].sort(),
    );
  });
  it('LOT MÉTIERS — long tail : un métier du lexique reçoit un SUJET IMPOSÉ, jamais le pool neutre', () => {
    const brief = buildImageBrief('autre', 'create', 0, { subjectHint: 'fleuriste' });
    assert.match(brief, /sujet imposé du métier \(détecté côté serveur\) : « fleuriste »/);
    assert.match(brief, /laisse la section SANS image/);
    assert.doesNotMatch(brief, /RÉSERVOIR/, 'aucun réservoir listé pour le sujet imposé');
    assert.doesNotMatch(brief, /photo-[0-9]/, 'aucun ID du pool neutre recraché');
    // sans hint : comportement historique inchangé (pool neutre)
    assert.match(buildImageBrief('autre', 'create'), /RÉSERVOIR vérifié/);
  });
  it('LOT COIFFEUR : la barbierie gagne contre un <title> résiduel « cuisine » (preuve proj_ilamxm3di)', () => {
    // Le site barbier portait encore le titre « Authentic Italian Cuisine »
    // (résidu d'un ancien thème) : 'cuisine' captait 'restaurant' et des
    // photos de plats étaient livrées. L'exclusion coiffeur → restaurant
    // rend à la demande son secteur, sans toucher au reste du scoring.
    assert.equal(detectImageTheme('crée un site de coiffeur homme', 'Authentic Italian Cuisine'), 'coiffeur');
    assert.equal(detectImageTheme('Ajouter des photos de coiffures masculines', 'Authentic Italian Cuisine'), 'coiffeur');
    assert.equal(detectImageTheme('site pour un salon de coiffure pour hommes'), 'coiffeur');
    assert.equal(detectImageTheme('I need a website for my barbershop'), 'coiffeur');
    // 2e passe (essais vécus 21:45) : « Ajoute des photos de coupe homme »
    // — le vocabulaire « coupe … » du client doit gagner, pas le titre périmé.
    assert.equal(detectImageTheme('Ajoute des photos de coupe homme', 'Authentic Italian Cuisine'), 'coiffeur');
    assert.equal(detectImageTheme('coupe pour hommes et taille de barbe'), 'coiffeur');
    // Le h1 réel de la page complète un <title> périmé (demande vague incluse).
    const barberHtml = '<html><head><title>Authentic Italian Cuisine</title></head><body><h1>Barbierie Élégance</h1><p>L\'art de la coupe pour hommes</p></body></html>';
    assert.equal(detectImageTheme('Ajoute des photos de coupe homme', pageTitleHint(barberHtml)), 'coiffeur');
    assert.equal(detectImageTheme('change les photos', pageTitleHint(barberHtml)), 'coiffeur');
    // Garde-fous : un barbecue n'est PAS un barbier, « coupe » seule non plus ;
    // les secteurs restent intacts.
    assert.equal(detectImageTheme('restaurant barbecue américain'), 'restaurant');
    assert.equal(detectImageTheme('pizzeria napolitaine'), 'restaurant');
    assert.equal(detectImageTheme('la coupe du monde approche'), 'autre');
  });
});

describe('P0 — synonymes et ambiguïtés', () => {
  it('synonymes FR/EN : bistrot, pizzeria, car repair, clothes shop', () => {
    assert.equal(detectImageTheme('bistrot parisien cosy'), 'restaurant');
    assert.equal(detectImageTheme('pizzeria napolitaine'), 'restaurant');
    assert.equal(detectImageTheme('car repair and maintenance'), 'garage');
    assert.equal(detectImageTheme('clothes shop downtown'), 'boutique');
  });
  it('mots entiers : auto ne matche pas automatique', () => {
    assert.equal(detectImageTheme('générateur automatique de devis'), 'autre');
  });
  it('ambigu sans signal → autre (jamais imposé)', () => {
    assert.equal(detectImageTheme('change le header en vert'), 'autre');
    assert.equal(detectImageTheme('bonjour'), 'autre');
    assert.equal(detectImageTheme(''), 'autre');
  });
  it('ex æquo → autre (clinique vétérinaire : 1-1)', () => {
    assert.equal(detectImageTheme('clinique vétérinaire'), 'autre');
  });
  it('P1 gelato : activité principale — gelateria avec produits salés reste gelato', () => {
    // L'activité NOMMÉE gagne : les produits salés d'appoint ne sont pas
    // des rivaux (décision utilisateur — pas de faux positif inverse).
    assert.equal(
      detectImageTheme('Gelateria La Bella : gelato artisanal, cornets, paninis et sandwichs salés'),
      'gelato',
    );
    assert.equal(detectImageTheme('bar à glaces et glaces à l\'italienne au port'), 'gelato');
    assert.equal(detectImageTheme('glacier artisanal, sorbets et sundaes maison'), 'gelato');
  });
  it('P1 gelato : faux positifs bloqués — l\'activité dominante reste restaurant/autre', () => {
    // Rival présent (activité principale concurrente) → jamais gelato.
    assert.equal(detectImageTheme('pizzeria avec carte de gelatos'), 'restaurant');
    assert.equal(detectImageTheme('snack-glacier du port, burgers et glaces'), 'restaurant');
    assert.equal(detectImageTheme('restaurant avec glaces en dessert'), 'restaurant');
    assert.equal(detectImageTheme('boulangerie avec sorbet maison l\'été'), 'restaurant');
    // « glacier » seul (montagne) = 1 medium, jamais deux → autre.
    assert.equal(detectImageTheme('randonnée au glacier d\'Argentière'), 'autre');
  });
  it('le titre de page en contexte départage (demande vague)', () => {
    assert.equal(detectImageTheme('change les couleurs', 'Garage Moderne — Accueil'), 'garage');
  });
});

describe('P0 — brief visuel par section (création)', () => {
  it('restaurant : rôles hero/cartes/galerie + IDs imposés, sans invention', () => {
    const brief = buildImageBrief('restaurant', 'create');
    assert.match(brief, /hero/);
    assert.match(brief, /galerie/);
    assert.match(brief, /cartes/);
    for (const id of THEME_IMAGE_RESOURCES.restaurant.unsplash) {
      assert.ok(brief.includes(id), 'ID imposé présent : ' + id);
    }
    assert.match(brief, /loremflickr/);
    assert.match(brief, /RÉSERVOIR vérifié/);
    // aucun ID hors table vérifiée
    const ids = [...brief.matchAll(/photo-[a-z0-9-]+/gi)].map((m) => m[0]);
    const allowed = new Set(allVerifiedUnsplashIds());
    for (const id of ids) assert.ok(allowed.has(id), 'ID non inventé : ' + id);
  });
  it('T0.5 — thème autre : réservoir d\'ambiance neutre vérifié imposé (plus de picsum conseillé)', () => {
    const brief = buildImageBrief('autre', 'create');
    assert.match(brief, /RÉSERVOIR vérifié/);
    for (const id of THEME_IMAGE_RESOURCES.autre.unsplash) {
      assert.ok(brief.includes(id), 'ID T0.5 imposé : ' + id);
    }
    assert.ok(!/picsum\.photos/.test(brief), 'aucune URL picsum conseillée quand un réservoir existe');
    // tout ID cité vient de la table vérifiée globale
    const ids = [...brief.matchAll(/photo-[a-z0-9-]+/gi)].map((m) => m[0]);
    const allowed = new Set(allVerifiedUnsplashIds());
    for (const id of ids) assert.ok(allowed.has(id), 'ID non inventé : ' + id);
  });
});

describe('P0 — rappel en modification (préservation)', () => {
  it('le brief modify impose préservation + recopie des URLs existantes', () => {
    const brief = buildImageBrief('clinique', 'modify');
    assert.match(brief, /PRÉSERVATION|préserv/i);
    assert.ok(brief.includes('recopie') || brief.includes('recopier'), 'recopie des URLs existantes exigée');
    for (const id of THEME_IMAGE_RESOURCES.clinique.unsplash) {
      assert.ok(brief.includes(id), 'IDs du thème présents aussi en modification');
    }
  });
});

describe('P0 — négatif restaurant/chien (niveau règles, pas pixels)', () => {
  it('le brief restaurant impose des IDs restaurant et jamais le chien', () => {
    const brief = buildImageBrief('restaurant', 'create');
    assert.ok(!brief.includes(ANIMALIER_DOG_ID), 'le chien du réservoir n’est pas imposé au restaurant');
    assert.ok(THEME_IMAGE_RESOURCES.restaurant.unsplash.length >= 2, 'au moins 2 photos à sujet');
  });
  it('le chien reste imposé en animalier uniquement', () => {
    assert.ok(buildImageBrief('animalier', 'create').includes(ANIMALIER_DOG_ID));
  });
});

describe('LOT B (17/10) — briefs/contrats des secteurs immobilier et avocat', () => {
  it('immobilier : réservoir vérifié imposé, AUCUN resort hôtelier proposé', () => {
    const brief = buildImageBrief('immobilier', 'create');
    for (const id of THEME_IMAGE_RESOURCES.immobilier.unsplash) {
      assert.ok(brief.includes(id), 'ID immo imposé : ' + id);
    }
    assert.ok(!brief.includes('photo-1582719508461-905c673771fd'), 'le resort hôtelier n est jamais proposé en immobilier');
    const contract = buildSectorContract('immobilier', 'create');
    assert.match(contract, /immobilier/i);
    assert.match(contract, /Planifier une visite/, 'CTA métier immobilier présent');
  });
  it('avocat : réservoir solennel + contrat juridique ; aucun chien, aucune nourriture imposée', () => {
    const brief = buildImageBrief('avocat', 'create');
    for (const id of THEME_IMAGE_RESOURCES.avocat.unsplash) {
      assert.ok(brief.includes(id), 'ID avocat imposé : ' + id);
    }
    assert.ok(!brief.includes(ANIMALIER_DOG_ID), 'jamais d animali imposed au juridique');
    const contract = buildSectorContract('avocat', 'create');
    assert.match(contract, /avocat/i);
    assert.match(contract, /Prendre rendez-vous/, 'CTA métier juridique présent');
    assert.match(contract, /JAMAIS de couleurs vives/, 'sobriété juridique imposée');
  });
});

describe('P0 — traçabilité projet × section (extractSectionImages)', () => {
  it('associe chaque URL à sa section, rien d’autre', () => {
    const html = '<html><body>'
      + '<div class="vibe-stitched" data-section="hero"><section><img src="https://images.unsplash.com/a"><img src="https://picsum.photos/seed/x/1"></section></div>'
      + '<div class="vibe-stitched" data-section="footer"><footer>sans image</footer></div>'
      + '</body></html>';
    assert.deepEqual(extractSectionImages(html), [
      { section: 'hero', src: 'https://images.unsplash.com/a' },
      { section: 'hero', src: 'https://picsum.photos/seed/x/1' },
    ]);
  });
  it('gère guillemets simples et src vide', () => {
    const html = '<div data-section="menu"><img src=\'https://x.test/i.png\'><img></div>';
    assert.deepEqual(extractSectionImages(html), [{ section: 'menu', src: 'https://x.test/i.png' }]);
  });
});

describe('LOT COIFFEUR (18/10) — réservoir barbier vérifié', () => {
  it('réserve coiffeur : ≥10 photos uniques, aucun plat, contrat métier transmis', () => {
    const pool = THEME_IMAGE_RESOURCES.coiffeur.unsplash;
    assert.ok(pool.length >= 10, 'au moins 10 photos à sujet');
    assert.equal(new Set(pool).size, pool.length, 'aucun doublon');
    const brief = buildImageBrief('coiffeur', 'create');
    for (const id of pool) assert.ok(brief.includes(id), 'ID coiffeur imposé : ' + id);
    assert.ok(!brief.includes(THEME_IMAGE_RESOURCES.restaurant.unsplash[0]!), 'aucun plat sur un site de barbier');
    const contract = buildSectorContract('coiffeur', 'create');
    assert.match(contract, /coiffeur|barbier/i);
    assert.match(contract, /Réserver un créneau|Prendre rendez-vous/, 'CTA métier coiffeur présent');
  });
});
