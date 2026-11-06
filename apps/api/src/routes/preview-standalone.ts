/**
 * PV-01 — aperçu HTML isolé (remplace le popout `blob:` du Studio).
 *
 * Problème : `window.open(blobUrl)` hérite de l'origine du Studio → le JS
 * généré lisait localStorage (JWT + clé IA). Ici le HTML transite par le
 * serveur et est servi avec les en-têtes cage (origine opaque) :
 * - POST /api/v1/preview/standalone { projectId?, html } (authentifié,
 *   projet vérifié si fourni) → { id } — ids indevinables (128 bits) ;
 * - GET /preview-standalone/:id/ (sans auth : l'id EST le secret,
 *   persisté sur disque (LOT PV-PERSIST), plafonné à 50 entrées FIFO,
 *   purge à la reprise au-delà de 24 h).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { isSafeProjectId } from '../../../../packages/core/src/app-pipeline.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../../../packages/core/src/persistence/json-disk-cache.js';
import { readBody } from '../middleware/body.js';
import type { RequestContext } from '../middleware/auth.js';

interface StandaloneEntry {
  readonly html: string;
  readonly createdAt: number;
}

const STANDALONE_MAX_ENTRIES = 50;
const STANDALONE_MAX_HTML = 1_000_000; // le corps est déjà borné à 1 Mo (middleware)
// LOT PV-PERSIST — la Map seule mourait au redémarrage : chaque onglet
// « Ouvrir dans un nouvel onglet » devenait un 404 JSON brut après un
// restart (découvert et prouvé le 29/10). Le store vit maintenant sur le
// disque (même pattern que executions : dataFilePath), purge des entrées
// de plus de 24 h à la reprise (bornage : 50 × 1 Mo max).
const STANDALONE_TTL_MS = 24 * 60 * 60 * 1000;
const standaloneStore = new Map<string, StandaloneEntry>();

function persistStandalone(): void {
  try {
    const obj: Record<string, StandaloneEntry> = {};
    for (const [key, value] of standaloneStore.entries()) obj[key] = value;
    writeJsonFileSync(dataFilePath('preview-standalone'), obj);
  } catch {
    // La persistance ne doit jamais bloquer la pose d'un aperçu
  }
}

function loadStandaloneStore(): void {
  try {
    const raw = readJsonFile<Record<string, StandaloneEntry>>(dataFilePath('preview-standalone'), {});
    const now = Date.now();
    for (const [key, value] of Object.entries(raw)) {
      if (value && typeof value.html === 'string' && typeof value.createdAt === 'number' && now - value.createdAt < STANDALONE_TTL_MS) {
        standaloneStore.set(key, value);
      }
    }
  } catch {
    // Store absent ou illisible : départ vide, comportement antérieur
  }
}
loadStandaloneStore();

function storeStandalone(html: string): string {
  while (standaloneStore.size >= STANDALONE_MAX_ENTRIES) {
    const oldest = standaloneStore.keys().next().value;
    if (oldest === undefined) break;
    standaloneStore.delete(oldest);
  }
  const id = 'pv_' + randomBytes(16).toString('hex');
  standaloneStore.set(id, { html, createdAt: Date.now() });
  persistStandalone();
  return id;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export async function handlePreviewStandaloneRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // 1. Dépôt du HTML : POST /api/v1/preview/standalone
  if (pathname === '/api/v1/preview/standalone' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    let body: { projectId?: string; html?: string };
    try {
      body = (await readBody(req)) as unknown as typeof body;
      if (typeof body === 'string') body = JSON.parse(body) as typeof body;
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }
    const html = typeof body.html === 'string' ? body.html : '';
    if (html.trim().length < 100) {
      throw new ValidationError('Le champ "html" est obligatoire (100 caractères minimum)', undefined, requestId);
    }
    if (html.length > STANDALONE_MAX_HTML) {
      throw new ValidationError('HTML trop volumineux (1 Mo maximum)', undefined, requestId);
    }
    // Projet revendiqué : il doit exister et appartenir au locataire.
    if (body.projectId !== undefined) {
      const pid = String(body.projectId);
      if (!isSafeProjectId(pid)) {
        throw new ValidationError('Identifiant de projet invalide', undefined, requestId);
      }
      if (!projectStore.getProject(context.tenantId, pid)) {
        throw new NotFoundError(`Projet ${pid}`, requestId);
      }
    }
    const id = storeStandalone(html);
    sendJson(res, 201, { id, url: `/preview-standalone/${id}/`, requestId });
    return true;
  }

  // 2. Lecture cagée : GET /preview-standalone/:id/
  const getMatch = pathname.match(/^\/preview-standalone\/([^/]+)\/?$/);
  if (getMatch && req.method === 'GET') {
    const entry = standaloneStore.get(getMatch[1]!);
    if (!entry) {
      // LOT PV-PERSIST — une entrée manquante = une expiration réelle
      // (TTL 24 h ou éviction LRU). Répondre avec une page HTML digne,
      // jamais le JSON brut qui cassait l'onglet de l'utilisateur.
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Aperçu expiré</title>'
        + '<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0}'
        + 'main{text-align:center;max-width:480px;padding:24px;border:1px solid #334155;border-radius:16px;background:#1e293b}</style></head>'
        + '<body><main><h1>Aperçu expiré</h1><p>Cet aperçu n\'est plus disponible (expiration de 24 h ou éviction).'
        + '</p><p>Retourne dans le Studio et re-clique <strong>« Ouvrir dans un nouvel onglet »</strong> — il sera recréé immédiatement.</p></main></body></html>');
      return true;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Cage identique au bundle : origine opaque même en onglet.
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.end(entry.html);
    return true;
  }

  return false;
}
