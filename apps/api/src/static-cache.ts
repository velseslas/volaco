/**
 * Cache statique (n°3) — module partagé serveur + routes.
 *
 * Constat mesuré : chaque fichier statique (Studio ~1 Mo, moteur preview,
 * tailwind ~400 Ko) était relu du disque (readFileSync) à CHAQUE requête.
 * Cache mémoire indexé par chemin absolu, invalidé par mtime+taille (un seul
 * statSync par requête, ~µs, contre des ms de lecture) : les éditions en dev
 * restent visibles aussitôt. ETag faible + 304 (revalidation navigateur même
 * sous `Cache-Control: no-cache`), gzip précompressé une fois au remplissage
 * (zéro coût CPU par requête). Plafonné (32 Mo / 100 entrées, FIFO).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

interface StaticCacheEntry {
  readonly mtimeMs: number;
  readonly size: number;
  readonly etag: string;
  readonly contentType: string;
  readonly raw: Buffer;
  readonly gzip: Buffer | null;
}

const STATIC_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const STATIC_CACHE_MAX_ENTRIES = 100;
const staticCache = new Map<string, StaticCacheEntry>();
let staticCacheBytes = 0;

function staticCacheEvictIfNeeded(): void {
  while ((staticCacheBytes > STATIC_CACHE_MAX_BYTES || staticCache.size > STATIC_CACHE_MAX_ENTRIES) && staticCache.size > 0) {
    const oldest = staticCache.keys().next().value;
    if (oldest === undefined) return;
    const entry = staticCache.get(oldest);
    if (entry) staticCacheBytes -= entry.raw.length + (entry.gzip ? entry.gzip.length : 0);
    staticCache.delete(oldest);
  }
}

function isCompressible(contentType: string): boolean {
  return contentType.startsWith('text/') || contentType.includes('javascript') || contentType.includes('json') || contentType.includes('svg');
}

/**
 * Sert un fichier statique depuis le cache (rempli/invalidé par mtime).
 * Retourne true si servi (y compris 304), false si absent/non-fichier
 * (l'appelant applique son repli historique : 404 ciblée ou routes API).
 */
function staticCacheEnabled(): boolean {
  return process.env.VOLACO_STATIC_CACHE !== '0';
}

export function serveStaticFile(req: IncomingMessage, res: ServerResponse, absPath: string, contentType: string, noCache: boolean): boolean {
  // Coupe-circuit opérateur : VOLACO_STATIC_CACHE=0 restaure la lecture
  // disque directe (comportement historique), sans redéploiement.
  if (!staticCacheEnabled()) {
    try {
      const st = statSync(absPath);
      if (!st.isFile()) return false;
      const raw = readFileSync(absPath);
      if (noCache) res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', raw.length);
      res.statusCode = 200;
      res.end(raw);
      return true;
    } catch {
      return false;
    }
  }

  let mtimeMs: number;
  let size: number;
  try {
    const st = statSync(absPath);
    if (!st.isFile()) return false;
    mtimeMs = st.mtimeMs;
    size = st.size;
  } catch {
    return false;
  }

  let entry = staticCache.get(absPath);
  if (!entry || entry.mtimeMs !== mtimeMs || entry.size !== size) {
    // Jamais servi ou fichier modifié (mtime ou taille) : relecture disque.
    let raw: Buffer;
    try {
      raw = readFileSync(absPath);
    } catch {
      return false;
    }
    const etag = `W/"${raw.length.toString(36)}-${Math.floor(mtimeMs).toString(36)}"`;
    const gzip = raw.length >= 1024 && isCompressible(contentType) ? gzipSync(raw) : null;
    if (entry) staticCacheBytes -= entry.raw.length + (entry.gzip ? entry.gzip.length : 0);
    entry = { mtimeMs, size: raw.length, etag, contentType, raw, gzip };
    staticCache.set(absPath, entry);
    staticCacheBytes += entry.raw.length + (entry.gzip ? entry.gzip.length : 0);
    staticCacheEvictIfNeeded();
  }

  res.setHeader('ETag', entry.etag);
  if (noCache) res.setHeader('Cache-Control', 'no-cache');
  const ifNoneMatch = req.headers['if-none-match'];
  if (typeof ifNoneMatch === 'string' && ifNoneMatch.includes(entry.etag)) {
    res.statusCode = 304;
    res.end();
    return true;
  }

  const acceptEncoding = req.headers['accept-encoding'];
  const wantsGzip = entry.gzip !== null && typeof acceptEncoding === 'string' && acceptEncoding.includes('gzip');
  res.setHeader('Content-Type', entry.contentType);
  if (wantsGzip && entry.gzip) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Length', entry.gzip.length);
    res.statusCode = 200;
    res.end(entry.gzip);
  } else {
    res.setHeader('Content-Length', entry.raw.length);
    res.statusCode = 200;
    res.end(entry.raw);
  }
  return true;
}
