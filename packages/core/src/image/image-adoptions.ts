/**
 * LOT UNSPLASH-DYN (suite 18/10) — JOURNAL D'ADOPTIONS D'IMAGES.
 *
 * Les photo-IDs RÉELLEMENT récupérés auprès d'Unsplash (recherche avec clé
 * usager, une fois par génération) sont inscrits ici AU MOMENT de l'adoption.
 * La politique d'images (app-policy.ts) s'en sert pour distinguer :
 *   - ID inventé de mémoire (jamais fetché)       → violation (inchangé) ;
 *   - ID réel adopté par recherche (journal)       → conforme.
 *
 * Garanties :
 *   - JAMAIS de secret : seuls des slugs `photo-…` validés par regex stricte
 *     sont écrits (le journal est une source de VÉRITÉ de la politique —
 *     rien d'autre n'y entre, ni clé, ni URL, ni tenant) ;
 *   - borné : les MAX_ADOPTED_IDS dernières adoptions sont conservées ;
 *   - best-effort côté appelant : une écriture en échec ne bloque JAMAIS la
 *     génération (l'appelant journalise et continue) ;
 *   - lecture FRAÎCHE à chaque appel (fichier borné, ~60 Ko max) : aucune
 *     invalidation de cache à gérer — l'horloge de fichier Windows peut ne
 *     pas avancer entre deux écritures rapprochées, un cache mtime serait
 *     donc faillible ;
 *   - fichier absent, illisible ou corrompu → ensemble VIDE : jamais
 *     d'exception, jamais un ID non validé (fail-safe).
 *
 * Emplacement : data dir Volaco (VOLACO_DATA_DIR, sinon ./.volaco-data —
 * même convention que le FileStore et la persistance).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FILE_NAME = 'image-adoptions.json';
const MAX_ADOPTED_IDS = 2000;
/** Même contrat que le module de recherche Unsplash : slug strict. */
const PHOTO_ID_RE = /^photo-[A-Za-z0-9_-]{6,80}$/;

interface JournalFile {
  ids: string[];
}

function journalPath(): string {
  const base = process.env.VOLACO_DATA_DIR || join(process.cwd(), '.volaco-data');
  return join(base, FILE_NAME);
}

/**
 * Photo-IDs adoptés connus, relus depuis le fichier à chaque appel (validation
 * stricte à la lecture aussi : un fichier trafiqué à la main ne peut pas
 * introduire autre chose que des slugs conformes).
 */
export function adoptedImageIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  try {
    const parsed = JSON.parse(readFileSync(journalPath(), 'utf8')) as JournalFile;
    if (Array.isArray(parsed.ids)) {
      for (const id of parsed.ids) {
        if (typeof id === 'string' && PHOTO_ID_RE.test(id)) ids.add(id);
      }
    }
  } catch {
    // Journal absent ou illisible : aucune adoption connue (politique historique).
  }
  return ids;
}

/**
 * Inscrit des photo-IDs adoptés : validation stricte (seuls les slugs
 * conformes entrent), déduplication, bornage aux dernières adoptions,
 * écriture atomique (tmp + rename). Retourne le nombre d'IDs réellement
 * NOUVEAUX. Peut lever sur I/O (disque plein, permissions) — l'appelant
 * décide (la route génération journalise et continue : jamais de génération
 * bloquée).
 */
export function recordAdoptedImageIds(ids: readonly string[]): number {
  const valid = Array.from(new Set(ids.filter((id) => PHOTO_ID_RE.test(id))));
  if (valid.length === 0) return 0;
  const path = journalPath();
  const known = adoptedImageIds();
  const added = valid.filter((id) => !known.has(id));
  if (added.length === 0) return 0;
  const merged = [...known, ...added].slice(-MAX_ADOPTED_IDS);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify({ ids: merged }), 'utf8');
  renameSync(tmp, path);
  return added.length;
}
