/**
 * LOT A (É53) — MUTATION CONTRACT : périmètre vérifiable des mutations IA.
 *
 * Cause racine TC1 (audit architectural transversal, 2026-11-15) : le pont
 * `/stream` transmettait un `UPDATE_FILE` portant le document ENTIER sans
 * aucun invariant — une modification ciblée pouvait implicitement
 * reconstruire ou détruire le reste du document (preuves É52 : 7/10
 * engagements perdus, S09a/S10 destructifs, S14 fragment aborté).
 *
 * Ce module apporte les trois pièces du contrat, de façon DÉTERMINISTE
 * (aucune appréciation LLM, aucune dépendance à la syntaxe seule) :
 *
 *   1. `extractDocumentInventory` — inventaire des éléments réellement
 *      identifiables du document (sections data-section, titre, h1/h2,
 *      formulaires, images, boutons, navigation, polices).
 *   2. `buildMutationContract` — cibles autorisées (demande appariée à
 *      l'inventaire), éléments protégés, suppressions explicitement
 *      autorisées, périmètre (modification ciblée / reconstruction complète
 *      explicitement demandée / création).
 *   3. `verifyMutationContract` — comparaison avant/après élément par
 *      élément. Toute perte d'un élément protégé non autorisée = refus.
 *      L'absence de preuve suffisante (document non identifiable) = refus
 *      prudent de toute opération destructive.
 *
 * Frontières (mission É53-Lot A) :
 *   - `guardAiWrite` (É51) reste la frontière de sécurité des écritures HTML
 *     — ce module se branche AU-DESSUS, il ne court-circuite rien.
 *   - La vérification est sémantique et par élément : une simple comparaison
 *     de chaînes ou de longueurs ne suffit jamais à prouver la préservation.
 *   - Le refus empêche le commit : `assertMutationContractCompliance` est
 *     appelé par `service.ts` AVANT le snapshot, donc AVANT toute écriture ;
 *     le pont `/stream` l'appelle aussi avant même de créer un plan.
 */

import { createHash } from 'node:crypto';
import type {
  ContractElementCheck,
  ContractElementKind,
  ContractViolation,
  DeletionAuthorization,
  MutationContract,
  MutationContractCheck,
  MutationPlan,
  OperationScope,
  ProtectedElement,
  SourceRevisionRef
} from './types.js';
import { MutationContractViolationError } from './types.js';
import type { IMutableFileSource } from './filesystem/adapter.js';

// ============================================================================
// 1. NORMALISATION (déterministe)
// ============================================================================

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': '\'',
  '&apos;': '\'',
  '&nbsp;': ' '
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

/** Texte visible : scripts/styles retirés, balises retirées, espaces réduits. */
function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

/** Minuscules + diacritiques retirés (appariement fr/en tolérant aux accents). */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokenize(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/** Couverture des tokens du texte initial par le texte final (rappel ≥ 1.0). */
function tokenCoverage(beforeText: string, afterText: string): number {
  const before = new Set(tokenize(beforeText));
  if (before.size === 0) return 1;
  const after = new Set(tokenize(afterText));
  let kept = 0;
  for (const token of before) {
    if (after.has(token)) kept++;
  }
  return kept / before.size;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ============================================================================
// 2. INVENTAIRE DU DOCUMENT (éléments réellement identifiables)
// ============================================================================

export interface InventorySection {
  readonly id: string;
  /** Texte visible normalisé du bloc (fidélité). */
  readonly text: string;
  /** Empreinte de présence brute : `data-section="id"`. */
  readonly presenceFingerprint: string;
}

export interface DocumentInventory {
  readonly title: string;
  readonly headings: ReadonlyArray<{ text: string; raw: string; ownerSectionId?: string }>;
  readonly sections: readonly InventorySection[];
  readonly forms: number;
  /** Empreintes d'images (basename du src, ou `alt:<alt>` pour les data-URI). */
  readonly images: ReadonlyArray<{ fingerprint: string; label: string; ownerSectionId?: string }>;
  readonly buttons: ReadonlyArray<{ text: string; raw: string; ownerSectionId?: string; inForm: boolean }>;
  readonly navPresent: boolean;
  readonly fonts: readonly string[];
  /** Nombre total de signaux identifiables (0 = document non inventoriale). */
  readonly identifiableCount: number;
}

interface PositionedBlock {
  readonly start: number;
  readonly end: number;
  readonly id?: string;
}

function ownerOf(positioned: readonly PositionedBlock[], index: number): string | undefined {
  for (const block of positioned) {
    if (index >= block.start && index < block.end) return block.id;
  }
  return undefined;
}

/**
 * Extraction déterministe des éléments identifiables. Conventions alignées
 * sur le flux `/stream` (blocs `data-section` — cf. conversation.ts).
 */
export function extractDocumentInventory(html: string): DocumentInventory {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? visibleText(titleMatch[1] ?? '').slice(0, 120) : '';

  // Blocs data-section (positions pour rattacher les éléments internes).
  const positioned: PositionedBlock[] = [];
  const sectionRe = /<div[^>]*data-section="([^"]+)"[^>]*>([\s\S]*?)(?=<div[^>]*data-section=|<\/body>|$)/gi;
  const sections: InventorySection[] = [];
  let match: RegExpExecArray | null;
  while ((match = sectionRe.exec(html)) !== null) {
    const current = match;
    const id = (current[1] || '').trim();
    if (!id) continue;
    positioned.push({ start: current.index, end: current.index + current[0].length, id });
    sections.push({
      id,
      text: visibleText(current[2] ?? '').slice(0, 4000),
      presenceFingerprint: `data-section="${id}"`
    });
  }

  // Titres h1/h2.
  const headings: Array<{ text: string; raw: string; ownerSectionId?: string }> = [];
  const headingRe = /<h([12])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((match = headingRe.exec(html)) !== null) {
    const current = match;
    const raw = decodeEntities(current[2] ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    const owner = ownerOf(positioned, current.index);
    headings.push({
      text: visibleText(raw).slice(0, 120),
      raw: raw.slice(0, 120),
      ...(owner !== undefined ? { ownerSectionId: owner } : {})
    });
  }

  // Formulaires.
  const forms = (html.match(/<form\b/gi) || []).length;
  // Plages <form> : pour rattacher les boutons portés par un formulaire
  // (la suppression/le retouchage du formulaire entraîne les siens).
  const formRanges: PositionedBlock[] = [];
  const formRangeRe = /<form\b[^>]*>([\s\S]*?)<\/form>/gi;
  while ((match = formRangeRe.exec(html)) !== null) {
    const current = match;
    formRanges.push({ start: current.index, end: current.index + current[0].length });
  }

  // Images : src (basename) ou alt pour les data-URI ; jamais une image
  // non identifiable n'est déclarée protégée (limite documentée).
  const images: Array<{ fingerprint: string; label: string; ownerSectionId?: string }> = [];
  const imgRe = /<img\b[^>]*>/gi;
  while ((match = imgRe.exec(html)) !== null) {
    const current = match;
    const tag = current[0];
    const src = (tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    const alt = (tag.match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    let fingerprint: string | undefined;
    let label = '';
    if (/^data:/i.test(src)) {
      if (alt.trim()) {
        fingerprint = `alt:${visibleText(alt).slice(0, 60)}`;
        label = `image « ${visibleText(alt).slice(0, 40)} »`;
      }
    } else if (src.trim()) {
      const base = (src.split(/[?#]/)[0] ?? src).split('/').pop() || src;
      if (base.trim()) {
        fingerprint = base.trim();
        label = `image « ${base.trim().slice(0, 40)} »`;
      }
    }
    if (fingerprint) {
      const owner = ownerOf(positioned, current.index);
      images.push({ fingerprint, label, ...(owner !== undefined ? { ownerSectionId: owner } : {}) });
    }
  }

  // Boutons.
  const buttons: Array<{ text: string; raw: string; ownerSectionId?: string; inForm: boolean }> = [];
  const buttonRe = /<button\b[^>]*>([\s\S]*?)<\/button>/gi;
  while ((match = buttonRe.exec(html)) !== null) {
    const current = match;
    const raw = decodeEntities(current[1] ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    const index = current.index;
    const inForm = formRanges.some((f) => index >= f.start && index < f.end);
    const owner = ownerOf(positioned, index);
    buttons.push({
      text: visibleText(raw).slice(0, 60),
      raw: raw.slice(0, 60),
      inForm,
      ...(owner !== undefined ? { ownerSectionId: owner } : {})
    });
  }

  const navPresent = /<nav\b/i.test(html);

  // Polices : déclarations font-family + lien Google Fonts (empreinte stable).
  const fonts = new Set<string>();
  const fontRe = /font-family\s*:\s*([^;}]{1,80})/gi;
  while ((match = fontRe.exec(html)) !== null) {
    const current = match;
    const first = ((current[1] ?? '').split(',')[0] ?? '').trim().replace(/^['"]+|['"]+$/g, '');
    if (first) fonts.add(first.toLowerCase().slice(0, 40));
  }
  if (/fonts\.(googleapis|gstatic)\.com/i.test(html)) {
    fonts.add('google-fonts');
  }

  const identifiableCount =
    sections.length +
    headings.length +
    images.length +
    buttons.length +
    fonts.size +
    (forms > 0 ? 1 : 0) +
    (navPresent ? 1 : 0) +
    (title ? 1 : 0);

  return {
    title,
    headings,
    sections,
    forms,
    images,
    buttons,
    navPresent,
    fonts: Array.from(fonts).sort(),
    identifiableCount
  };
}

// ============================================================================
// 3. DÉTECTION DES CIBLES (demande appariée à l'inventaire, déterministe)
// ============================================================================

interface TargetDetection {
  readonly targetedSectionIds: ReadonlySet<string>;
  readonly targetedKinds: ReadonlySet<Exclude<ContractElementKind, 'section'>>;
  readonly targetedButtonKeys: ReadonlySet<string>;
  readonly targetedImageKeys: ReadonlySet<string>;
  readonly deletionRequested: boolean;
  readonly rebuildRequested: boolean;
}

// LOT A-C1 — les verbes de REMPLACEMENT (« remplace/substitue X par Y »)
// sont des verbes de reconstruction quand la portée est totale : « Remplace
// tout le contenu de la page par juste un grand titre Bienvenue » est une
// reconstruction totale explicite. Les verbes de suppression restent HORS de
// cette liste : « supprime tout » n'est jamais une reconstruction.
const REBUILD_VERB = /\b(reconstrui\w*|refais|refaire|recommenc\w*|reecris|reecrit\w*|recode\w*|regenere\w*|rewrite|rebuild|repart\w*\s+(?:de\s+)?zero|de\s+zero|from\s+scratch|a\s+partir\s+de\s+zero|remplac\w*|substi\w*|replaces?|overwrit\w*)\b/i;
const TOTALITY = /\b(tout|toute|tous|entier|entiere|entièrement|complet|complete|whole|everything|entirely)\b/i;
const DELETE_VERB = /\b(supprim\w*|enlev\w*|retir\w*|effac\w*|remove|delete|erase)\b/i;

/**
 * LOT A-C1 — marqueur de REMPLACEMENT : ce qui SUIT « par/avec/en … »
 * décrit le NOUVEAU contenu, pas une cible (« …par juste un grand titre
 * Bienvenue »). Utilisé UNIQUEMENT pour tronquer le message dans la
 * décision de reconstruction ; la détection ciblée (protégés, exemptions)
 * continue d'utiliser le message ENTIERS.
 */
const REPLACEMENT_MARKER_RE = /\b(?:par|avec|en)\s+/i;

const KIND_KEYWORDS: ReadonlyArray<{ kind: Exclude<ContractElementKind, 'section'>; re: RegExp }> = [
  { kind: 'title', re: /\btitres?\b|\btitle\b|\bnom de page\b/ },
  { kind: 'button', re: /\bboutons?\b|\bbuttons?\b|\bcta\b/ },
  { kind: 'form', re: /\bformulaires?\b|\bforms?\b|\bchamps?\b/ },
  { kind: 'image', re: /\bimages?\b|\bphotos?\b|\bvisuels?\b|\billustrations?\b|\bimg\b/ },
  { kind: 'font', re: /\bpolices?\b|\btypographie\b|\bfonts?\b/ },
  { kind: 'nav', re: /\bnavigation\b|\bmenu\b|\bnavbar\b|\bheader\b|\bentete\b|\bbandeau\b/ }
];

/**
 * Les occurrences de mots-clés SITUÉES DANS UNE VALEUR CITÉE (« … » ou "…")
 * ne sont pas des références de cible : « Change le titre en "Studio Photo
 * Lyon" » ne vise pas les images. Détection par plages de caractères.
 */
function quotedRangesOf(msg: string): ReadonlyArray<{ s: number; e: number }> {
  const ranges: Array<{ s: number; e: number }> = [];
  const qre = /[«"“]([^«»"”]*)[»"”]/g;
  let qm: RegExpExecArray | null;
  while ((qm = qre.exec(msg)) !== null) {
    const current = qm;
    ranges.push({ s: current.index, e: current.index + current[0].length });
  }
  return ranges;
}

/** Synonymes fr↔en par famille de section (appariement sémantique minimal). */
const SECTION_FAMILIES: ReadonlyArray<{ family: string; keys: readonly string[] }> = [
  { family: 'testimonials', keys: ['testimonial', 'temoignage', 'avis', 'review'] },
  { family: 'pricing', keys: ['pricing', 'tarif', 'prix', 'offre', 'plan'] },
  { family: 'about', keys: ['about', 'apropos', 'presentation', 'quipe'] },
  { family: 'hero', keys: ['hero', 'accueil', 'banniere', 'banner', 'cover'] },
  { family: 'contact', keys: ['contact'] },
  { family: 'faq', keys: ['faq', 'question'] },
  { family: 'features', keys: ['feature', 'fonctionnalite', 'service', 'service'] },
  { family: 'gallery', keys: ['gallery', 'galerie', 'portfolio'] },
  { family: 'header', keys: ['header', 'entete', 'nav', 'menu'] },
  { family: 'footer', keys: ['footer', 'pied'] },
  { family: 'cta', keys: ['cta', 'action'] }
];

function familyOfSectionId(sectionId: string): string | undefined {
  const idTokens = new Set(tokenize(sectionId.replace(/[-_]+/g, ' ')));
  for (const { family, keys } of SECTION_FAMILIES) {
    for (const key of keys) {
      if (idTokens.has(key)) return family;
    }
  }
  return undefined;
}

/**
 * Appariement message → cibles, sur un PÉRIMÈTRE DE TEXTE donné. Appelé
 * deux fois par `detectTargets` : sur le message entier (détection ciblée,
 * protégés, exemptions) et, pour la décision de reconstruction uniquement,
 * sur le message tronqué au marqueur de remplacement.
 */
function matchTargets(
  msg: string,
  msgTokens: ReadonlySet<string>,
  inventory: DocumentInventory
): Pick<TargetDetection, 'targetedSectionIds' | 'targetedKinds' | 'targetedButtonKeys' | 'targetedImageKeys'> {
  // Sections ciblées : id présent dans le message, tokens partagés, ou
  // famille sémantique commune (tarifs ↔ pricing, témoignages ↔ testimonials…).
  const targetedSectionIds = new Set<string>();
  const families = new Set<string>();
  for (const section of inventory.sections) {
    const idNorm = fold(section.id.replace(/[-_]+/g, ' '));
    const idTokens = tokenize(section.id.replace(/[-_]+/g, ' '));
    const idMatched = msg.includes(idNorm) || idTokens.every((t) => msgTokens.has(t));
    if (idMatched) {
      targetedSectionIds.add(section.id);
      const family = familyOfSectionId(section.id);
      if (family) families.add(family);
    }
  }
  for (const { family, keys } of SECTION_FAMILIES) {
    for (const key of keys) {
      if (msgTokens.has(key)) {
        families.add(family);
        for (const section of inventory.sections) {
          if (familyOfSectionId(section.id) === family) targetedSectionIds.add(section.id);
        }
        break;
      }
    }
  }

  // Kinds d'éléments ciblés — hors valeurs citées (le mot-clé dans « … » est
  // une donnée, pas une référence de cible).
  const targetedKinds = new Set<Exclude<ContractElementKind, 'section'>>();
  const quotedRanges = quotedRangesOf(msg);
  const inQuotes = (index: number): boolean => quotedRanges.some((r) => index >= r.s && index < r.e);
  for (const { kind, re } of KIND_KEYWORDS) {
    const m = re.exec(msg);
    if (m && !inQuotes(m.index)) targetedKinds.add(kind);
  }
  // « titre » vise aussi les titres internes (h1/h2).
  if (targetedKinds.has('title')) targetedKinds.add('heading');

  // Boutons ciblés : le texte du bouton apparaît dans le message → bouton
  // précis ; sinon kind générique (tous les boutons modifiables).
  const targetedButtonKeys = new Set<string>();
  if (targetedKinds.has('button')) {
    for (const button of inventory.buttons) {
      const btnTokens = tokenize(button.text);
      if (btnTokens.length > 0 && btnTokens.every((t) => msgTokens.has(t))) {
        targetedButtonKeys.add(fold(button.raw));
      }
    }
  }

  // Images ciblées : alt/basename présent dans le message.
  const targetedImageKeys = new Set<string>();
  if (targetedKinds.has('image')) {
    for (const image of inventory.images) {
      const key = fold(image.fingerprint.replace(/[-_.]+/g, ' '));
      if (key && msg.includes(key)) targetedImageKeys.add(image.fingerprint);
    }
  }

  return {
    targetedSectionIds,
    targetedKinds,
    targetedButtonKeys,
    targetedImageKeys
  };
}

function detectTargets(message: string, intentCategory: string | undefined, inventory: DocumentInventory): TargetDetection {
  const msg = fold(message);
  const msgTokens = new Set(tokenize(message));
  const matched = matchTargets(msg, msgTokens, inventory);

  // LOT A-C1 — décision de reconstruction : verbe + totalité sont évalués
  // sur le message ENTIERS ; les cibles le sont sur le message tronqué AU
  // PREMIER marqueur de remplacement (« par/avec/en … ») : la description
  // du NOUVEAU contenu (« …par juste un grand titre Bienvenue ») n'est pas
  // une cible. Sans marqueur exploitable : comportement historique (message
  // entier, fail-closed). Une cible nommée AVANT le marqueur (« …de la
  // page d'accueil par… ») reste une cible → modification ciblée.
  let rebuildRequested = false;
  if (REBUILD_VERB.test(msg) && TOTALITY.test(msg)) {
    const marker = REPLACEMENT_MARKER_RE.exec(msg);
    const scopeMsg = marker !== null && marker.index > 0 ? msg.slice(0, marker.index) : msg;
    const scopeMatched = scopeMsg === msg
      ? matched
      : matchTargets(scopeMsg, new Set(tokenize(scopeMsg)), inventory);
    rebuildRequested = scopeMatched.targetedSectionIds.size === 0 && scopeMatched.targetedKinds.size === 0;
  }

  return {
    ...matched,
    deletionRequested: intentCategory === 'DELETE' || DELETE_VERB.test(msg),
    rebuildRequested
  };
}

// ============================================================================
// 4. CONSTRUCTION DU CONTRAT
// ============================================================================

export interface BuildMutationContractParams {
  readonly beforeHtml: string;
  readonly userMessage?: string | undefined;
  readonly intentCategory?: string | undefined;
  readonly targetFiles: readonly string[];
  readonly mode: 'create' | 'update';
}

/**
 * Construit le contrat de mutation. Règles de périmètre :
 *   1. éléments explicitement ciblés par l'utilisateur → modifiables ;
 *   2. éléments nécessaires à la modification (contenus dans une section
 *      ciblée) → modifiables ;
 *   3. tout élément existant identifié, non ciblé et non autorisé à la
 *      suppression → PROTÉGÉ ;
 *   4. suppression explicite (verbe de suppression + élément apparié, ou
 *      intent DELETE) → `allowedDeletions` (retiré des protégés).
 * Une modification ciblée n'autorise JAMAIS implicitement une reconstruction
 * du reste : le scope `full-rebuild` exige verbe + totalité sans cible précise.
 */
export function buildMutationContract(params: BuildMutationContractParams): MutationContract {
  const beforeHtml = params.beforeHtml ?? '';
  const message = params.userMessage ?? '';
  const inventory = extractDocumentInventory(beforeHtml);
  const detection = detectTargets(message, params.intentCategory, inventory);
  const requestDigest = message.trim().slice(0, 160);
  const targetFiles = Object.freeze([...params.targetFiles]);
  const sourceRevision: SourceRevisionRef = Object.freeze({
    ...(beforeHtml ? { contentHash: sha256(beforeHtml) } : {})
  });

  // Création : rien à préserver (contrat explicite mais protection vide).
  if (params.mode === 'create' || beforeHtml.trim().length === 0) {
    return Object.freeze({
      contractVersion: '1.0.0' as const,
      targetFiles,
      protectedContent: Object.freeze([]),
      allowedDeletions: Object.freeze([]),
      requiredInvariants: Object.freeze([]),
      sourceRevision,
      operationScope: Object.freeze({
        kind: 'creation',
        requestedTargets: Object.freeze([]),
        requestDigest,
        rebuildExplicitlyRequested: false,
        inventoryReliable: false
      } satisfies OperationScope)
    });
  }

  // Reconstruction complète EXPLICITEMENT demandée : tout est remplaçable,
  // l'autorisation reste traçée (preuve : extrait de la demande).
  if (detection.rebuildRequested) {
    return Object.freeze({
      contractVersion: '1.0.0' as const,
      targetFiles,
      protectedContent: Object.freeze([]),
      allowedDeletions: Object.freeze([]),
      requiredInvariants: Object.freeze([]),
      sourceRevision,
      operationScope: Object.freeze({
        kind: 'full-rebuild',
        requestedTargets: Object.freeze([]),
        requestDigest,
        rebuildExplicitlyRequested: true,
        inventoryReliable: inventory.identifiableCount > 0
      } satisfies OperationScope)
    });
  }

  // --- Éléments protégés & autorisations de suppression ---
  const protectedContent: ProtectedElement[] = [];
  const allowedDeletions: DeletionAuthorization[] = [];
  // LOT A — exemptions de fidélité : tokens des éléments ciblés ou
  // autorisés à la suppression, exclus du contrôle de couverture de LEUR
  // section porteuse (l'utilisateur a autorisé leur changement).
  const sectionExemptions = new Map<string, Set<string>>();
  const exemptTokens = (sectionId: string | undefined, text: string): void => {
    if (!sectionId) return;
    let set = sectionExemptions.get(sectionId);
    if (!set) {
      set = new Set<string>();
      sectionExemptions.set(sectionId, set);
    }
    for (const token of tokenize(text)) set.add(token);
  };

  const isProtectedSection = (sectionId: string): boolean =>
    !detection.targetedSectionIds.has(sectionId) && !detection.deletionRequested;

  for (const section of inventory.sections) {
    if (isProtectedSection(section.id)) {
      protectedContent.push({
        elementId: `section:${section.id}`,
        kind: 'section',
        label: `section « ${section.id} »`,
        presenceFingerprint: section.presenceFingerprint
      });
    } else if (detection.deletionRequested && detection.targetedSectionIds.has(section.id)) {
      allowedDeletions.push({
        elementId: `section:${section.id}`,
        kind: 'section',
        label: `section « ${section.id} »`,
        evidence: requestDigest || params.intentCategory || 'DELETE'
      });
    }
  }

  // Titre <title> : protégé sauf si ciblé.
  if (inventory.title && !detection.targetedKinds.has('title')) {
    protectedContent.push({
      elementId: 'title',
      kind: 'title',
      label: `titre de page « ${inventory.title.slice(0, 40)} »`,
      presenceFingerprint: '<title'
    });
  }

  // Titres internes (h1/h2) : protégés hors sections ciblées / kind ciblé ;
  // ciblés → exempts de la couverture de leur section porteuse.
  for (const heading of inventory.headings) {
    const targeted =
      detection.targetedKinds.has('heading') ||
      (heading.ownerSectionId !== undefined && detection.targetedSectionIds.has(heading.ownerSectionId));
    if (targeted) {
      exemptTokens(heading.ownerSectionId, heading.raw);
      continue;
    }
    if (detection.deletionRequested && heading.raw && msgTokensInclude(message, heading.text)) {
      allowedDeletions.push({ elementId: `heading:${fold(heading.raw).slice(0, 40)}`, kind: 'heading', label: `titre « ${heading.text.slice(0, 40)} »`, evidence: requestDigest });
      exemptTokens(heading.ownerSectionId, heading.raw);
      continue;
    }
    protectedContent.push({
      elementId: `heading:${fold(heading.raw).slice(0, 40)}`,
      kind: 'heading',
      label: `titre « ${heading.text.slice(0, 40)} »`,
      presenceFingerprint: heading.raw,
      ...(heading.ownerSectionId !== undefined ? { ownerSectionId: heading.ownerSectionId } : {})
    });
  }

  // Formulaires : ciblés pour modification → modifiables ; suppression
  // demandée → autorisés ; sinon protégés. Les boutons portés par un
  // formulaire ciblé ou autorisé suivent le sort de leur conteneur.
  let formHandled = false;
  if (inventory.forms > 0) {
    const formMentioned = /\bformulaires?\b|\bforms?\b/.test(fold(message));
    if (detection.deletionRequested && formMentioned) {
      allowedDeletions.push({ elementId: 'form', kind: 'form', label: 'formulaire', evidence: requestDigest });
      formHandled = true;
    } else if (!detection.targetedKinds.has('form')) {
      protectedContent.push({ elementId: 'form', kind: 'form', label: 'formulaire', presenceFingerprint: '<form' });
      formHandled = true;
    }
  }
  const formFollowed = formHandled && (detection.targetedKinds.has('form') || allowedDeletions.some((d) => d.elementId === 'form'));

  // Images.
  for (const image of inventory.images) {
    const targeted =
      (detection.targetedKinds.has('image') && detection.targetedImageKeys.size === 0) ||
      detection.targetedImageKeys.has(image.fingerprint) ||
      (image.ownerSectionId !== undefined && detection.targetedSectionIds.has(image.ownerSectionId));
    if (targeted) {
      exemptTokens(image.ownerSectionId, image.fingerprint);
      continue;
    }
    if (detection.deletionRequested && msgTokensInclude(message, image.label)) {
      allowedDeletions.push({ elementId: `image:${image.fingerprint}`, kind: 'image', label: image.label, evidence: requestDigest });
      exemptTokens(image.ownerSectionId, image.fingerprint);
      continue;
    }
    protectedContent.push({
      elementId: `image:${image.fingerprint}`,
      kind: 'image',
      label: image.label,
      presenceFingerprint: image.fingerprint,
      ...(image.ownerSectionId !== undefined ? { ownerSectionId: image.ownerSectionId } : {})
    });
  }

  // Boutons.
  for (const button of inventory.buttons) {
    if (button.inForm && formFollowed) continue;
    const targeted =
      (detection.targetedKinds.has('button') && detection.targetedButtonKeys.size === 0) ||
      detection.targetedButtonKeys.has(fold(button.raw)) ||
      (button.ownerSectionId !== undefined && detection.targetedSectionIds.has(button.ownerSectionId));
    if (targeted) {
      exemptTokens(button.ownerSectionId, button.raw);
      continue;
    }
    if (detection.deletionRequested && msgTokensInclude(message, button.text)) {
      allowedDeletions.push({ elementId: `button:${fold(button.raw).slice(0, 40)}`, kind: 'button', label: `bouton « ${button.text.slice(0, 40)} »`, evidence: requestDigest });
      exemptTokens(button.ownerSectionId, button.raw);
      continue;
    }
    protectedContent.push({
      elementId: `button:${fold(button.raw).slice(0, 40)}`,
      kind: 'button',
      label: `bouton « ${button.text.slice(0, 40)} »`,
      presenceFingerprint: button.raw,
      ...(button.ownerSectionId !== undefined ? { ownerSectionId: button.ownerSectionId } : {})
    });
  }

  // Navigation.
  if (inventory.navPresent && !detection.targetedKinds.has('nav')) {
    if (detection.deletionRequested && /\bnavigation\b|\bmenu\b/.test(fold(message))) {
      allowedDeletions.push({ elementId: 'nav', kind: 'nav', label: 'navigation', evidence: requestDigest });
    } else {
      protectedContent.push({ elementId: 'nav', kind: 'nav', label: 'navigation', presenceFingerprint: '<nav' });
    }
  }

  // Polices.
  for (const font of inventory.fonts) {
    if (detection.targetedKinds.has('font')) continue;
    protectedContent.push({
      elementId: `font:${font}`,
      kind: 'font',
      label: `police « ${font} »`,
      presenceFingerprint: font === 'google-fonts' ? 'fonts.googleapis' : font
    });
  }

  // Invariant post-mutation : présence des empreintes des éléments protégés
  // (borne : 60 éléments, empreintes brutes ≤ 120 caractères).
  const presence = protectedContent
    .slice(0, 60)
    .map((p) => ({ elementId: p.elementId, fingerprint: p.presenceFingerprint.slice(0, 120) }));
  const requiredInvariants = presence.length
    ? [
        {
          kind: 'CONTENT_PRESERVED' as const,
          target: targetFiles[0] ?? 'index.html',
          description: 'LOT A — les éléments protégés du document existant restent présents après mutation',
          expectedValue: JSON.stringify(presence)
        }
      ]
    : [];

  const requestedTargets: string[] = [
    ...detection.targetedSectionIds,
    ...Array.from(detection.targetedKinds).map((k) => `kind:${k}`)
  ];

  const coverageExemptions: Record<string, string[]> = {};
  for (const [sectionId, tokensSet] of sectionExemptions.entries()) {
    if (tokensSet.size > 0) coverageExemptions[sectionId] = Array.from(tokensSet).sort();
  }

  const scopeKind: OperationScope['kind'] =
    allowedDeletions.length > 0 && detection.deletionRequested ? 'deletion' : 'targeted-modification';

  return Object.freeze({
    contractVersion: '1.0.0' as const,
    targetFiles,
    protectedContent: Object.freeze(protectedContent.map((p) => Object.freeze(p))),
    allowedDeletions: Object.freeze(allowedDeletions.map((d) => Object.freeze(d))),
    requiredInvariants: Object.freeze(requiredInvariants.map((i) => Object.freeze(i))),
    sourceRevision,
    operationScope: Object.freeze({
      kind: scopeKind,
      requestedTargets: Object.freeze(requestedTargets),
      requestDigest,
      rebuildExplicitlyRequested: false,
      inventoryReliable: inventory.identifiableCount > 0
    } satisfies OperationScope),
    ...(Object.keys(coverageExemptions).length > 0
      ? { coverageExemptions: Object.freeze(Object.fromEntries(Object.entries(coverageExemptions).map(([k, v]) => [k, Object.freeze(v)]))) }
      : {})
  });
}

function msgTokensInclude(message: string, label: string): boolean {
  const labelTokens = tokenize(label);
  if (labelTokens.length === 0) return false;
  const msgTokens = new Set(tokenize(message));
  return labelTokens.every((t) => msgTokens.has(t));
}

// ============================================================================
// 5. VÉRIFICATION AVANT PERSISTANCE (comparaison avant/après par élément)
// ============================================================================

/** Seuil de fidélité textuelle d'une section protégée non ciblée. */
const SECTION_FIDELITY_THRESHOLD = 0.85;
/** Seuil fail-closed sur un document sans aucun élément identifiable. */
const BLIND_DOC_THRESHOLD = 0.9;

/**
 * Vérifie le contrat entre le contenu existant et le contenu proposé.
 * Déterministe, par élément : présence + fidélité (couverture de tokens),
 * jamais une comparaison de longueurs. Fail-closed : document non
 * identifiable + opération destructive → refus explicite.
 */
export function verifyMutationContract(
  contract: MutationContract | undefined,
  beforeHtml: string,
  afterHtml: string
): MutationContractCheck {
  if (!contract || contract.contractVersion !== '1.0.0') {
    return {
      allowed: false,
      violations: [{ code: 'MALFORMED_CONTRACT', message: 'Contrat de mutation absent ou illisible' }],
      checks: []
    };
  }

  const scope = contract.operationScope;
  // Création ou reconstruction explicitement demandée : rien à préserver.
  if (scope.kind === 'creation' || scope.kind === 'full-rebuild') {
    return {
      allowed: true,
      violations: [],
      checks: [{ elementId: '*', verdict: 'targeted', detail: `scope ${scope.kind}` }]
    };
  }

  const before = extractDocumentInventory(beforeHtml);
  const after = extractDocumentInventory(afterHtml);
  const violations: ContractViolation[] = [];
  const checks: ContractElementCheck[] = [];

  // Cohérence de la révision de référence (le contenu au moment du contrat).
  if (contract.sourceRevision?.contentHash && sha256(beforeHtml) !== contract.sourceRevision.contentHash) {
    violations.push({
      code: 'SOURCE_REVISION_MISMATCH',
      message: 'Le contenu du fichier a changé depuis la construction du contrat (révision de référence obsolète)'
    });
  }

  // Fail-closed : document existant substantiel mais AUCUN élément
  // identifiable → la préservation ne peut pas être prouvée par élément.
  // Une opération qui perd plus de 10 % des tokens est refusée.
  if (before.identifiableCount === 0 && beforeHtml.trim().length >= 500) {
    const coverage = tokenCoverage(visibleText(beforeHtml), visibleText(afterHtml));
    if (coverage < BLIND_DOC_THRESHOLD) {
      violations.push({
        code: 'PRESERVATION_UNVERIFIABLE',
        message: `Préservation invérifiable : le document existant n'a aucun élément identifiable et ${Math.round((1 - coverage) * 100)} % de son contenu disparaîtrait`
      });
      return { allowed: false, violations, checks };
    }
  }

  const protectedById = new Map(contract.protectedContent.map((p) => [p.elementId, p]));

  // --- Sections ---
  for (const p of contract.protectedContent) {
    if (p.kind !== 'section') continue;
    const sectionId = p.elementId.slice('section:'.length);
    const beforeSection = before.sections.find((s) => s.id === sectionId);
    const afterSection = after.sections.find((s) => s.id === sectionId);
    if (!afterSection) {
      violations.push({
        code: 'PROTECTED_CONTENT_LOST',
        elementId: p.elementId,
        message: `Contenu protégé perdu : la ${p.label} disparaîtrait (demande : « ${scope.requestDigest} »)`
      });
      checks.push({ elementId: p.elementId, verdict: 'lost' });
      continue;
    }
    const beforeText = beforeSection?.text ?? '';
    // Les tokens des éléments ciblés / autorisés à la suppression de cette
    // section sont exclus du contrôle (l'utilisateur a autorisé leur changement).
    const exempt = new Set(contract.coverageExemptions?.[sectionId] ?? []);
    const beforeTokens = tokenize(beforeText).filter((t) => !exempt.has(t));
    const afterTokens = new Set(tokenize(afterSection.text));
    let keptTokens = 0;
    for (const token of beforeTokens) {
      if (afterTokens.has(token)) keptTokens++;
    }
    const coverage = beforeTokens.length === 0 ? 1 : keptTokens / beforeTokens.length;
    if (coverage < SECTION_FIDELITY_THRESHOLD) {
      violations.push({
        code: 'PROTECTED_CONTENT_LOST',
        elementId: p.elementId,
        message: `Contenu protégé dégradé : ${Math.round((1 - coverage) * 100)} % du texte de la ${p.label} disparaîtrait (seuil ${Math.round(SECTION_FIDELITY_THRESHOLD * 100)} %)`
      });
      checks.push({ elementId: p.elementId, verdict: 'lost', detail: `coverage ${(coverage * 100).toFixed(0)}%` });
    } else {
      checks.push({ elementId: p.elementId, verdict: 'preserved', detail: `coverage ${(coverage * 100).toFixed(0)}%` });
    }
  }

  // --- Titre ---
  const titleProtected = contract.protectedContent.find((p) => p.kind === 'title');
  if (titleProtected) {
    if (!after.title) {
      violations.push({ code: 'PROTECTED_CONTENT_LOST', elementId: 'title', message: `Contenu protégé perdu : le ${titleProtected.label} disparaîtrait` });
      checks.push({ elementId: 'title', verdict: 'lost' });
    } else {
      checks.push({ elementId: 'title', verdict: 'preserved' });
    }
  }

  // --- Titres internes (h1/h2) ---
  for (const p of contract.protectedContent) {
    if (p.kind !== 'heading') continue;
    const stillThere = after.headings.some((h) => fold(h.raw) === fold(p.presenceFingerprint));
    if (!stillThere) {
      violations.push({
        code: 'PROTECTED_CONTENT_LOST',
        elementId: p.elementId,
        message: `Contenu protégé perdu : le ${p.label} disparaîtrait`
      });
      checks.push({ elementId: p.elementId, verdict: 'lost' });
    } else {
      checks.push({ elementId: p.elementId, verdict: 'preserved' });
    }
  }

  // --- Formulaires (présence + nombre non décru) ---
  const formProtected = contract.protectedContent.find((p) => p.kind === 'form');
  if (formProtected) {
    if (after.forms < before.forms) {
      violations.push({
        code: 'PROTECTED_CONTENT_LOST',
        elementId: 'form',
        message: `Contenu protégé perdu : le ${formProtected.label} disparaîtrait (${before.forms} → ${after.forms})`
      });
      checks.push({ elementId: 'form', verdict: 'lost' });
    } else {
      checks.push({ elementId: 'form', verdict: 'preserved' });
    }
  }

  // --- Images ---
  for (const p of contract.protectedContent) {
    if (p.kind !== 'image') continue;
    const fingerprint = p.elementId.slice('image:'.length);
    const stillThere = after.images.some((i) => i.fingerprint === fingerprint);
    if (!stillThere) {
      violations.push({ code: 'PROTECTED_CONTENT_LOST', elementId: p.elementId, message: `Contenu protégé perdu : l'${p.label} disparaîtrait` });
      checks.push({ elementId: p.elementId, verdict: 'lost' });
    } else {
      checks.push({ elementId: p.elementId, verdict: 'preserved' });
    }
  }

  // --- Boutons ---
  for (const p of contract.protectedContent) {
    if (p.kind !== 'button') continue;
    const rawKey = fold(p.presenceFingerprint);
    const stillThere = after.buttons.some((b) => fold(b.raw) === rawKey);
    if (!stillThere) {
      violations.push({ code: 'PROTECTED_CONTENT_LOST', elementId: p.elementId, message: `Contenu protégé perdu : le ${p.label} disparaîtrait` });
      checks.push({ elementId: p.elementId, verdict: 'lost' });
    } else {
      checks.push({ elementId: p.elementId, verdict: 'preserved' });
    }
  }

  // --- Navigation ---
  const navProtected = contract.protectedContent.find((p) => p.kind === 'nav');
  if (navProtected && !after.navPresent) {
    violations.push({ code: 'PROTECTED_CONTENT_LOST', elementId: 'nav', message: `Contenu protégé perdu : la ${navProtected.label} disparaîtrait` });
    checks.push({ elementId: 'nav', verdict: 'lost' });
  } else if (navProtected) {
    checks.push({ elementId: 'nav', verdict: 'preserved' });
  }

  // --- Polices ---
  for (const p of contract.protectedContent) {
    if (p.kind !== 'font') continue;
    const fingerprint = p.elementId.slice('font:'.length);
    if (!after.fonts.includes(fingerprint)) {
      violations.push({ code: 'PROTECTED_CONTENT_LOST', elementId: p.elementId, message: `Contenu protégé perdu : la ${p.label} disparaîtrait` });
      checks.push({ elementId: p.elementId, verdict: 'lost' });
    } else {
      checks.push({ elementId: p.elementId, verdict: 'preserved' });
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
    checks: [
      ...checks,
      // Les suppressions autorisées sont explicitement tracées comme telles.
      ...contract.allowedDeletions.map((d) => ({ elementId: d.elementId, verdict: 'authorized-deletion' as const, detail: `autorisé par : ${d.evidence.slice(0, 60)}` }))
    ]
  };
}

/** Liste lisible des violations (messages de refus, traçabilité, Lot B). */
export function describeContractViolations(violations: readonly ContractViolation[]): string {
  return violations.map((v) => v.message).join(' | ');
}

// ============================================================================
// 6. APPLICATION CENTRALE (Mutation Orchestrator — AVANT toute écriture)
// ============================================================================

/**
 * Applique le contrat sur un plan AVANT le snapshot, donc AVANT toute
 * écriture : hors périmètre (fichier non autorisé) et perte de contenu
 * protégé = `MutationContractViolationError`. Le contenu existant est relu
 * depuis la source de fichiers réelle (jamais supposé).
 *
 * Mutations sans `operation.content` (UPDATE_SYMBOL…) : la préservation ne
 * peut pas être prouvée avant écriture ; elle repose alors sur l'invariant
 * post-mutation `CONTENT_PRESERVED` (évalué réellement par verification.ts,
 * avec rollback automatique en cas de violation).
 */
export function assertMutationContractCompliance(
  fileSource: IMutableFileSource,
  plan: MutationPlan,
  contract: MutationContract,
  requestId?: string | undefined
): void {
  for (const mutation of plan.mutations) {
    const path = mutation.operation.path;
    if (!contract.targetFiles.includes(path)) {
      throw new MutationContractViolationError(
        `Mutation hors périmètre : le contrat n'autorise que [${contract.targetFiles.join(', ')}], la mutation cible '${path}'`,
        { code: 'TARGET_OUT_OF_SCOPE', targetFiles: contract.targetFiles, mutationTarget: path },
        requestId
      );
    }
    if (typeof mutation.operation.content !== 'string') continue; // vérification post-écriture
    if (mutation.kind !== 'UPDATE_FILE' && mutation.kind !== 'CREATE_FILE') continue;

    const current = fileSource.getFile(plan.tenantId, plan.projectId, path);
    if (!current) continue; // précondition FILE_EXISTS/NOT_EXISTS déjà évaluée par le moteur

    // Contrat périmé : le fichier a changé depuis la construction du contrat.
    if (contract.sourceRevision?.contentHash && sha256(current.content) !== contract.sourceRevision.contentHash) {
      throw new MutationContractViolationError(
        'Contrat de mutation périmé : le contenu du fichier a changé depuis la construction du contrat',
        { code: 'SOURCE_REVISION_MISMATCH', path, expected: contract.sourceRevision.contentHash },
        requestId
      );
    }

    if (mutation.kind !== 'UPDATE_FILE') continue; // CREATE_FILE : rien à préserver
    const check = verifyMutationContract(contract, current.content, mutation.operation.content);
    if (!check.allowed) {
      throw new MutationContractViolationError(
        `Contrat de préservation violé : ${describeContractViolations(check.violations)}`,
        { code: check.violations[0]?.code ?? 'PROTECTED_CONTENT_LOST', violations: check.violations, checks: check.checks, path },
        requestId
      );
    }
  }
}
