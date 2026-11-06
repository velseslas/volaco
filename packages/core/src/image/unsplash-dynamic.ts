/**
 * VibeCode Core — LOT UNSPLASH-DYN (18/10) : source d'images dynamique par
 * clé usager (Unsplash Access Key fournie dans Réglages → API).
 *
 * Principe absolu — la réserve déterministe de theme.ts reste la vérité :
 *   - AUCUNE clé : ce module n'est pas appelé (zéro réseau, comportement
 *     strictement inchangé) ;
 *   - clé fournie : UNE recherche réelle par exécution (thème → requête
 *     métier anglaise) ; les photos RÉELLES adoptées servent au brief de
 *     génération (le LLM les propose) puis au sanitizer (conformité) ;
 *   - TOUT échec (réseau, 401/403/429, forme inattendue) → erreur levée,
 *     attrapée par l'appelant : la réserve déterministe reprend la main,
 *     jamais de génération bloquée.
 *
 * Honnêteté machine :
 *   - les URLs adoptées sont RECONSTRUITES en forme canonique (hôte exact
 *     images.unsplash.com + photo-ID strict + params figés) : aucun
 *     paramètre exotique de l'API ne traverse, aucune forme inattendue
 *     n'est adoptée « à moitié » ;
 *   - la pertinence est adossée à la REQUÊTE (mots-clés métier par thème) ;
 *     elle n'est PAS vérifiée au pixel ici — un résultat hors sujet reste
 *     possible dans l'échantillon rendu, jamais présenté comme contrôlé ;
 *   - la clé ne sort JAMAIS d'ici : aucun message d'erreur ni log ne la
 *     contient (elle ne vit que dans l'en-tête Authorization).
 */
import type { ImageTheme } from './theme.js';

/**
 * Requêtes métier par thème (anglais : le corpus Unsplash est anglophone).
 * Volontairement SOBRES (3-6 mots) : une requête trop fine rend zéro
 * résultat ; la cohérence du site tient au thème, pas à la devinette de
 * composition. Aucune requête ne contient d'URL ni d'ID.
 */
export const THEME_PHOTO_QUERY: Record<ImageTheme, string> = {
  restaurant: 'restaurant meal plating table',
  gelato: 'ice cream gelato dessert cup',
  clinique: 'modern clinic healthcare professional',
  hotel: 'hotel room interior reception',
  garage: 'car garage mechanic workshop',
  boutique: 'boutique clothing store shopping',
  saas: 'software team laptop dashboard',
  animalier: 'dog pet portrait outdoors',
  immobilier: 'modern house architecture exterior',
  avocat: 'lawyer office justice law books',
  coiffeur: 'barber shop men haircut',
  // LOT MÉTIERS (30/10) — requêtes ALIGNÉES SUR LE LEXIQUE sectoriel
  // (sector-queries.ts) : même autorité pour la voie « clé usager » et pour
  // le brief statique. Aucune requête nouvelle : celle des 5 métiers
  // déjà documentés dans le lexique (plombier l.55, serrurier l.57,
  // cordonnier l.123, boucherie l.126) ; pâtissier ajouté au lexique au
  // même passage (même query ici et là-bas).
  boucherie: 'butcher shop meat cuts',
  plombier: 'plumber pipes bathroom repair',
  serrurier: 'locksmith door lock key',
  patisserie: 'pastry shop cake display desserts',
  cordonnier: 'cobbler shoe repair workshop',
  autre: 'modern architecture interior minimal',
};

/** Forme canonique d'une image Unsplash adoptée (params alignés sur les briefs). */
export function canonicalUnsplashPhotoUrl(photoId: string): string {
  return `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=1200&q=80`;
}

/** Slug photo-ID Unsplash : strict, jamais de traversée de chemin. */
const PHOTO_ID_RE = /^photo-[A-Za-z0-9_-]{6,80}$/;

/**
 * Extrait le photo-ID d'une URL Unsplash (urls.regular de l'API). STRICT :
 * hôte exact https://images.unsplash.com, segment photo-<slug> — sinon null
 * (une forme inattendue est ignorée, jamais adoptée).
 */
export function unsplashPhotoIdFromUrl(rawUrl: string): string | null {
  const match = /^https:\/\/images\.unsplash\.com\/(photo-[A-Za-z0-9_-]+)(?:[/?#].*)?$/.exec(rawUrl);
  if (match === null) return null;
  const id = match[1] ?? '';
  return PHOTO_ID_RE.test(id) ? id : null;
}

/** Photo réelle adoptée (métadonnées d'affichage ; credit jamais affiché ici). */
export interface UnsplashDynamicPhoto {
  readonly id: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  readonly credit: string;
}

/** Plafond réseau PAR DÉFAUT de la recherche Unsplash (lot polish : 8 s → 4 s). */
export const UNSPLASH_SEARCH_TIMEOUT_MS = 4000;

export interface SearchThemedPhotosArgs {
  readonly query: string;
  readonly count: number;
  readonly apiKey: string;
  /** Injectable pour les tests (stub) — défaut : fetch global. */
  readonly fetchImpl?: typeof fetch;
  /** Plafond réseau (défaut 4000 ms) — appliqué au fetch réel uniquement. */
  readonly timeoutMs?: number;
}

/**
 * Recherche réelle : GET /search/photos (une requête par exécution, jamais
 * par section — économie de quota). Retourne [] si zéro résultat
 * exploitable (« pas de photo » n'est pas une erreur) ; LÈVE si l'échange
 * échoue (HTTP non-2xx, JSON illisible, forme inattendue) : l'appelant
 * replie sur la réserve déterministe.
 */
export async function searchThemedUnsplashPhotos(
  args: SearchThemedPhotosArgs
): Promise<UnsplashDynamicPhoto[]> {
  const apiKey = args.apiKey.trim();
  if (apiKey.length === 0) return [];
  const query = args.query.trim();
  if (query.length === 0) return [];
  const perPage = Math.min(30, Math.max(1, Math.floor(args.count)));
  const endpoint =
    'https://api.unsplash.com/search/photos?query=' +
    encodeURIComponent(query) +
    '&per_page=' +
    String(perPage) +
    '&orientation=landscape';
  const headers = { Authorization: `Client-ID ${apiKey}`, 'Accept-Version': 'v1' };

  let response: Response;
  if (args.fetchImpl !== undefined) {
    response = await args.fetchImpl(endpoint, { headers });
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? UNSPLASH_SEARCH_TIMEOUT_MS);
    try {
      response = await fetch(endpoint, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
  if (!response.ok) {
    // Jamais la clé dans le message (honnêteté + sécurité).
    throw new Error(`Recherche Unsplash refusée (HTTP ${response.status}).`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Recherche Unsplash : réponse illisible.');
  }
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    throw new Error('Recherche Unsplash : forme inattendue (results absent).');
  }
  const photos: UnsplashDynamicPhoto[] = [];
  const seen = new Set<string>();
  for (const entry of results) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as {
      urls?: Record<string, unknown>;
      width?: unknown;
      height?: unknown;
      alt_description?: unknown;
      description?: unknown;
      user?: { name?: unknown };
    };
    const urls = record.urls;
    const candidate =
      typeof urls?.['regular'] === 'string'
        ? (urls['regular'] as string)
        : typeof urls?.['full'] === 'string'
          ? (urls['full'] as string)
          : '';
    const id = unsplashPhotoIdFromUrl(candidate);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    photos.push({
      id,
      url: canonicalUnsplashPhotoUrl(id),
      width: typeof record.width === 'number' && Number.isFinite(record.width) ? record.width : 0,
      height: typeof record.height === 'number' && Number.isFinite(record.height) ? record.height : 0,
      alt:
        typeof record.alt_description === 'string'
          ? record.alt_description.slice(0, 160)
          : typeof record.description === 'string'
            ? record.description.slice(0, 160)
            : '',
      credit: typeof record.user?.name === 'string' ? record.user.name.slice(0, 80) : '',
    });
  }
  return photos;
}
