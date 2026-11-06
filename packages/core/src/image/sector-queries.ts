/**
 * PATCH SECTEUR-LIBRE (22/10/2026) — requête de recherche photo dérivée du
 * texte de la demande, pour les sujets que `detectImageTheme` classe 'autre'.
 *
 * POURQUOI : le réservoir de thèmes est fini (11 secteurs + général) ; les
 * sujets non mappés (« caserne de pompier », « plombier », « fleuriste »…)
 * recevaient la requête générique 'modern architecture interior minimal',
 * donc des photos d'ambiance sans rapport avec le métier. Le chemin dynamique
 * (clé usager, UNE recherche par exécution) peut servir TOUS les secteurs :
 * il suffit de dériver une requête anglaise sobre depuis la demande.
 *
 * RÈGLES (mêmes garanties que THEME_PHOTO_QUERY) :
 *  - déterministe, pur : même texte → même requête, aucun réseau, aucune clé ;
 *  - requêtes SOBRES de 3 à 6 mots anglais, jamais d'URL ni de photo-ID ;
 *  - mots entiers uniquement (jamais de sous-chaîne : 'spa' ne matche pas
 *    'espace') ; accents retirés via `fold` ; négations retirées via
 *    `stripNegations` (même sémantique que le détecteur de thème) ;
 *  - aucune invention : si aucun métier n'est reconnu, retour `null` et
 *    l'appelant conserve la requête générique historique (comportement
 *    inchangé pour l'inconnu) ;
 *  - PRIORITÉ : l'expression qui couvre le plus de mots l'emporte
 *    (« salle de sport » bat « coach sportif ») ; à égalité, l'ordre du
 *    tableau tranche (du plus spécifique au plus générique).
 *
 * PORTÉE HONNÊTE : lexique français ciblé sur les métiers/secteurs fréquents
 * absents des thèmes mappés. Ce n'est PAS une traduction automatique : un
 * sujet hors lexique garde le repli générique (aucune promesse d'exhaustivité).
 * Les thèmes mappés (restaurant, clinique, garage, coiffeur…) ne passent
 * JAMAIS par ce module : leur requête dédiée reste la seule autorité.
 */
import { fold, stripNegations } from './theme.js';
import type { ImageTheme } from './theme.js';

export interface SectorQueryEntry {
  /** Formes FR foldées (sans accents) séparées par « | » — mots entiers. */
  readonly pattern: string;
  /** Requête Unsplash anglophone sobre (3-6 mots, jamais d'URL/ID). */
  readonly query: string;
}

/**
 * Lexique métiers → requête photo. Ordre = priorité de départage.
 * Chaque entrée a été rédigée à la main (pas de génération automatique) :
 * vocabulaire du métier d'abord, pas de synonyme approximatif.
 */
export const SECTOR_QUERY_ENTRIES: readonly SectorQueryEntry[] = [
  // — Secours / services publics —
  { pattern: 'caserne|pompier|pompiers|sapeur-pompier|sapeurs-pompiers|incendie', query: 'firefighter fire station rescue' },
  { pattern: 'ambulance|ambulancier|ambulanciers|samu', query: 'ambulance emergency medical team' },
  { pattern: 'commissariat|gendarmerie|policier|policiers|police', query: 'police station officers uniform' },
  { pattern: 'mairie|hotel de ville|conseil municipal', query: 'town hall city building' },
  { pattern: 'maison de retraite|ehpad', query: 'elderly care retirement home' },
  { pattern: 'aide a domicile|services a la personne', query: 'home care assistance elderly' },

  // — Artisans / bâtiment —
  { pattern: 'plombier|plombiers|plomberie', query: 'plumber pipes bathroom repair' },
  { pattern: 'electricien|electriciens', query: 'electrician wiring electrical panel' },
  { pattern: 'serrurier|serruriers|serrurerie', query: 'locksmith door lock key' },
  { pattern: 'chauffagiste|chaudiere|chauffage', query: 'heating boiler technician installation' },
  { pattern: 'climatisation|climaticien', query: 'air conditioning installation technician' },
  { pattern: 'menuisier|menuisiers|menuiserie', query: 'carpenter woodworking workshop tools' },
  { pattern: 'ebeniste|ebenistes|ebenisterie', query: 'cabinetmaker fine furniture wood' },
  { pattern: 'peintre en batiment|peinture batiment', query: 'house painter painting wall' },
  { pattern: 'macon|maconnerie', query: 'mason bricklaying construction site' },
  { pattern: 'carreleur|carrelage', query: 'tiler ceramic floor tiles' },
  { pattern: 'couvreur|couverture|toiture', query: 'roofer roof tiles work' },
  { pattern: 'vitrier|vitrerie', query: 'glazier window glass installation' },
  { pattern: 'demenageur|demenageurs|demenagement', query: 'moving company boxes truck' },
  { pattern: 'paysagiste|amenagement paysager', query: 'landscaping garden design' },
  { pattern: 'jardinier|jardiniers|jardinage|espaces verts', query: 'gardener garden tools green' },
  { pattern: 'pisciniste', query: 'swimming pool construction clean' },
  { pattern: 'ramoneur|ramonage', query: 'chimney sweep roof' },
  { pattern: 'societe de nettoyage|entreprise de nettoyage|nettoyage professionnel|femme de menage', query: 'professional cleaning service team' },
  { pattern: 'desinsectisation|deratisation|nuisibles', query: 'pest control spraying technician' },

  // — Mobilité / voyages —
  { pattern: 'taxi|vtc|chauffeur prive', query: 'taxi car city street' },
  { pattern: 'depannage|remorquage', query: 'tow truck roadside assistance' },
  { pattern: 'reparation velo|atelier velo|location de velo', query: 'bicycle repair workshop' },
  { pattern: 'agence de voyage|voyagiste|office de tourisme', query: 'travel agency tourism destination' },
  { pattern: 'camping|mobil-home', query: 'camping tents nature outdoors' },
  { pattern: 'randonnee|trekking', query: 'hiking trail mountains nature' },
  { pattern: 'guide touristique|visite guidee', query: 'tour guide city tourists' },

  // — Sport / bien-être actif —
  { pattern: 'salle de sport|salle de musculation|fitness|musculation', query: 'gym fitness training weights' },
  { pattern: 'crossfit|halterophilie', query: 'crossfit workout gym intense' },
  { pattern: 'coach sportif|coaching sportif|preparateur physique', query: 'personal trainer coaching gym' },
  { pattern: 'yoga', query: 'yoga studio class calm' },
  { pattern: 'pilates', query: 'pilates studio reformer class' },
  { pattern: 'ecole de danse|danse|ballet', query: 'dance studio class dancers' },
  { pattern: 'judo|karate|aikido|arts martiaux|dojo', query: 'martial arts dojo training' },
  { pattern: 'boxe|boxeur|boxe thai|mma', query: 'boxing gym ring training' },
  { pattern: 'escalade|salle d escalade', query: 'climbing gym wall holds' },
  { pattern: 'padel|tennis', query: 'tennis court racket player' },
  { pattern: 'football|club de foot', query: 'football soccer stadium field' },
  { pattern: 'basket|basketball', query: 'basketball court players' },
  { pattern: 'equitation|centre equestre|cheval|chevaux', query: 'horse riding stable equestrian' },
  { pattern: 'golf', query: 'golf course green swing' },
  { pattern: 'club sportif|association sportive', query: 'sports club team training' },

  // — Beauté / corps —
  { pattern: 'tatouage|tatoueur|tatoueurs', query: 'tattoo artist studio machine' },
  { pattern: 'onglerie|manucure|pedicure', query: 'nail salon manicure hands' },
  { pattern: 'estheticienne|institut de beaute|soins du visage', query: 'beauty salon facial treatment' },
  { pattern: 'spa|massage|bien-etre|hammam', query: 'spa massage wellness relaxation' },
  { pattern: 'maquillage|maquilleuse', query: 'makeup artist beauty studio' },
  { pattern: 'epilation', query: 'waxing hair removal salon' },

  // — Événementiel / image —
  { pattern: 'mariage|wedding', query: 'wedding ceremony flowers couple' },
  { pattern: 'wedding planner|organisateur de mariage', query: 'wedding planner decoration venue' },
  { pattern: 'evenementiel|salle de reception|salle des fetes', query: 'event venue reception celebration' },
  { pattern: 'photographe|photographes|studio photo', query: 'photographer camera studio portrait' },
  { pattern: 'videaste|videographer|tournage', query: 'videographer filming camera crew' },
  { pattern: 'dj|disc jockey|sonorisation', query: 'dj mixing console party' },

  // — Commerces / artisanat de bouche —
  { pattern: 'fleuriste|fleuristes|fleurs', query: 'florist flower shop bouquet' },
  { pattern: 'librairie|librairies|libraire', query: 'bookstore shelves books reading' },
  { pattern: 'papeterie|fournitures scolaires', query: 'stationery shop pens paper' },
  { pattern: 'quincaillerie|outillage', query: 'hardware store tools shelves' },
  { pattern: 'mercerie|couture|retouches', query: 'sewing workshop fabric threads' },
  { pattern: 'cordonnier|cordonnerie', query: 'cobbler shoe repair workshop' },
  { pattern: 'horloger|horlogerie|montres', query: 'watchmaker repair watches tools' },
  { pattern: 'fromagerie|fromages', query: 'cheese shop artisan wheels' },
  { pattern: 'boucherie|boucher|charcuterie|charcutier', query: 'butcher shop meat cuts' },
  { pattern: 'poissonnerie|poissonnier', query: 'fish market seafood fresh' },
  { pattern: 'primeur|primeurs|fruits et legumes', query: 'fresh produce market vegetables' },
  { pattern: 'epicerie', query: 'grocery store shelves products' },
  { pattern: 'caviste|cave a vin|vignoble|vigneron|viticulture', query: 'wine cellar bottles vineyard' },
  { pattern: 'torrefacteur|torrefaction', query: 'coffee roastery beans' },
  { pattern: 'chocolaterie|chocolatier', query: 'chocolate shop artisan pralines' },
  { pattern: 'confiserie|bonbons', query: 'candy shop sweets colorful' },
  // LOT MÉTIERS (30/10) — le pâtissier rejoint le lexique (il devient aussi
  // un thème mappé côté theme.ts ; cette entrée garantit le SUJET au cas où
  // un rival ex æquo renverrait la demande vers 'autre'). Même query que
  // THEME_PHOTO_QUERY.patisserie : autorité unique.
  { pattern: 'patissier|patissiers|patissiere|patissieres|patisserie|patisseries', query: 'pastry shop cake display desserts' },
  { pattern: 'magasin bio|produits bio', query: 'organic grocery fresh produce' },
  { pattern: 'animalerie', query: 'pet store shelves supplies' },
  { pattern: 'maroquinerie', query: 'leather goods bags craftsmanship' },
  { pattern: 'magasin de jeux|jeux de societe', query: 'board games shop colorful' },
  { pattern: 'disquaire|vinyle|vinyles', query: 'record store vinyl shelves' },

  // — Éducation / culture —
  { pattern: 'ecole|ecoles', query: 'school classroom children learning' },
  { pattern: 'creche|garderie', query: 'daycare nursery children playing' },
  { pattern: 'maternelle|jardin d enfants', query: 'kindergarten children classroom play' },
  { pattern: 'soutien scolaire|cours particuliers', query: 'tutoring student books desk' },
  { pattern: 'universite|etudiant|etudiants|campus', query: 'university campus students library' },
  { pattern: 'centre de formation|formation professionnelle', query: 'training workshop professionals classroom' },
  { pattern: 'conservatoire|ecole de musique|piano|guitare|solfege', query: 'music school instruments lesson' },
  { pattern: 'theatre|piece de theatre', query: 'theater stage curtains lights' },
  { pattern: 'cinema', query: 'cinema theater seats screen' },
  { pattern: 'musee|exposition|galerie d art', query: 'museum exhibition art gallery' },
  { pattern: 'mediatheque|bibliotheque', query: 'library books shelves quiet' },

  // — Santé (secteurs non mappés) —
  { pattern: 'kine|kinesitherapeute|kinesitherapie|reeducation', query: 'physiotherapy rehabilitation session' },
  { pattern: 'osteopathe|osteopathie', query: 'osteopathy treatment hands' },
  { pattern: 'podologue|podologie', query: 'podiatry foot care clinic' },
  { pattern: 'orthophoniste|orthophonie', query: 'speech therapy session child' },
  { pattern: 'psychologue|psychotherapie|psychotherapeute', query: 'therapy session counseling office' },
  { pattern: 'sage-femme|maieutique', query: 'midwife pregnancy care' },
  { pattern: 'infirmier|infirmiere|soins infirmiers', query: 'nurse home care patient' },
  { pattern: 'opticien|opticiens|lunettes', query: 'optician glasses eyewear shop' },
  { pattern: 'nutritionniste|dieteticien|dieteticienne', query: 'nutrition consultation healthy food' },
  { pattern: 'laboratoire d analyses|analyses biomedicales', query: 'medical laboratory analysis equipment' },

  // — Finance / juridique / RH —
  { pattern: 'comptable|expert-comptable|cabinet comptable', query: 'accountant office documents calculator' },
  { pattern: 'banque|banquier', query: 'bank finance building' },
  { pattern: 'assurance|assureur|mutuelle', query: 'insurance office contract handshake' },
  { pattern: 'courtier|courtage', query: 'broker finance meeting' },
  { pattern: 'recrutement|cabinet de recrutement|ressources humaines', query: 'recruitment interview office team' },
  { pattern: 'architecte|agence d architecture', query: 'architect blueprint model office' },

  // — Communautés / rural —
  { pattern: 'association|ong|benevoles|benevolat', query: 'volunteers community teamwork' },
  { pattern: 'centre social|espace jeunes|maison des jeunes', query: 'youth community center activities' },
  { pattern: 'ferme|agriculteur|agriculture|exploitation agricole', query: 'farm fields tractor agriculture' },
  { pattern: 'apiculteur|apiculture|miel', query: 'beekeeper honey bees hives' },
  { pattern: 'distillerie|spiritueux', query: 'distillery barrels spirits' },
  { pattern: 'pecheur|peche en mer', query: 'fishing boat sea nets' },
];

/** Regex compilées une fois : mots entiers, texte foldé sans accents. */
const COMPILED: ReadonlyArray<{ re: RegExp; query: string }> = SECTOR_QUERY_ENTRIES.map((entry) => ({
  re: new RegExp('(^|[^a-z])(' + entry.pattern + ')(?=[^a-z]|$)'),
  query: entry.query,
}));

/**
 * Dérive une requête photo anglaise depuis le texte de la demande.
 * @returns la requête du métier reconnu le plus spécifique, ou `null` si
 *          aucun métier du lexique n'est présent (repli générique appelant).
 */
export function deriveSectorPhotoQuery(text: string): string | null {
  const folded = stripNegations(fold(text || ''));
  if (folded.trim().length === 0) return null;
  let bestScore = 0;
  let bestQuery: string | null = null;
  for (const item of COMPILED) {
    const match = item.re.exec(folded);
    if (!match) continue;
    const matched = (match[2] || '').trim();
    if (matched.length === 0) continue;
    const score = matched.split(/\s+/).length;
    if (score > bestScore) {
      bestScore = score;
      bestQuery = item.query;
    }
  }
  return bestQuery;
}

// ============================================================================
// LOT MÉTIERS (30/10) — LOT 2 : résolution du SUJET métier pour le long tail.
// À la différence de deriveSectorPhotoQuery (requête photo ANGLAISE pour la
// clé usager), resolveImageSubject rend le mot métier FRANÇAIS canonique
// (première forme du pattern reconnu) qui alimente le `subjectHint` des
// briefs. Même lexique, même arbitrage : un seul vocabulaire, aucun doublon.
// ============================================================================

/** Sujet métier résolu pour le brief (thème 'autre' + métier reconnu). */
export interface ImageSubject {
  /** Secteur scanné — toujours 'autre' côté appelant aujourd'hui. */
  readonly sector: ImageTheme;
  /** Sujet FR exact énoncé dans la demande (« boucherie », « piano »…). */
  readonly hint: string;
}

/** Mêmes regex que COMPILED, réutilisées pour extraire le sujet FR trouvé. */
const SUBJECT_COMPILED: ReadonlyArray<{ readonly re: RegExp }> = SECTOR_QUERY_ENTRIES.map((entry) => ({
  re: new RegExp('(^|[^a-z])(' + entry.pattern + ')(?=[^a-z]|$)'),
}));

/** Formes SIMPLES du lexique (sans espace), pour la passe fuzzy singulier/pluriel. */
const SUBJECT_SIMPLE_FORMS: ReadonlyArray<{ readonly form: string }> = SECTOR_QUERY_ENTRIES.flatMap((entry) =>
  entry.pattern
    .split('|')
    .filter((form) => !form.includes(' '))
    .map((form) => ({ form })));

/**
 * Résout le sujet métier d'une demande classée 'autre'.
 * - secteur mappé → `null` immédiat : son réservoir fait autorité ;
 * - passe 1 : mots entiers, MÊME arbitrage que deriveSectorPhotoQuery
 *   (l'expression qui couvre le plus de mots l'emporte ; à égalité,
 *   l'ordre du lexique tranche) ;
 * - passe 2 (fuzzy léger, LOT 1.3) : tolérance singulier/pluriel NON
 *   énumérés — chaque token du texte est essayé avec/sans 's' final
 *   contre les formes simples. Aucun stemmage au-delà (« viande » ne
 *   rejoindra jamais « boucheron ») : la précision prime, l'échec retombe
 *   sur `null` = pool neutre historique (comportement inchangé pour
 *   l'inconnu).
 *
 * Le hint rendu est le SUJET EXACT ÉNONCÉ dans la demande (« boucherie »,
 * « piano », « magasin bio »...) — pas la première forme du pattern : un
 * fabricant de piano n'est pas un conservatoire.
 */
export function resolveImageSubject(
  sector: ImageTheme,
  prompt: string,
  contextTitle = ''
): ImageSubject | null {
  if (sector !== 'autre') return null;
  const folded = stripNegations(fold(`${prompt ?? ''} ${contextTitle ?? ''}`));
  if (folded.trim().length === 0) return null;
  let bestScore = 0;
  let bestHint: string | null = null;
  for (const item of SUBJECT_COMPILED) {
    const match = item.re.exec(folded);
    if (!match) continue;
    const matched = (match[2] || '').trim();
    if (matched.length === 0) continue;
    const score = matched.split(/\s+/).length;
    if (score > bestScore) {
      bestScore = score;
      bestHint = matched;
    }
  }
  if (bestHint !== null) return { sector, hint: bestHint };
  const tokens = folded.split(/[^a-z]+/).filter((token) => token.length >= 4);
  for (const token of tokens) {
    const variants = token.endsWith('s') ? [token.slice(0, -1), token] : [token, `${token}s`];
    for (const item of SUBJECT_SIMPLE_FORMS) {
      if (variants.includes(item.form)) return { sector, hint: item.form };
    }
  }
  return null;
}
