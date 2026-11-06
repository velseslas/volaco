/**
 * VibeCode Core — Thème visuel d'un projet (P0 pertinence des images).
 *
 * La pertinence des images reposait à 100 % sur le LLM : le prompt listait
 * un réservoir statique que le modèle ignorait parfois (URLs récitées de
 * mémoire — loremflickr 500 prouvé), et le prompt de modification ne
 * contenait AUCUNE règle image. Ce module rend la machine actrice :
 * détection déterministe du thème, brief visuel par section injecté dans
 * les DEUX prompts, traçabilité projet × révision × section.
 *
 * Règles d'honnêteté appliquées ici même :
 * - les sujets des photos sont documentés par connaissance modèle (IDs
 *   vérifiés vivants par HTTP 200), JAMAIS vérifiés au pixel — un test de
 *   texte ou d'URL ne prouve que les règles, pas le contenu des pixels ;
 * - détection incertaine (ex æquo ou aucun signal) → 'autre', jamais un
 *   thème imposé sans justification.
 */

/** Thèmes : secteurs mappés + sous-thème gelato (P1) + repli générique. */
export type ImageTheme =
  | 'restaurant'
  | 'gelato'
  | 'clinique'
  | 'hotel'
  | 'garage'
  | 'boutique'
  | 'saas'
  | 'animalier'
  | 'immobilier'
  | 'avocat'
  | 'coiffeur'
  | 'boucherie'
  | 'plombier'
  | 'serrurier'
  | 'patisserie'
  | 'cordonnier'
  | 'autre';

export const IMAGE_THEMES: readonly ImageTheme[] = [
  'restaurant',
  'gelato',
  'clinique',
  'hotel',
  'garage',
  'boutique',
  'saas',
  'animalier',
  'immobilier',
  'avocat',
  'coiffeur',
  'boucherie',
  'plombier',
  'serrurier',
  'patisserie',
  'cordonnier',
  'autre',
];

/**
 * Mots-clés FR + EN par thème (minuscules, sans accents — voir fold()).
 * Formes plurielles courantes incluses ; correspondance par MOTS ENTIERS
 * (jamais de sous-chaîne : 'auto' ne matche pas 'automatique').
 */
const THEME_KEYWORDS: Record<Exclude<ImageTheme, 'autre'>, readonly string[]> = {
  // LOT MÉTIERS (30/10) — 'patisserie' RETIRÉ de cette liste : le mot
  // captait ici une demande pâtissière vers restaurant (plats chauds) et
  // créait un ex æquo avec le nouveau thème dédié 'patisserie' (tie →
  // 'autre' = eucalyptus). « boulangerie » reste restaurant ; une demande
  // « boulangerie pâtisserie » reste en ex æquo 'autre' — identique à avant.
  restaurant: [
    'restaurant', 'resto', 'restau', 'bistrot', 'brasserie', 'pizzeria',
    'trattoria', 'boulangerie', 'cuisine', 'gastronomie', 'food', 'dinner',
    'lunch', 'cantine', 'snack', 'kebab', 'sushi', 'burger', 'burgers',
    'pizza', 'pizzas', 'café', 'cafe', 'traiteur', 'menu',
    'menus', 'recette', 'recettes', 'bar', 'couscous', 'tajine', 'chorba',
    'mechoui', 'baklava', 'sorbet', 'sorbets',
  ],
  // P1 gelato : VOLONTAIREMENT VIDE ici. Le gelato ne peut être attribué
  // QUE par la pré-pass dédiée (GELATO_STRONG/MEDIUM/RIVALS ci-dessus) :
  // ajouter des mots gelato dans le scoring générique créerait des ex æquo
  // du type « pizzeria avec carte de gelatos » → 'autre' (régression) — le
  // tracé générique doit rester exactement celui d'avant le patch.
  gelato: [],
  clinique: [
    'clinique', 'cliniques', 'hopital', 'hôpital', 'medical', 'docteur',
    'doctor', 'sante', 'santé', 'health', 'dentiste', 'dentist', 'dentaire',
    'pharmacie', 'cabinet medical', 'patient', 'patients', 'soin', 'soins',
    'optique', 'medicale', 'medicales', 'analyses medicales', 'therapeutique',
  ],
  hotel: [
    'hotel', 'hotels', 'hôtel', 'hôtels', 'auberge', 'gite', 'gîte', 'gites',
    'resort', 'hebergement', 'hébergement', 'motel', 'palace', 'booking',
    'reservation', 'réservation', 'suite', 'suites', 'lobby', 'star',
    'etoiles', 'star rating', 'sejour',
  ],
  garage: [
    'garage', 'garages', 'mecanicien', 'mécanicien', 'automobile', 'voiture',
    'voitures', 'car', 'cars', 'auto', 'moto', 'pneu', 'pneus', 'carrosserie',
    'vehicule', 'véhicule', 'entretien', 'vidange', 'controle', 'contrôle',
    'atelier',
  ],
  boutique: [
    'boutique', 'boutiques', 'magasin', 'magasins', 'shop', 'store',
    'vetement', 'vetements', 'vêtement', 'vêtements', 'clothing', 'fashion',
    'mode', 'chaussure', 'chaussures', 'shoes', 'bijoux', 'bijouterie',
    'textile', 'pret-a-porter', 'prêt-à-porter',
  ],
  saas: [
    'saas', 'logiciel', 'software', 'application', 'dashboard', 'plateforme',
    'platform', 'startup', 'cloud', 'analytics', 'crm', 'erp', 'kpi',
    'startup', 'tech',
  ],
  animalier: [
    'animal', 'animaux', 'animalier', 'chien', 'chiens', 'dog', 'dogs',
    'chat', 'chats', 'cat', 'cats', 'veterinaire', 'vétérinaire', 'vet',
    'zoo', 'elevage', 'élevage', 'pet', 'pets', 'toilettage', 'refuge',
    'adoption',
  ],
  // LOT B (17/10) — immobilier : secteur réclamé nominativement (« si je dit
  // agence immobilière je reçois des maisons »). « chambre(s) » CHANGE de
  // camp : c'est le lexique de l'annonce immobilière (preuve utilisateur du
  // 16/10 : « 4 chambres, prix » était captée 'hotel' → resort partout).
  // Un vrai hôtel se décrit toujours par hotel/auberge/gite/booking etc.,
  // jamais par le seul mot « chambres ».
  immobilier: [
    'immobilier', 'immobiliere', 'immobiliers', 'immobilieres', 'immo',
    'agence immobiliere', 'maison', 'maisons', 'villa', 'villas',
    'appartement', 'appartements', 'terrain', 'terrains', 'lotissement',
    'chambre', 'chambres', 'biens', 'bien immobilier', 'gestion locative',
    'compromis de vente', 'frais de notaire', 'real estate', 'property',
    'properties',
  ],
  // LOT B (17/10) — secteurs juridiques : consultation payante, dossier,
  // litige. Sujets complets (pas de repli ambiance générique pour un
  // cabinet qui revendique son identité).
  avocat: [
    'avocat', 'avocats', 'avocate', 'avocates', 'notaire', 'notaires',
    'juriste', 'juristes', 'juridique', 'juridiques', 'justice', 'tribunal',
    'tribunaux', 'litige', 'litiges', 'proces', 'huissier', 'huissiers',
    'barreau', 'droit', 'droits', 'lawyer', 'law firm', 'attorney', 'legal',
  ],
  // LOT COIFFEUR (18/10) — secteur réclamé nominativement (« crée un site de
  // coiffeur homme » → photos de plats : aucun thème barbier n'existait et le
  // <title> résiduel « Authentic Italian Cuisine » faisait gagner 'restaurant'
  // via le seul mot 'cuisine'). Haute précision : rien de générique
  // ('cheveux' seul, 'beauté') — trop communs à d'autres secteurs.
  coiffeur: [
    'coiffeur', 'coiffeurs', 'coiffeuse', 'coiffeuses', 'coiffure',
    'coiffures', 'barbier', 'barbiers', 'barbierie', 'barbieries',
    'barber', 'barbers', 'barbershop', 'barbershops', 'hair salon',
    'haircut', 'haircuts', 'salon de coiffure', 'taille de barbe', 'rasage',
    // 2e passe (18/10, essais vécus) : l'utilisateur écrit « coupe homme »,
    // jamais « coiffeur » — tours de coupe ajoutés (formes pleines).
    'coupe homme', 'coupe hommes', 'coupe pour homme', 'coupe pour hommes',
    'coupe masculine', 'coupe femme', 'coupe femmes', 'coupe pour femme',
    'coupe pour femmes', 'coupe feminine', 'coupe de cheveux', 'coupe cheveux',
    'coupe de barbe', 'couper les cheveux', 'couper la barbe',
  ],
  // LOT MÉTIERS (30/10) — diagnostic « boucherie → eucalyptus » : les
  // métiers hors des secteurs mappés tombaient dans le réservoir « ambiance
  // neutre » car le lexique métiers (sector-queries.ts) ne servait que si
  // l'utilisateur fournissait une clé Unsplash. Les 5 métiers testés en E2E
  // deviennent des secteurs à part entière — discipline coiffeur : AUCUN
  // mot générique (pas de « chaussure », pas de « sanitaire »… trop
  // partagés avec boutique/clinique), formes plurielles pleines, réservoirs
  // examinés au pixel (protocole du diag du 30/10, 34 IDs retenus).
  boucherie: [
    'boucherie', 'boucheries', 'boucher', 'bouchers', 'bouchere', 'boucheres',
    'charcuterie', 'charcuteries', 'charcutier', 'charcutiers',
    'volailler', 'volaillers', 'viande', 'viandes', 'gibier', 'volaille',
  ],
  plombier: [
    'plombier', 'plombiers', 'plomberie', 'tuyauterie', 'tuyau', 'tuyaux',
    'fuite', 'fuites', 'depannage plomberie', 'chauffe-eau',
    'robinet', 'robinets', 'mitigeur', 'mitigeurs',
  ],
  serrurier: [
    'serrurier', 'serruriers', 'serrurerie', 'serrure', 'serrures',
    'cle', 'clef', 'cles', 'clefs', 'cylindre', 'cylindres',
    'porte blindee', 'blindage', 'deblindage', 'volets roulants',
  ],
  patisserie: [
    'patisserie', 'patisseries', 'patissier', 'patissiers',
    'patissiere', 'patissieres', 'entremet', 'entremets',
    'macaron', 'macarons', 'gateau', 'gateaux', 'eclair', 'eclairs',
    'viennoiserie', 'praline', 'pralines', 'tarte', 'tartes',
  ],
  cordonnier: [
    'cordonnier', 'cordonniers', 'cordonnerie', 'cordonneries',
    'ressemelage', 'ressemelages', 'soulier', 'souliers',
    'reparation chaussures', 'reparateur de chaussures',
  ],
};

/**
 * P1 GELATO — sous-thème de l'activité principale glacée. Le vocabulaire
 * du gelato est invisible pour THEME_KEYWORDS.restaurant dont les mots
 * génériques (« bar », « menu », « desserts ») captaient la demande à la
 * place (preuve du 16/10 : « gelateria artisanale, bar à glaces, glaces
 * à l'italienne » était classée restaurant et recevait pizza/burger du
 * réservoir). Pré-pass déterministe, exécutée AVANT le scoring générique :
 *  - STRONG (≥1 hit suffit) : vocabulaire qui NOMME l'activité gelato ;
 *  - MEDIUM (≥2 hits) : lexique secondaire fiable (« glacier » seul peut
 *    désigner un glacier de montagne — les faux positifs restent hors
 *    gelato) ;
 *  - RIVALS (≥1 hit → jamais gelato) : les vraies activités principales
 *    concurrentes. Une gelateria qui propose AUSSI des produits salés
 *    (paninis, sandwichs, crêpes salées) reste gelato : ces mots ne sont
 *    PAS des rivaux — c'est l'activité PRINCIPALE qui décide (décision
 *    utilisateur). Les phrases sont foldées (sans accents) : le matcher
 *    des mots entiers gère les espaces et apostrophes.
 */
const GELATO_STRONG: readonly string[] = [
  'gelateria', 'gelaterias', 'gelato', 'gelatos', 'glaces artisanales',
  'bar a glaces', 'glaces a l\'italienne', 'glacier artisanal',
];
const GELATO_MEDIUM: readonly string[] = [
  'glacier', 'glaciers', 'sorbet', 'sorbetto', 'sundae', 'sundaes',
  'desserts glaces', 'dessert glace', 'carte de glaces', 'cornet',
  'cornets', 'coupe glacee', 'coupes glacees', 'parfait glace',
];
const GELATO_RIVALS: readonly string[] = [
  'restaurant', 'resto', 'pizzeria', 'trattoria', 'bistrot', 'brasserie',
  'boulangerie', 'patisserie', 'kebab', 'sushi', 'burger', 'burgers',
  'pizza', 'pizzas', 'traiteur', 'food', 'snack', 'cantine', 'cuisine',
];

/**
 * LOT B (17/10) — NÉGATIONS : « aucune image de X », « sans X », « pas
 * d'images de X », « éviter les X » — le scorer compte des MOTS, il ne
 * comprend pas la négation. Preuve utilisateur du 16/10 : une demande de
 * site de LABO contenant « Aucune image de restaurant, pizza, burger »
 * était classée 'restaurant' par les seuls mots négatifs → pizzas partout.
 * Traitement : TOUT fragment annoncé en négatif est RETIRÉ du texte scoré
 * (scoring générique, pré-pass gelato ET exclusions — même sémantique :
 * « quand l'utilisateur désactive un sujet, on l'ignore »). Pur,
 * déterministe, FR-ciblé (la demande utilisateur est française).
 * Faux positifs sûrs réexaminés : « pas cher » (pas de entendu, 'pas d'')
 * n'ouvre pas la négation ; « sans gluten » retire un mot inoffensif.
 */
const NEGATION_RE = new RegExp(
  "(^|[^a-z])(sans|aucunes?|aucun|pas de|pas d['’]|eviter|evite|evitez|exclure|proscrire|jamais de)( [^.;:!?\n]{0,90})?",
  'gi'
);

/** Retire les fragments négatifs (Voir NEGATION_RE) d'un texte foldé. */
export function stripNegations(folded: string): string {
  return folded.replace(NEGATION_RE, '$1');
}

/**
 * PATCH PERTINENCE (patch C) — exclusions CIBLÉES de détection : un rival
 * explicite retire un thème du scoring générique, même si un mot-clé large
 * matche. Cas réels documentés par le lot de tests :
 *  - « laboratoire de contrôle qualité » captait 'garage' par le seul mot
 *    'controle' ;
 *  - une annonce immobilière contient presque toujours le radical
 *    « immobili… » et parlait de « cuisine équipée » (faux restaurant) ;
 *  - un cabinet d'avocat n'est PAS un établissement de santé — le mot
 *    'cabinet' seul n'est d'ailleurs plus clinique (cf. THEME_KEYWORDS,
 *    seul « cabinet medical » l'est).
 * Portée volontairement MINIMALE : pas de taxonomie générale (mandat patch).
 */
/**
 * LOT COIFFEUR (2e passe, 18/10) — signaux du métier barbier/coiffeur :
 * radicaux du salon + tours de coupe. Preuves vécues : « Ajoute des photos
 * de coupe homme » (3 essais) sur une page barbier au <title> résiduel
 * « Authentic Italian Cuisine » restait capté par 'restaurant'. 'barbecue'
 * ne contient pas 'barber' ; « coupe du monde / de France » ne matche aucun
 * tour (motif sûr).
 */
const COIFFEUR_SIGNAL_RE = /coiff|barbier|barber|haircut|hair salon|coupe (de )?(cheveux|barbe)|coupe (pour )?(hommes?|femmes?|masculines?|feminines?)|couper (les cheveux|la barbe)/;

const THEME_EXCLUSIONS: ReadonlyArray<{ theme: Exclude<ImageTheme, 'autre'>; pattern: RegExp }> = [
  { theme: 'garage', pattern: /(^|[^a-z])(laboratoires?|labos?)([^a-z]|$)/ },
  { theme: 'restaurant', pattern: /immobili/ },
  {
    theme: 'clinique',
    pattern: /(^|[^a-z])(avocats?|avocates?|notaires?|juridiques?)([^a-z]|$)/,
  },
  // LOT B (17/10) — une agence immobilière parle de « chambres », « garage »,
  // « cuisine » dans ses annonces : ces radicaux ne doivent JAMAIS reclasser
  // le site (preuve du 16/10 : resort exhibé sur une agence par le seul mot
  // « chambres » ; « cuisine équipée » était déjà neutralisée ci-dessus).
  { theme: 'hotel', pattern: /immobili/ },
  { theme: 'garage', pattern: /(^|[^a-z])(immobiliers?|immobilieres?)([^a-z]|$)|gestion locative|compromis de vente/ },
  { theme: 'restaurant', pattern: /(^|[^a-z])(cuisine équipée|cuisine equipee|cuisine ouverte|cuisine amenagee)([^a-z]|$)/ },
  // Un cabinet d'avocat n'est pas un établissement de soin : les radicaux
  // médicaux ne reclassent pas le juridique en clinique (l'inverse — un
  // texte d'avocat qui écarte clinique — est garanti par la règle ci-dessus).
  {
    theme: 'avocat',
    pattern: /(^|[^a-z])(cliniques?|hopital|hopitaux|dentistes?|dentaires?)([^a-z]|$)/,
  },
  // LOT COIFFEUR (18/10) — preuve vécue proj_ilamxm3di : « crée un site de
  // coiffeur homme » puis « Ajouter des photos de coiffures masculines »,
  // page barbier au <title> résiduel « Authentic Italian Cuisine » → le mot
  // 'cuisine' captait 'restaurant' (photos de plats sur un site de barbier).
  // Un salon de coiffure n'est ni un restaurant ni une clinique (« soins de
  // la barbe ») : les radicaux coiffeur/barbier écartent ces thèmes du
  // scoring AVANT les matchs. 'barbecue' ne contient pas 'barber' (motif sûr).
  { theme: 'restaurant', pattern: COIFFEUR_SIGNAL_RE },
  { theme: 'clinique', pattern: COIFFEUR_SIGNAL_RE },
];

export interface ThemeImageResources {
  /** Libellé français du thème (reprise dans le brief et les logs). */
  readonly label: string;
  /** IDs Unsplash vérifiés vivants (HTTP 200) — sujet par connaissance modèle. */
  readonly unsplash: readonly string[];
  /** Seeds picsum de repli, eux aussi thématiques. */
  readonly picsumSeeds: readonly string[];
  /** Rôle visuel du hero pour ce thème. */
  readonly hero: string;
  /** Rôle visuel des cartes/produits pour ce thème. */
  readonly cards: string;
  /** Rôle visuel de la galerie pour ce thème. */
  readonly gallery: string;
}

export const THEME_IMAGE_RESOURCES: Record<ImageTheme, ThemeImageResources> = {
  restaurant: {
    label: 'restaurant',
    // LOT B (17/10) — 3 crans faibles REMPLACÉS après planche-contact vécue :
    // burger/croissant/café-latte ruinaient une demande « restaurant
    // algérien » (preuve proj_mf7ixm5ti). 6 plats vérifiés au pixel les
    // remplacent (grillades mixtes, assiette + bols, assiette sombre,
    // boulettes, steak-frites, plat doré au riz). La pizza reste une place
    // (pizzeria legitime) ; limitation HONÊTE : sujet « plats du monde »,
    // pas encore de pixels couscous/tajine précis (réservoir statique).
    unsplash: [
      'photo-1513104890138-7c749659a591', // pizza (place unique, pizzeria)
      'photo-1555939594-58d7cb561ad1',    // planche de grillades mixtes + sauces
      'photo-1547592180-85f173990554',    // assiette dressée + bols condiments
      'photo-1540189549336-e6e99c3679fe', // grande assiette sombre, salade
      'photo-1529042410759-befb1204b468', // boulettes sur assiette blanche (vérifié au pixel)
      'photo-1600891964092-4316c288032e', // steak-frites de bistrot
      'photo-1559847844-5315695dadae',    // mijoté crevette/carné au riz, sauce riche
      'photo-1476224203421-9ac39bcb3327', // poisson grillé, planche bois, sauce
      'photo-1517244683847-7456b63c5969', // plat doré au riz, service traditionnel
      'photo-1517248135467-4c7edcad34c4', // salle de restaurant, ambiance
      'photo-1414235077428-338989a2e8c0', // dressage fin, verre de vin
      'photo-1490645935967-10de6ba17061', // bol généreux, table
    ],
    picsumSeeds: ['restaurant-dish', 'restaurant-room', 'bakery-bread', 'coffee-cup'],
    hero: 'plan large d’ambiance : salle chaleureuse ou plat signature',
    cards: 'gros plans de plats, produits et spécialités',
    gallery: '3 angles variés : cuisine, salle, détail dressé',
  },
  gelato: {
    label: 'gelateria / artisan glacier',
    // Réservoir vérifié le 2026-10-16 : chaque ID a été REGARDÉ au pixel
    // (vignettes lues une à une) ET testé en GET 200 image/jpeg au format
    // réellement servi (auto=format&fit=crop&w=1200&q=80). Aucun ID n'a été
    // admis sur la foi d'un statut HTTP seul. Sujets annotés ci-dessous.
    unsplash: [
      'photo-1791070536948-0a0f7ee457e7', // vitrine à pans avec étiquettes de parfums
      'photo-1744303858617-3c8b736af835', // vitrine italienne dramatique (Siena)
      'photo-1567206563064-6f60f40a2b57', // vitrine complète, pelles dans les pans
      'photo-1760308798378-d1a2e29ce54f', // pan gelato au citron, étiquette
      'photo-1764337008605-44abfb0f3816', // pans amaretto / pistache / speculoos
      'photo-1497034825429-c343d7c6a68f', // cornet à deux boules tenu en main
      'photo-1633933358116-a27b902fad35', // cornets fraise servis sur assiette
      'photo-1780340123533-954cef8c7eaa', // gelato pistache + pistaches (flat lay)
      'photo-1562790879-dfde82829db0',   // boule de gelato chocolat en gros plan
    ],
    picsumSeeds: ['gelato-vitrine', 'gelato-cornet', 'gelato-pistache', 'gelato-fraise'],
    hero: 'vitrine à pans de gelato avec étiquettes de parfums, en pleine lumière',
    cards: 'cornets, coupes et parfums (pistache, fraise, chocolat) en gros plan',
    gallery: '3 angles : vitrine complète, pan de parfum, cornet en main',
  },
  clinique: {
    label: 'clinique / santé',
    // LOT B — 2 ajouts regardés au pixel (planche 17/10) : radiographie sur
    // négatoscope, praticienne en blouse. Élargit la variété (la réserve à
    // 2 IDs imposait 11 fois la même image sur le site dentiste).
    unsplash: [
      'photo-1576091160399-112ba8d25d1d', 'photo-1576091160550-2173dba999ef',
      'photo-1588776814546-1ffcf47267a5', 'photo-1559839734-2b71ea197ec2',
    ],
    picsumSeeds: ['clinic-room', 'doctor-care', 'medical-desk', 'dentist-office'],
    hero: 'accueil apaisant : façade ou salle d’attente lumineuse',
    cards: 'équipements, soins et spécialités',
    gallery: 'salles de soin, équipe, détail hygiène',
  },
  hotel: {
    label: 'hôtel',
    unsplash: [
      'photo-1566073771259-6a8506099945', 'photo-1582719508461-905c673771fd',
      'photo-1445019980597-93fa8acb246c',
    ],
    picsumSeeds: ['hotel-room', 'hotel-lobby', 'hotel-pool'],
    hero: 'façade ou lobby accueillant',
    cards: 'chambres, services et équipements',
    gallery: 'chambre, piscine ou spa, restaurant',
  },
  garage: {
    label: 'garage automobile',
    unsplash: [
      'photo-1494976388531-d1058494cdd8', 'photo-1503376780353-7e6692767b70',
      'photo-1493238792000-8113da705763',
    ],
    picsumSeeds: ['garage-workshop', 'car-service', 'mechanic-tools'],
    hero: 'atelier et véhicule pris en charge',
    cards: 'gros plans mécanique et prestations',
    gallery: 'pont élévateur, outils, véhicule terminé',
  },
  boutique: {
    label: 'boutique / vêtements',
    unsplash: ['photo-1441986300917-64674bd600d8'],
    picsumSeeds: ['clothing-store', 'shop-window', 'fashion-rack'],
    hero: 'vitrine et intérieur de boutique',
    cards: 'gros plans produits et matières',
    gallery: 'rayons, cabine, détail matière',
  },
  saas: {
    label: 'application SaaS / logiciel',
    unsplash: [
      'photo-1497366216548-37526070297c', 'photo-1551288049-bebda4e38f71',
      'photo-1460925895917-afdab827c52f',
    ],
    picsumSeeds: ['saas-dashboard', 'team-office', 'analytics-screen'],
    hero: 'équipe au travail ou interface en situation',
    cards: 'captures d’interface, graphiques et fonctionnalités',
    gallery: 'tableau de bord, équipe, détail écran',
  },
  animalier: {
    label: 'animalier',
    unsplash: ['photo-1543466835-00a7907e9de1'],
    picsumSeeds: ['dog-portrait', 'vet-care', 'pet-shop'],
    hero: 'l’animal du contexte, dans son milieu',
    cards: 'portraits et moments de vie',
    gallery: '3 angles ou 3 moments différents',
  },
  immobilier: {
    label: 'immobilier / agence de biens',
    // Réservoir vérifié le 2026-10-17 : chaque ID testé HTTP 200 AU FORMAT
    // servi ET REGARDÉ au pixel sur planche-contact (lot2). Sujets réels :
    // maisons, villas, appartements, intérieurs — AUCUN resort, AUCUNE
    // plante générique. Annotation par connaissance modèle.
    unsplash: [
      'photo-1560518883-ce09059eeffa', // maquette maison + clés (annonce)
      'photo-1564013799919-ab600027ffc6', // villa crépuscule avec piscine
      'photo-1570129477492-45c003edd2be', // maison banlieue, jardin
      'photo-1568605114967-8130f3a36994', // maison chalet, extérieur
      'photo-1600596542815-ffad4c1539a9', // villa moderne, piscine (héro)
      'photo-1600585154340-be6161a56a0c', // maison moderne nuit façade
      'photo-1580587771525-78b9dba3b914', // façade contemporaine + piscine
      'photo-1512917774080-9991f1c4c750', // villa haut de gamme, bassin
      'photo-1560448204-e02f11c3d0e2',   // séjour d'appartement lumineux
      'photo-1522708323590-d24dbb6b0267', // intérieur habité, canapé
      'photo-1600607687939-ce8a6c25118c', // cuisine/pièce de vie moderne
    ],
    picsumSeeds: ['maison-facade', 'appartement-interieur', 'villa-jardin', 'agence-biens'],
    hero: 'belle façade de maison ou de villa baignée de lumière (le bien comme héros)',
    cards: 'les biens proposés : maisons, villas, appartements — une photo différente par bien',
    gallery: '3 vues de biens DIFFÉRENTS : extérieur, pièce de vie, chambre ou cuisine',
  },
  avocat: {
    label: 'cabinet juridique / avocat',
    // Réservoir vérifié le 2026-10-17 (planche lot2) : solennité juridique
    // (balance de la justice), bibliothèque de droit, institution, cabinet
    // moderne. Aucune photo de santé, de nourriture ni d'écran.
    unsplash: [
      'photo-1589829545856-d10d557cf95f', // balance de la justice (statue)
      'photo-1507842217343-583bb7270b66', // grande bibliothèque (dossiers de droit)
      'photo-1439337153520-7082a56a81f4', // atrium institutionnel vitré
      'photo-1487958449943-2429e8be8625', // immeuble cabinet, colonnes
    ],
    picsumSeeds: ['cabinet-avocat', 'bibliotheque-droit', 'salle-tribunal', 'consultation'],
    hero: 'solennité du cabinet : balance de justice, bibliothèque ou bâtiment institutionnel',
    cards: 'expertises et consultations : dossiers, signatures, espaces de conseil',
    gallery: '3 angles : bibliothèque, institution, détail solennel',
  },
  coiffeur: {
    label: 'coiffeur / barbier',
    // LOT COIFFEUR (18/10) — preuve vécue : « crée un site de coiffeur homme »
    // recevait des photos de restaurant. Réservoir constitué sur les
    // recherches publiques Unsplash (« barbershop », « mens-haircut »,
    // « barber beard trim », « haircut barbershop ») : 26 candidats chargés
    // en conditions réelles (26/26 vivants au format servi), sujets retenus
    // sur les descriptions rédigées par les auteurs Unsplash — AUCUN salon
    // féminin, AUCUN objet hors sujet. Variété : 4 intérieurs, 6 gestes du
    // métier, 1 détail produits, 1 portrait client.
    unsplash: [
      'photo-1585747860715-2ba37e788b70', // fauteuil cuir noir, mur de briques (héro)
      'photo-1781455793310-8427c96454c7', // salon : rangée de chaises et miroirs (héro)
      'photo-1773904215697-e6c21fc27ac2', // fauteuils + lavabos, lumière tamisée (ambiance)
      'photo-1675599193990-33d71150902b', // salon briques + planchers bois (ambiance)
      'photo-1503951914875-452162b0f3f1', // client sur la chaise du barbier (classique)
      'photo-1647140655214-e4a2d914971f', // coupe aux ciseaux, deux hommes (geste)
      'photo-1761931403671-d020a14928d9', // ciseaux + peigne en action (geste)
      'photo-1599351431202-1e0f0137899a', // rasoir droit (détail geste)
      'photo-1599011176306-4a96f1516d4d', // taille de barbe aux ciseaux (détail geste)
      'photo-1605497788044-5a32c7078486', // barbier au tablier, séchage (geste chaleureux)
      'photo-1621605815971-fbc98d665033', // outils : tondeuses, ciseaux, peigne, produits
      'photo-1630827020718-3433092696e7', // portrait profil, barbe épaisse (résultat client)
    ],
    picsumSeeds: ['barbier-atelier', 'coupe-homme', 'rasage-detail', 'salon-barbier'],
    hero: 'intérieur de barbier : fauteuil, miroir et lumière chaude',
    cards: 'gestes du métier : coupe, dégradé, taille de barbe en gros plan',
    gallery: '3 angles : salon, geste de coupe, détail rasage ou produits',
  },
  // LOT MÉTIERS (30/10) — cinq réservoirs neufs, discipline gelato/immobilier
  // appliquée à la lettre : chaque ID a été REGARDÉ au pixel (image lue une
  // à une) ET testé en GET 200 image/jpeg au format réellement servi
  // (auto=format&fit=crop&w=1200&q=80) le 30/10/2026, 34/34 (boucherie 8,
  // plombier 8, serrurier 7, patisserie 6, cordonnier 5). Candidats issus
  // des recherches publiques Unsplash (« butcher-shop-meat », « plumbing-
  // tools », « plumber-working », « faucet-pipes », « locksmith-key »,
  // « pastry-shop-cake », « shoe-repair-workshop »), rejets documentés dans
  // le journal du diagnostic (étiquettes de prix exotiques, atelier vélo
  // « Park Tool », décor Halloween, rugbyman au lavabo, sac Makita
  // générique). Aucun sujet ambigu : chaque photo montre le MÉTIER (viande,
  // tuyauterie, clé dans le barillet, entremets, cuir) — jamais un
  // eucalyptus.
  boucherie: {
    label: 'boucherie / charcuterie',
    unsplash: [
      'photo-1632084687062-522d7b1d4b95', // vitrine « BUTCHER SHOP » : balance, saucisses suspendues (héro)
      'photo-1625643269470-5d3e7b69fa34', // comptoir d'exposition débordant de viandes (héro)
      'photo-1740586222627-48338edac67d', // étal ibérique : pièces suspendues + trancheuse
      'photo-1786812594035-d9ff77d0ecb2', // steaks crus sur plateaux, étiquettes de prix
      'photo-1564068358927-970e567b27e2', // viandes tranchées en gros plan (cartes)
      'photo-1622992599912-d5ce51fe395b', // pièce de viande sur planche de bois (cartes)
      'photo-1762088208244-dde4e8b10047', // le boucher dans sa boutique, viande accrochée
      'photo-1584048603508-4b31894439a9', // second angle du comptoir d'exposition
    ],
    picsumSeeds: ['boucherie-comptoir', 'viande-vitrine', 'charcuterie-plateau', 'atelier-boucher'],
    hero: 'vitrine ou comptoir de boucherie : pièces de viande présentées, balance, lumière chaude',
    cards: 'gros plans produits : pièces tranchées, plateaux de viande, étiquettes de prix',
    gallery: '3 angles : comptoir, viande accrochée, détail de pièce sur planche',
  },
  plombier: {
    label: 'plombier / plomberie sanitaire',
    unsplash: [
      'photo-1676210134188-4c05dd172f89', // plombier au travail sous évier : siphon, lumière bleue (héro)
      'photo-1676210134050-6f12c6898395', // pose d'un bâti-support WC suspendu (geste)
      'photo-1503789146722-cf137a3c0fea', // clé à tuyau et clé à molette sur fond noir (outils)
      'photo-1596394723269-b2cbca4e6313', // valve en laiton qui fuit, eau jaillissante (détail)
      'photo-1768321918210-a775e4c88f08', // tuyauterie isolée sur chantier (installation)
      'photo-1642797735471-3e90055c5ff9', // raccords inox et laiton sur établi (matériel)
      'photo-1593523474914-2a4fd54075dc', // robinet mural sobre sur mur clair (robinetterie)
      'photo-1761074342668-c38fc2e62e67', // mur d'atelier : pinces et clés à tuyau (ambiance)
    ],
    picsumSeeds: ['plomberie-intervention', 'tuyauterie-detail', 'robinetterie-propre', 'atelier-plombier'],
    hero: 'plombier à l’œuvre : intervention sous évier ou installation sanitaire, lumière franche',
    cards: 'outils et pièces du métier : clé à tuyau, robinetterie, raccords, joints',
    gallery: '3 angles du métier : détection de fuite, tuyauterie apparente, robinetterie posée',
  },
  serrurier: {
    label: 'serrurier / serrurerie',
    unsplash: [
      'photo-1609770231080-e321deccc34c', // clé squelette dans le barillet, ombre sur porte (héro)
      'photo-1677951570313-b0750351c461', // clé dans un cylindre, bois sombre (geste)
      'photo-1643804926339-e94f0a655185', // trousseau de clés sur bois (cartes)
      'photo-1584985429926-08867327d3a6', // clé ancienne sur fond neutre (détail)
      'photo-1575908539614-ff89490f4a78', // trois clés en tôle, fond clair (cartes)
      'photo-1585914641050-fa9883c4e21c', // serrure patinée + béquille en fer sur porte blanche
      'photo-1584045446619-7146285c9811', // quincaillerie de porte, acier brossé (détail)
    ],
    picsumSeeds: ['serrurerie-porte', 'cles-trousseau', 'cylindre-serrure', 'atelier-serrurier'],
    hero: 'détail de serrure saine : clé dans le barillet, porte noble en lumière rasante',
    cards: 'pièces du métier : clés, trousseaux, cylindres, quincaillerie de porte',
    gallery: '3 angles : serrure posée, trousseau de clés, détail de quincaillerie',
  },
  patisserie: {
    label: 'pâtisserie / pâtissier',
    unsplash: [
      'photo-1711141326113-e6b607fd78ef', // vitrine pâtissière chargée : entremets, mousses, fraises (héro)
      'photo-1739132124985-6c9277e268b5', // vitrine éclairée : entremets et tartes alignés (héro bis)
      'photo-1626263468007-a9e0cf83f1ac', // gâteau chocolat au nappage coulant (produit)
      'photo-1693040775922-6aa218c689ec', // bundt framboise, vue zénithale, sucre glace (produit)
      'photo-1623049397342-ed7fdc71ac6d', // pâtissière au travail : dressage au pinceau (geste)
      'photo-1694067609280-5837ebf9e64f', // entremets chocolat, figues et roses (produit signature)
    ],
    picsumSeeds: ['patisserie-vitrine', 'entremets-produit', 'chocolat-gateau', 'atelier-patissier'],
    hero: 'vitrine pâtissière remplie : entremets et tartes en pleine lumière',
    cards: 'produits en gros plan : gâteaux, entremets, fruits dressés, gestes de dressage',
    gallery: '3 angles : vitrine, produit signature, geste de dressage',
  },
  cordonnier: {
    label: 'cordonnier / ressemelage',
    unsplash: [
      'photo-1529953717281-81a40b131119', // atelier : botte en cuir, pinces et outils sur cuirs (héro)
      'photo-1790253719855-e6f58150fc7f', // vitrine du cordonnier : machine de ressemelage, paires à réparer
      'photo-1648343615199-03567050abbb', // derbys noirs sur embauchoirs, clous sur l'établi (cartes)
      'photo-1707109322343-3fe79f5d5c0b', // nettoyage et remise en état de baskets (geste)
      'photo-1787005241178-c9006ea9610b', // patron de coupe tracé sur cuir, main posée (détail)
    ],
    picsumSeeds: ['cordonnier-atelier', 'ressemelage-detail', 'cuir-chaussure', 'vitrine-cordonnier'],
    hero: 'atelier du cordonnier : cuirs, outils du métier et paire de chaussures au poste',
    cards: 'gestes et pièces : ressemelage, clous sur l’établi, cuirs et patrons de coupe',
    gallery: '3 angles : établi, machine de ressemelage, détail de cuir cousu',
  },
  autre: {
    label: 'sujet général',
    // T0.5 — RÉSERVOIR D'AMBIANCE NEUTRE (16/10/2026) : les sujets non
    // sectoriels (avocat, yoga, ferme apicole…) sont des millions — aucune
    // énumération ne les couvrira. Avant ce patch, le repli était un picsum
    // ALÉATOIRE (preuves capturées : église avec personne identifiable,
    // carnet « Don't Just Stand There » — du texte incrusté). Chaque ID
    // ci-dessous a été REGARDÉ au pixel (vue 800px) ET testé en GET 200
    // image/jpeg au format réellement servi (w=1200&q=80). Sujets choisis
    // QUELCONQUES PAR CONSTRUCTION : architecture épurée, lumière, matière,
    // végétal — aucun code sectoriel (pas de cuisine, pas d'écran, pas
    // d'enseigne, pas de visage), donc lisibles pour tout métier.
    unsplash: [
      'photo-1601993957728-1e56ab70c5a8', // escalier beige + pot en terre (héro)
      'photo-1498262257252-c282316270bc', // nervures architecturales blanches (héro)
      'photo-1544475918-c8049b783892',   // couloir épuré, lumière rasante (héro)
      'photo-1583329550487-0fa300a4cd1a', // mur blanc, ombres de fenêtre (ambiance)
      'photo-1521194263619-39ecc5b55c61', // plâtre beige, lumière diffuse (texture)
      'photo-1528458909336-e7a0adfed0a5', // lin beige, texture uniforme (texture)
      'photo-1758216434916-0819f9cd3a4d', // plis de tissu doux (texture)
      'photo-1548685913-fe6678babe8d',   // relief de plâtre blanc (texture)
      'photo-1471086569966-db3eebc25a59', // monstera en vase de verre (cartes)
      'photo-1546387903-6d82d96ccca6',   // eucalyptus sur table blanche (cartes)
      'photo-1501004318641-b39e6451bec6', // ficus sur fond blanc (cartes)
      'photo-1616410731303-6affae095a0a', // papier recyclé specklé (texture)
    ],
    picsumSeeds: ['generic-business', 'studio-work', 'abstract-detail'],
    hero: 'architecture épurée et lumière naturelle, sans enseigne ni texte',
    cards: 'matières neutres et végétal en gros plan',
    gallery: '3 angles d\'ambiance neutre : architecture, matière, végétal',
  },
};

/**
 * IDs historiques conservés pour compatibilité (pages existantes déjà
 * sauvegardées) : toujours autorisés par le sanitizer, mais JAMAIS imposés
 * par les briefs (aucun thème ne les réclame).
 */
const LEGACY_IDS: readonly string[] = [
  'photo-1534438327276-14e5300c3a48',
  'photo-1490750967868-88aa4486c946',
  'photo-1560066984-138dadb4c035',
  'photo-1585704032915-c3400ca199e7',
];

/** Union de tous les IDs autorisés (thèmes + historique). */
export function allVerifiedUnsplashIds(): string[] {
  const out = new Set<string>(LEGACY_IDS);
  for (const theme of IMAGE_THEMES) {
    for (const id of THEME_IMAGE_RESOURCES[theme].unsplash) out.add(id);
  }
  return [...out];
}

/** ID du chien du réservoir (test négatif : jamais imposé hors animalier). */
export const ANIMALIER_DOG_ID = 'photo-1543466835-00a7907e9de1';

// ============================================================================
// PATCH PERTINENCE (patch C — chat HTML + chemin React) — la CONFORMITÉ d'une
// URL ne prouve PAS sa PERTINENCE de sujet. Le pool de SÉCURITÉ
// (allVerifiedUnsplashIds) reste l'unique autorité des hôtes/IDs autorisés
// pour app-policy.ts / image-gate.ts (AUCUN des deux n'est modifié) ; en AMONT
// de l'inspection de publication, une image vérifiée mais appartenant à un
// AUTRE secteur est remplacée par une image du réservoir du thème courant.
// Réécriture pure, déterministe, idempotente, seedée par génération.
// ============================================================================

/** Carte ID vérifié → thème propriétaire (dérivée : THEME_IMAGE_RESOURCES). */
const UNSPLASH_OWNER: ReadonlyMap<string, ImageTheme> = new Map(
  IMAGE_THEMES.flatMap((theme) =>
    THEME_IMAGE_RESOURCES[theme].unsplash.map((id) => [id, theme] as const)
  )
);

/**
 * Thème propriétaire d'un ID Unsplash vérifié ; null = LEGACY ou hors table.
 * Un ID « sans étiquette » ne peut pas garantir un sujet : les briques de
 * pertinence le traitent comme hors-thème et le remplacent.
 */
export function unsplashThemeOf(id: string): ImageTheme | null {
  return UNSPLASH_OWNER.get(id) ?? null;
}

/** Empreinte stable (FNV-1a 32 bits) : clé arbitraire → seed (u32). */
export function poolRotationSeed(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Rotation DÉTERMINISTE d'un réservoir : offset = seed % longueur. seed 0 →
 * ordre historique (défaut : tous les anciens appels restent identiques) ;
 * seed = poolRotationSeed(requestId) → point de départ stable au sein d'une
 * génération, différent d'une génération à l'autre (rotation maîtrisée : ni
 * aléatoire, ni par-reparation).
 */
export function rotatePool(pool: readonly string[], seed: number): string[] {
  const offset = ((seed >>> 0) % pool.length) || 0;
  return offset === 0 ? [...pool] : [...pool.slice(offset), ...pool.slice(0, offset)];
}

/**
 * URL Unsplash avec ID littéral (HTML src/TSX littéral/srcset/CSS url()).
 * Les refs DYNAMIQUES (`...' + id, template literals) ne matchent pas :
 * elles restent du ressort de l'inspection P1-B (indéterminée, jamais
 * déclarée conforme) — ce module ne réécrit pas ce qu'il ne voit pas.
 */
const UNSPLASH_URL_RE = /https:\/\/images\.unsplash\.com\/(photo-[A-Za-z0-9-]+)((?:\?[^"'`\s)\]}>]*)?)/g;

/**
 * Réécriture de PERTINENCE thématique (fonction COMMUNE chat HTML / React) :
 * toute URL Unsplash dont l'ID vérifié appartient à un AUTRE thème que
 * `theme` — ou à LEGACY/hors table (aucun sujet garanti) — est remplacée par
 * un ID du réservoir du thème courant. Garanties :
 *  - les IDs déjà conformes au thème sont PRÉSERVÉS et la file ne les
 *    duplique pas tant qu'il en reste dans le réservoir ;
 *  - picsum / data: / références locales : JAMAIS touchés ;
 *  - SEED : `poolRotationSeed(requestId)` — rotation stable pour une même
 *    génération, variée entre générations (0 = ordre historique) ;
 *  - IDEMPOTENT : un second passage = 0 réécriture (pas de rebouclage) ;
 *  - AUCUN effet de sécurité : le réservoir cible ne contient que des IDs
 *    vérifiés du catalogue (l'hôte et l'ID restent dans le pool légal) ;
 *    les URLs réellement interdites relèvent du sanitize/inspection et sont
 *    traitées AVANT.
 */
/**
 * LOT UNSPLASH-DYN (18/10) — options d'adoption dynamique (clé usager) :
 * `trustedIds` = photo-IDs adoptés par recherche réelle (conformité
 * thématique par construction de la REQUÊTE, pas par la table des
 * réserves) ; `poolOverride` = ces mêmes IDs, servis en PRIORITÉ pour les
 * réécritures et la déduplication avant d'épuiser la réserve déterministe.
 * Les deux vont ensemble ; absents, le comportement est strictement
 * inchangé (tous les appels existants).
 */
export interface ThematicRewriteOptions {
  readonly trustedIds?: ReadonlySet<string>;
  readonly poolOverride?: readonly string[];
}

export function thematicImageRewrite(
  content: string,
  theme: ImageTheme,
  seed = 0,
  options?: ThematicRewriteOptions
): { content: string; rewrites: number } {
  const override = options?.poolOverride;
  const base = override !== undefined && override.length > 0 ? override : THEME_IMAGE_RESOURCES[theme].unsplash;
  const pool = rotatePool(base, seed);
  if (pool.length === 0) return { content, rewrites: 0 };
  const trusted = options?.trustedIds;
  const conformes = new Set<string>();
  for (const id of pool) {
    if (content.includes(id)) conformes.add(id);
  }
  const queue: string[] = [...pool.filter((id) => !conformes.has(id)), ...pool];
  let cursor = 0;
  let rewrites = 0;
  const afterTheme = content.replace(UNSPLASH_URL_RE, (full: string, id: string, params: string) => {
    if (trusted !== undefined && trusted.has(id)) return full;
    if (unsplashThemeOf(id) === theme) return full;
    const target = queue[cursor % queue.length];
    cursor += 1;
    rewrites += 1;
    return `https://images.unsplash.com/${target ?? ''}${params ?? ''}`;
  });

  // LOT B (17/10) — PASSE 2 ANTI-RÉPÉTITION (déduplication des <img>) :
  // preuve utilisateur — 11 fois la MÊME photo dentiste — le LLM recopie
  // le 1er ID du brief section après section. Garantie : la i-ème balise
  // <img> (ordre du document) dont l'ID est déjà porté par une balise
  // précédente reçoit l'ID du réservoir en position (i mod longueur) :
  // tant que le réservoir couvre le site, AUCUNE répétition ; quand il
  // est dépassé, la répétition reste inévitable mais CYCLE (A,B,C,A,B,C
  // au lieu de A,A,A). Purement FONCTION du contenu (aucun état) :
  //   - idempotent — une nouvelle invocation trouve chaque doublon déjà
  //     à sa position canonique → 0 réécriture (sanitize double passage) ;
  //   - les IDs conformes NON dupliqués restent PRÉSERVÉS verbatim ;
  //   - la passe ne touche NI les srcset/CSS même-image (réécriture par
  //     BALISE, params préservés) NI les picsum/data:/locales.
  const dedupe = dedupeImgTags(afterTheme, pool);
  rewrites += dedupe.rewrites;
  return { content: dedupe.content, rewrites };
}

/**
 * Passe 2 de thematicImageRewrite : SEE doc là-haut. Balayage AVANT→ARRIÈRE
 * des balises <img> pour calculer le rang de doublon, puis ÉCRITURE
 * ARRIÈRE→AVANT (les remplacements en amont ne décalent pas les indices
 * aval). Sélection = pool[i mod taille] : dépend seulement du CONTENU
 * (stabilité entre deux appels) et de l'ordre du document.
 */
function dedupeImgTags(
  html: string,
  pool: readonly string[]
): { content: string; rewrites: number } {
  if (!/<img/i.test(html)) return { content: html, rewrites: 0 };
  const tags: { tag: string; index: number; id: string | null }[] = [];
  let match: RegExpExecArray | null;
  const IMG_RE = new RegExp('<img\\b[^>]*>', 'gi');
  while ((match = IMG_RE.exec(html)) !== null) {
    const tag = match[0] ?? '';
    const captured = /images\.unsplash\.com\/(photo-[A-Za-z0-9-]+)/.exec(tag);
    tags.push({ tag, index: match.index, id: captured?.[1] ?? null });
  }
  if (tags.length === 0) return { content: html, rewrites: 0 };

  // Rangs de doublon calculés sur la séquence ORIGINALE (pas d'état mutable
  // en cascade) : rang 0 = premier porteur de l'ID → préservé.
  const ranks = tags.map((_t, i) => {
    let r = 0;
    for (let j = 0; j < i; j += 1) {
      if (tags[j]?.id !== null && tags[j]?.id === tags[i]?.id) r += 1;
    }
    return r;
  });

  let out = html;
  let count = 0;
  for (let i = tags.length - 1; i >= 0; i -= 1) {
    const entry = tags[i] ?? null;
    if (entry === null || entry.id === null) continue;
    if (ranks[i] === 0) continue;
    const target = pool[i % pool.length];
    if (target === undefined || target === entry.id) continue;
    const newTag = entry.tag.split(entry.id).join(target);
    if (newTag === entry.tag) continue;
    out = out.slice(0, entry.index) + newTag + out.slice(entry.index + entry.tag.length);
    count += 1;
  }
  return { content: out, rewrites: count };
}

/**
 * Thème dominant dérivé des IDs vérifiés présents dans un contenu quelconque
 * (HTML assemblé, TSX React, CSS). Rend null si aucun ID thématisé. Sert aux
 * flux d'ÉDITION : le thème de réécriture est d'abord celui du FICHIER (les
 * images déjà en place définissent l'identité, jamais l'inverse).
 */
export function imageThemeOfContent(content: string): ImageTheme | null {
  const counts = new Map<ImageTheme, number>();
  const re = /https:\/\/images\.unsplash\.com\/(photo-[A-Za-z0-9-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const owner = unsplashThemeOf(m[1] ?? '');
    if (owner !== null) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  let best: ImageTheme | null = null;
  let bestCount = 0;
  for (const [theme, count] of counts) {
    if (count > bestCount) { best = theme; bestCount = count; }
  }
  return best;
}

/**
 * Contrat de thème global par secteur : le secteur détecté devient une
 * contrainte explicite pour TOUT le site (palette, typo, rédaction,
 * structure), pas seulement pour les images. Concret et exécutable, avec
 * des listes de sections compatibles avec l'ordre canonique (header 0,
 * hero 10, contenu 20, closing 30, footer 100).
 */
export interface SectorContract {
  readonly label: string;
  readonly palette: string;
  readonly typography: string;
  readonly copy: string;
  readonly sections: string;
}

const SECTOR_CONTRACTS: Record<ImageTheme, SectorContract> = {
  restaurant: {
    label: 'restaurant',
    palette: 'ambiance chaleureuse : fond crème ou clair (#fff8f0), texte brun foncé, accent terracotta/orangé (#c2410c). Mode clair sauf demande contraire. Contraste AA minimum (jamais de texte blanc sur fond clair).',
    typography: 'titres serif chaleureux (ex : Fraunces, Playfair Display), texte courant sans-serif lisible ; boutons arrondis généreux, cartes appétissantes bien espacées.',
    copy: 'ton gourmand et accueillant ; vocabulaire métier : carte, spécialités, réservation, terroir, fait maison ; appels à l’action : « Réserver une table », « Voir la carte ».',
    sections: 'ex. hero, carte, galerie, avis, reservation, footer',
  },
  gelato: {
    label: 'gelateria / artisan glacier',
    palette: 'ambiance fraîche et gourmande : fond crème ou blanc chaud, texte chocolat foncé, accents pistache (#84cc16) et fraise/baies (#f472b6). Mode clair sauf demande contraire. Contraste AA minimum.',
    typography: 'sans-serif ronde et joyeuse (ex : Poppins, Quicksand) pour les titres, texte courant sans-serif très lisible ; boutons arrondis, cartes gourmandes bien espacées.',
    copy: 'ton artisanal et gourmand ; vocabulaire métier : parfums, cornet, vitrine, fait maison, saison ; appels à l’action : « Découvrir les parfums », « Passage en boutique ».',
    sections: 'ex. hero, parfums, coupes, galerie, avis, contact, footer',
  },
  clinique: {
    label: 'clinique / santé',
    palette: 'ambiance apaisée et hygiénique : fond blanc, texte ardoise foncé, accent sarcelle (#0d9488). Mode clair. Contraste AA minimum.',
    typography: 'sans-serif nette et rassurante (ex : Inter) ; hiérarchie calme, boutons francs, cartes aérées.',
    copy: 'ton rassurant et professionnel ; vocabulaire métier : soins, praticiens, rendez-vous, diagnostic ; appels à l’action : « Prendre rendez-vous », « Nos spécialités ».',
    sections: 'ex. hero, specialites, medecins, tarifs, rendez-vous, contact, footer',
  },
  hotel: {
    label: 'hôtel',
    palette: 'ambiance élégante : fond ivoire, texte brun-noir, accent doré (#b45309). Mode clair sauf demande contraire. Contraste AA minimum.',
    typography: 'titres serif raffinés, texte courant sans-serif ; boutons élégants, cartes spacieuses.',
    copy: 'ton accueillant haut de gamme ; vocabulaire métier : chambres, suites, réservation, spa, réception ; appels à l’action : « Réserver votre séjour », « Découvrir l’hôtel ».',
    sections: 'ex. hero, chambres, services, galerie, avis, reservation, footer',
  },
  garage: {
    label: 'garage automobile',
    palette: 'ambiance atelier : fond ardoise sombre, texte clair, accent orange mécanique (#f97316). Mode sombre assumé. Contraste AA minimum.',
    typography: 'sans-serif condensée et franche ; boutons massifs, cartes techniques lisibles.',
    copy: 'ton direct et transparent ; vocabulaire métier : diagnostic, devis, réparation, entretien, forfait ; appels à l’action : « Demander un devis », « Nos prestations ».',
    sections: 'ex. hero, prestations, tarifs, avis, contact, footer',
  },
  boutique: {
    label: 'boutique / vêtements',
    palette: 'ambiance chic : fond blanc ou ivoire, texte noir doux, accent rose profond (#db2777). Mode clair. Contraste AA minimum.',
    typography: 'sans-serif moderne ; boutons nets, cartes produit soignées.',
    copy: 'ton tendance et vendeur ; vocabulaire métier : collection, nouveautés, panier, livraison ; appels à l’action : « Découvrir la collection », « Ajouter au panier ».',
    sections: 'ex. hero, catalogue, collections, avis, contact, footer',
  },
  saas: {
    label: 'application SaaS / logiciel',
    palette: 'ambiance tech moderne : fond clair bleuté, texte ardoise, accent indigo (#4f46e5). Mode clair sauf demande contraire. Contraste AA minimum.',
    typography: 'sans-serif géométrique ; hiérarchie produit nette, boutons SaaS, cartes fonctionnalités.',
    copy: 'ton clair orienté bénéfices ; vocabulaire métier : fonctionnalités, tarifs, essai gratuit, intégration ; appels à l’action : « Essai gratuit », « Voir les tarifs ».',
    sections: 'ex. hero, fonctionnalites, tarifs, temoignages, contact, footer',
  },
  animalier: {
    label: 'animalier',
    palette: 'ambiance nature et douceur : fond crème, texte brun, accent vert (#16a34a). Mode clair. Contraste AA minimum.',
    typography: 'sans-serif arrondie et chaleureuse ; boutons doux, cartes affectueuses.',
    copy: 'ton affectueux ; vocabulaire métier : animaux, adoption, soins, pension ; appels à l’action : « Adopter », « Nous rencontrer ».',
    sections: 'ex. hero, animaux, services, galerie, adoption, contact, footer',
  },
  immobilier: {
    label: 'immobilier / agence de biens',
    palette: 'ambiance immobilière premium : fond ivoire ou gris très clair (#f8fafc), texte ardoise foncé (#1e293b), accent institué (indigo profond #4338ca ou or discret #b45309). Mode clair. Contraste AA minimum.',
    typography: 'titres serif élégants (Playfair Display) et corps sans-serif net ; cartes d’annonces spacieuses où la photo domine, badge prix lisible, boutons francs.',
    copy: 'ton sérieux et vendeur ; vocabulaire métier : biens à vendre, estimation, mandats, visites, compromis, honoraires ; appels à l’action : « Planifier une visite », « Estimer mon bien », « Voir le bien ».',
    sections: 'ex. hero, biens, services, galerie, estimation, contact, footer',
  },
  avocat: {
    label: 'cabinet juridique / avocat',
    palette: 'sobre et institutionnel : fond blanc cassé, texte bleu nuit (#1e293b), accent bleu-marine (#1e3a8a) ou or discret ; JAMAIS de couleurs vives ni de mode sombre par défaut. Contraste AA minimum.',
    typography: 'serif classique et posée (Libre Baskerville, Playfair Display) pour les titres, corps sans-serif discret ; boutons rectangulaires élégants, cartes sobres bien alignées.',
    copy: 'ton solennel et précis ; vocabulaire métier : consultation, dossier, conseil, expertise, défense, juridiction ; appels à l’action : « Prendre rendez-vous », « Consulter ».',
    sections: 'ex. hero, expertises, cabinet, avis, contact, footer',
  },
  coiffeur: {
    label: 'coiffeur / barbier',
    palette: 'ambiance barbier affirmée : fond anthracite profond ou crème selon la demande, texte crème/ardoise, accent cuivre/laiton (#b45309). Contraste AA minimum.',
    typography: 'titres caractériels (serif affirmé type Playfair Display, ou sans-serif condensée), corps sans-serif net et lisible ; boutons francs, cartes de prestations généreuses.',
    copy: 'ton direct et précis du métier ; vocabulaire : coupe, dégradé, taille de barbe, rasage à l’ancienne, rendez-vous ; appels à l’action : « Réserver un créneau », « Prendre rendez-vous ».',
    sections: 'ex. hero, prestations, galerie, tarifs, avis, rendez-vous, footer',
  },
  // LOT MÉTIERS (30/10) — contrats des 5 nouveaux secteurs : direction
  // artistique déduite du MÉTIER (comptoir, chantier, porte, établi sucré),
  // jamais du gabarit générique ; l'entrée 'autre' d'en dessous reste le
  // repli des demandes sans secteur.
  boucherie: {
    label: 'boucherie / charcuterie',
    palette: 'ambiance de comptoir : fond crème ou ardoise froide, texte brun-brique, accent rouge boucher (#9f1239), jamais criard. Contraste AA minimum.',
    typography: 'titres robustes façon bistro (serif affirmée ou sans-serif grasse), corps net et lisible ; cartes produits sobres, prix bien lisibles.',
    copy: 'ton chaleureux d’artisan : vocabulaire métier (pièces, découpe, maturation, provenance, charcuterie maison) ; appels à l’action : « Composer sa commande », « Nous trouver ».',
    sections: 'ex. hero, spécialités, à la pièce, provenance, horaires, contact, footer',
  },
  plombier: {
    label: 'plombier / plomberie sanitaire',
    palette: 'fond blanc-bleu opérationnel, texte ardoise, accent bleu technique (#0369a1) ; zone urgence contrastée. Contraste AA minimum.',
    typography: 'sans-serif technique franche, gros titres lisibles ; cartes prestation avec téléphone et prix clairs.',
    copy: 'ton rassurant et concret : vocabulaire (dépannage, fuite, chauffe-eau, robinetterie, devis gratuit) ; appels à l’action : « Appeler maintenant », « Demander un devis ».',
    sections: 'ex. hero, services (fuite, chauffe-eau, salle de bain), urgence, zone d’intervention, avis, contact, footer',
  },
  serrurier: {
    label: 'serrurier / serrurerie',
    palette: 'fond nuit ardoise ou métal clair, texte nickèle, accent cuivre/doré (#b45309) façon laiton de serrure. Contraste AA minimum.',
    typography: 'sans-serif compacte et fiable, boutons d’urgence visibles ; cartes interventions numérotées.',
    copy: 'ton efficace et calme même en urgence : vocabulaire (porte claquée, cylindre, porte blindée, dépannage rapide 24/7) ; appels à l’action : « Appeler un serrurier », « Intervention 24/7 ».',
    sections: 'ex. hero, interventions (ouverture, cylindre, blindage), urgence, zones, tarifs, avis, contact, footer',
  },
  patisserie: {
    label: 'pâtisserie / pâtissier',
    palette: 'fond crème-vanille poudré, texte chocolat profond, accent framboise ou caramel (#be185d), jamais criard. Contraste AA minimum.',
    typography: 'titres serif douce et gourmande (Fraunces, Playfair), corps arrondi lisible ; cartes produits appétissantes bien alignées.',
    copy: 'ton chaleureux de pâtissier : vocabulaire (entremets, macarons, sur commande, gâteau d’anniversaire) ; appels à l’action : « Commander un gâteau », « Voir la vitrine ».',
    sections: 'ex. hero, vitrine, spécialités, gâteaux sur commande, avis, horaires, contact, footer',
  },
  cordonnier: {
    label: 'cordonnier / ressemelage',
    palette: 'atelier vrai : fond cuir clair ou toile désaturée, texte brun profond, accent cuir orangé (#a16207), ambiance établi sans folklore. Contraste AA minimum.',
    typography: 'série simple de titres (serif ou sans-serif de caractère), corps lisible ; cartes services (ressemelage, cirage, réparation) listées clairement.',
    copy: 'ton d’atelier honnête : vocabulaire (ressemelage, réparation, cirage, embauchoirs, cuir) ; appels à l’action : « Confier une réparation », « Déposer ses chaussures ».',
    sections: 'ex. hero, services, savoir-faire, avis, horaires, contact, footer',
  },
  autre: {
    label: 'sujet général',
    palette: 'direction artistique cohérente DÉDUITE DE LA DEMANDE (aucune palette imposée ici) ; contraste AA minimum, jamais de texte blanc sur fond clair.',
    typography: 'hiérarchie typographique nette adaptée au sujet ; boutons et cartes cohérents.',
    copy: 'ton et vocabulaire adaptés au public de la demande ; appels à l’action concrets liés au sujet.',
    sections: 'ex. hero, contenu, galerie, contact, footer',
  },
};

/**
 * Construit le bloc SECTEUR GLOBAL du prompt pour un thème donné.
 * Concret (palette/typo/copy/sections) + contre-exemple explicite pour
 * neutraliser le biais d'exemple restaurant du prompt. En modification :
 * rappel de préservation sauf changement de thème explicite.
 * Pur et déterministe.
 */
export function buildSectorContract(theme: ImageTheme, mode: 'create' | 'modify' = 'create'): string {
  const c = SECTOR_CONTRACTS[theme];
  const label = THEME_IMAGE_RESOURCES[theme].label;
  const lines: string[] = [];
  lines.push(`SECTEUR GLOBAL — « ${c.label} » (détecté côté serveur : contrainte pour TOUT le site, pas seulement les images).`);
  lines.push(`1. Palette et ambiance : ${c.palette}`);
  lines.push(`2. Typographie et composants : ${c.typography}`);
  lines.push(`3. Rédaction : ${c.copy}`);
  lines.push(`4. Structure : ce secteur appelle typiquement des sections comme ${c.sections} — PISTES cohérentes à adapter à la demande, jamais une liste imposée : remplace, réordonne, réduis ou enrichis selon le produit demandé ; noms courts métier ; respecte le format <SECTION>.`);
  lines.push('5. Images : applique le brief IMAGES ci-dessous, cohérent avec ce secteur.');
  lines.push('6. Les exemples de ce prompt (notamment « Bella Italia », terracotta italien, mode sombre) sont ILLUSTRATIFS : ne reprends jamais leur secteur, leurs textes ni leur direction artistique pour un autre secteur.');
  if (theme === 'autre') {
    lines.push('Contrat neutre : n’applique les codes d’aucun secteur par défaut (ni restaurant, ni terracotta, ni sombre imposé) — tout découle de la demande.');
  }
  if (mode === 'modify') {
    lines.push('MODIFICATION : conserve l’identité visuelle existante (palette, police, secteur) sauf si la demande exige explicitement un changement de thème ; si la demande corrige le thème vers celui-ci, applique ce contrat au lieu de l’ancien.');
  }
  return lines.join('\n');
}

/**
 * Indice de contexte d'une page : <title> + entête(s) visible(s) h1.
 * LOT COIFFEUR (2e passe, 18/10) — le <title> peut être PÉRIMÉ : le site
 * barbier portait « Authentic Italian Cuisine » et son seul 'cuisine'
 * faisait gagner 'restaurant' sur des demandes de coupe (3 essais vécus).
 * Le h1 décrit le contenu RÉEL (« Barbierie Élégance — L'art de la coupe
 * pour hommes ») : il complète l'indice. Une demande vague comme « change
 * les couleurs » hérite ainsi du secteur VIVANT du site, pas d'un titre
 * oublié. Pur, borné (200 caractères), jamais d'exception.
 */
export function pageTitleHint(html: string): string {
  try {
    const title = /<title>([^<]*)<\/title>/i.exec(html || '')?.[1] ?? '';
    const heads: string[] = [];
    const re = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html || '')) !== null && heads.length < 2) {
      const text = (m[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text.length > 0) heads.push(text.slice(0, 80));
    }
    return [title, ...heads].join(' ').trim().slice(0, 200);
  } catch {
    return '';
  }
}

/**
 * LOT POLISH (21/10) — RÉCONCILIATION DU TITRE DE PAGE.
 *
 * Preuve utilisateur : un site barbier portait encore
 * « Authentic Italian Cuisine » (titre hérité d'une génération précédente)
 * alors que son h1 décrivait le vrai contenu. Le titre trompe à la fois
 * l'utilisateur et le détecteur de thème (le mot « cuisine » captait
 * « restaurant »).
 *
 * Règle déterministe, sans invention :
 *  - le titre est conservé tel quel s'il est trop court ou neutre ;
 *  - si le titre désigne un secteur PRÉCIS et que le h1 désigne un AUTRE
 *    secteur précis → le h1 (contenu réel) gagne ;
 *  - si le titre désigne un secteur précis absent du corps de la page et
 *    qu'un h1 réel existe → le h1 gagne ;
 *  - sinon le titre est conservé (aucune réécriture arbitraire).
 */
export function reconcilePageTitle(title: string, html: string): string {
  const clean = decodeBasicHtmlEntities(title || '').replace(/\s+/g, ' ').trim().slice(0, 70);
  if (clean.length < 3) return clean;
  const titleTheme = detectImageTheme('', clean);
  if (titleTheme === 'autre') return clean;

  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html || '');
  const h1 = h1Match === null
    ? ''
    : decodeBasicHtmlEntities(h1Match[1]!.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 70);
  if (h1.length < 3) return clean;

  const h1Theme = detectImageTheme('', h1);
  if (h1Theme !== 'autre' && h1Theme !== titleTheme) return h1;

  // Corps de page borné : head (title/meta) et scripts/styles retirés pour ne
  // pas compter leur vocabulaire hors contenu visible. Le texte du <title>
  // hérité ne doit JAMAIS servir de preuve que l'ancien thème est encore là
  // (bug vécu 22/10 : « Authentic Italian Cuisine » restait gravé parce que
  // son propre mot « cuisine » était compté dans le corps).
  const body = (html || '')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<title[\s\S]*?<\/title>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
  if (body.length < 200) return clean;
  const bodyHits = countDistinctHits(fold(body), THEME_KEYWORDS[titleTheme]);
  if (bodyHits === 0 && h1Theme !== titleTheme) return h1;
  return clean;
}

export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Décodage minimal des entités HTML que peut contenir un <title>/<h1> extrait.
 * L'appelant ré-échappe ensuite pour le shell : sans ce décodage, « &amp; »
 * deviendrait « &amp;amp; » à l'écran. `&amp;` est décodé EN DERNIER pour ne
 * pas transformer « &amp;lt; » en « < ».
 */
function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _m;
    })
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _m;
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function countDistinctHits(folded: string, keywords: readonly string[]): number {
  let hits = 0;
  for (const kw of keywords) {
    const re = new RegExp(`(^|[^a-z])${kw}([^a-z]|$)`);
    if (re.test(folded)) hits += 1;
  }
  return hits;
}

/**
 * Détecte le thème visuel depuis la demande (+ titre de page en contexte).
 * Règle d'honnêteté : ex æquo ou aucun signal → 'autre', jamais un thème
 * imposé sans justification. Déterministe (même entrée → même thème).
 *
 * P1 GELATO : pré-pass AVANT le scoring générique — (strong ≥1 ou medium ≥2)
 * sans rival (pizzeria, snack, boulangerie…) → 'gelato', car les mots
 * génériques gourmands captent sinon la demande (preuve : « bar à glaces »
 * classait la demande 'restaurant' via le seul mot 'bar').
 */
export function detectImageTheme(prompt: string, contextTitle = ''): ImageTheme {
  const folded = fold(`${prompt} ${contextTitle}`);
  // LOT B — NÉGATIONS : le texte scoré EST le texte sans ses fragments
  // négatifs (« Aucune image de restaurant → … » ne DOIT plus créer
  // 'restaurant'). Le reste de la logique est inchangé.
  const neutral = stripNegations(folded);
  // L'activité principale d'abord : gelato ne peut être capté que par du
  // vocabulaire qui le nomme, jamais par un mot générique (menu, bar,
  // desserts). Avec un rival présent (autre activité dominante), le chemin
  // générique ci-dessous décide, exactement comme avant ce patch.
  const gelatoStrong = countDistinctHits(neutral, GELATO_STRONG);
  const gelatoMedium = countDistinctHits(neutral, GELATO_MEDIUM);
  const gelatoRivals = countDistinctHits(neutral, GELATO_RIVALS);
  if (gelatoRivals === 0 && (gelatoStrong > 0 || gelatoMedium >= 2)) return 'gelato';
  // PATCH PERTINENCE — un rival explicite écarte son thème du scoring AVANT
  // tout match (THEME_EXCLUSIONS : patterns ci-dessus, cas testés).
  const excluded = new Set<Exclude<ImageTheme, 'autre'>>();
  for (const rule of THEME_EXCLUSIONS) {
    if (rule.pattern.test(neutral)) excluded.add(rule.theme);
  }
  let best: ImageTheme = 'autre';
  let bestScore = 0;
  let tie = false;
  for (const theme of IMAGE_THEMES) {
    if (theme === 'autre') continue;
    if (excluded.has(theme as Exclude<ImageTheme, 'autre'>)) continue;
    const score = countDistinctHits(neutral, THEME_KEYWORDS[theme]);
    if (score > bestScore) {
      bestScore = score;
      best = theme;
      tie = false;
    } else if (score === bestScore && score > 0) {
      tie = true;
    }
  }
  if (bestScore === 0 || tie) return 'autre';
  return best;
}

/**
 * LOT MÉTIERS (30/10) — LOT 3 (couture demandée) : couche explicitement
 * séparée de detectImageTheme. Aujourd'hui DÉLÈGUE (autorité unique du
 * scoring, zéro duplication, byte-identique) ; demain, si la taxonomie
 * métiers doit diverger du scoring de brief, la couture est ici et
 * detectImageTheme reste la référence des réservoirs.
 */
export function detectSector(prompt: string, contextTitle = ''): ImageTheme {
  return detectImageTheme(prompt, contextTitle);
}

/**
 * Construit le bloc IMAGES du prompt pour un thème donné.
 * - create : rôles visuels par section + IDs imposés + interdictions
 *   (mémoire, loremflickr, hors-sujet) ;
 * - modify : même brief + consigne de PRÉSERVATION (ne réémettre de nouvelles
 *   URLs que pour les sections explicitement touchées, recopier les URLs
 *   déjà présentes dans le HTML fourni pour tout le reste).
 * Pur et déterministe : aucun ID inventé (tout vient du réservoir vérifié).
 * T0.5 : quand un réservoir existe, il est EXCLUSIF — l'IA n'a plus aucune
 * porte vers picsum/URLs de mémoire ; picsum n'est mentionné que pour les
 * thèmes sans réservoir (repli documenté, historique).
 */
/**
 * LOT UNSPLASH-DYN (18/10) — options du brief : `poolOverride` = photo-IDs
 * RÉELS adoptés (recherche Unsplash avec clé usager, une fois par
 * exécution). Le réservoir listé devient ces photos du jour ; le sanitizer
 * les reconnaît (dynamicIds) et les conserve. Absent : réserve
 * déterministe, comportement strictement historique.
 *
 * LOT MÉTIERS (30/10) — `subjectHint` = sujet métier résolu côté serveur
 * pour le LONG TAIL (thème 'autre' + métier reconnu par le lexique
 * sectoriel) : remplace le pool neutre par une directive SUJET IMPOSÉ.
 * Sans effet sur les thèmes mappés ni sur le chemin dynamic (clé usager).
 */
export interface ImageBriefOptions {
  readonly poolOverride?: readonly string[];
  readonly subjectHint?: string;
}

export function buildImageBrief(
  theme: ImageTheme,
  mode: 'create' | 'modify',
  rotationSeed = 0,
  options?: ImageBriefOptions
): string {
  const r = THEME_IMAGE_RESOURCES[theme];
  // PATCH PERTINENCE — ordre du réservoir roté par seed : point de départ
  // STABLE au sein d'une génération (seed = poolRotationSeed(requestId))
  // et différent d'une génération à l'autre ; 0 = ordre historique (défaut :
  // tous les appels/ou tests existants restent inchangés).
  // LOT UNSPLASH-DYN — poolOverride (photos réelles du jour) remplace la
  // réserve comme source listée : même rotation seedée.
  const override = options?.poolOverride;
  const dynamic = override !== undefined && override.length > 0 ? override : null;
  const base = dynamic ?? r.unsplash;
  const reservoir = rotationSeed === 0 ? base : rotatePool(base, rotationSeed);
  const lines: string[] = [];
  // LOT MÉTIERS (30/10) — LOT 1 LONG TAIL : les métiers reconnus par le
  // lexique sectoriel mais SANS réservoir dédié (thème 'autre') ne
  // recevaient que le pool neutre (archi minimale = l'eucalyptus du
  // diagnostic « boucherie »). Quand un sujet métier est résolu, ce pool
  // est remplacé par un SUJET IMPOSÉ textuel : prompt sans IDs, directive
  // ferme — choisir des images du métier OU laisser la section sans
  // image. Le sanitiseur (patch C, inchangé) reste le filet : toute URL
  // inventée non conforme est renvoyée vers le pool neutre.
  const hint = (options?.subjectHint ?? '').trim();
  const hintApplies = hint.length > 0 && theme === 'autre' && dynamic === null;
  if (hintApplies) {
    lines.push(`IMAGES — sujet imposé du métier (détecté côté serveur) : « ${hint} » (ne le redétecte pas, applique-le).`);
    lines.push('RÔLES VISUELS PAR SECTION (obligatoire, chaque photo DOIT montrer le sujet de sa section) :');
    lines.push(`- hero : une scène réelle de « ${hint} » — intérieur du lieu ou geste du métier ; le sujet commande l'image, jamais une ambiance générique ;`);
    lines.push(`- cartes / produits / menu : objets, productions ou outils directs de « ${hint} » ;`);
    lines.push(`- galerie : 3 angles différents de « ${hint} » (poste de travail, produit, détail) ;`);
    lines.push('- autres sections : illustration du rôle exact de la section, jamais décorative ni hors sujet.');
    lines.push(`choisis EXCLUSIVEMENT des images liées au sujet « ${hint} » — aucune photo d'ambiance générique, aucun végétal décoratif.`);
    lines.push('Format : https://images.unsplash.com/<ID>?auto=format&fit=crop&w=1200&q=80.');
    lines.push(`Si aucune adresse plausiblement liée à « ${hint} » n'existe : laisse la section SANS image — une section sobre vaut mieux qu'une photo hors sujet.`);
  } else {
    lines.push(`IMAGES — thème détecté côté serveur : « ${r.label} » (ne le redétecte pas, applique-le).`);
    lines.push('RÔLES VISUELS PAR SECTION (obligatoire, chaque photo DOIT montrer le sujet de sa section) :');
    lines.push(`- hero : ${r.hero} ;`);
    lines.push(`- cartes / produits / menu : ${r.cards} ;`);
    lines.push(`- galerie : ${r.gallery} ;`);
    lines.push('- autres sections : illustration du rôle exact de la section, jamais décorative ni hors sujet.');
    if (base.length > 0) {
      const source = dynamic !== null
        ? 'RÉSERVOIR du jour (recherche réelle Unsplash pour ce thème — photos réelles, adoptées pour cette génération)'
        : 'RÉSERVOIR vérifié (IDs testés vivants, sujet connu)';
      lines.push(`${source} — choisis EXCLUSIVEMENT dedans : ${reservoir.join(', ')}.`);
      lines.push('Format : https://images.unsplash.com/<ID>?auto=format&fit=crop&w=1200&q=80.');
      lines.push('Si aucun sujet du réservoir ne correspond exactement : choisis l\'image du réservoir la plus proche du rôle de la section (sujet simple, composition sobre) — JAMAIS d\'URL hors réservoir, jamais picsum : la cohérence du site prime.');
    } else {
      lines.push('RÉSERVOIR : aucun sujet vérifié pour ce thème — fallback obligatoire ci-dessous.');
      lines.push(`Toute image : https://picsum.photos/seed/<mot-sujet>-<N>/800/520 avec un mot-sujet en rapport avec « ${r.label} » (ex : ${r.picsumSeeds.join(', ')}).`);
    }
  }
  lines.push('INTERDIT : toute autre adresse inventée de mémoire, loremflickr (service en panne), et toute photo sans rapport avec le thème (ex : un animal sur un site qui n’en parle pas).');
  lines.push('Chaque <img> porte un alt qui décrit ce qu’on doit voir.');
  if (mode === 'modify') {
    lines.push('MODIFICATION — préservation : ne réémets de nouvelles URLs d’images QUE pour les sections que la demande touche explicitement ; pour tout le reste, recopie à l’identique les URLs déjà présentes dans le HTML fourni (ne les réinvente jamais).');
  }
  return lines.join('\n');
}

/** Image finale rattachée à sa section (traçabilité P0). */
export interface SectionImage {
  readonly section: string;
  readonly src: string;
}

/**
 * Extrait les images finales par section d'un HTML assemblé (convention
 * data-section, même découpage paresseux que le serveur). Borné (40
 * sections, src tronquées) : destiné aux logs, jamais aux secrets.
 */
export function extractSectionImages(html: string, maxSections = 40): SectionImage[] {
  const out: SectionImage[] = [];
  const re = /<div[^>]*data-section="([^"]{1,40})"[^>]*>([\s\S]*?)(?=<div[^>]*data-section|<\/body>|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null && out.length < maxSections) {
    const name = match[1] ?? '';
    const block = match[2] ?? '';
    const imgRe = /<img\b[^>]*\bsrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
    let img: RegExpExecArray | null;
    while ((img = imgRe.exec(block)) !== null) {
      const src = (img[1] ?? '').replace(/^["']|["']$/g, '').trim().slice(0, 300);
      if (src) out.push({ section: name, src });
    }
  }
  return out;
}
