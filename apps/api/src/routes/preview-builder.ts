/**
 * PREVIEW BUILDER — routes dédiées au NOUVEAU preview (système indépendant).
 *
 * GET /preview-builder         → page de démonstration autonome
 * GET /preview-builder/engine.js → moteur compilé (packages/core, ESM navigateur)
 *
 * Ces routes n'existent que pour coexister avec l'ancien preview pendant le
 * développement. Elles ne remplacent rien, ne suppriment rien, ne modifient
 * aucun comportement existant.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStaticFile } from '../static-cache.js';
import type { RequestContext } from '../middleware/auth.js';

const here = dirname(fileURLToPath(import.meta.url));
// dist/apps/api/src/routes → racine du dépôt (5 niveaux)
const repoRoot = join(here, '..', '..', '..', '..', '..');
const demoPagePath = join(repoRoot, 'apps', 'studio', 'preview-builder.html');
const appJsPath = join(repoRoot, 'apps', 'studio', 'preview-builder-app.js');
const engineJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'engine.js');
const rendererJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'renderer.js');
const layoutJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'layout.js');
const visualsJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'visuals.js');
const mocksJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'mocks.js');
const adapterJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'adapter.js');
const flagsJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'flags.js');
// ÉTAPE 16 — commandes d'édition (module séparé du moteur)
const editingJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'editing.js');
// ÉTAPE 35 — boucle d'édition IA par outils (module isomorphe)
const aiEditJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'ai-edit.js');
// E40 — extraction des sections d'un HTML restauré (historique)
const sectionParseJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'section-parse.js');

function serveFile(req: IncomingMessage, res: ServerResponse, filePath: string, contentType: string, notFound: string): boolean {
  // n°3 : cache mémoire + ETag/304 + gzip (le disque n'est relu qu'au
  // changement du fichier). Repli 404 historique conservé si absent.
  if (serveStaticFile(req, res, filePath, contentType, true)) return true;
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(notFound);
  return true;
}

export async function handlePreviewBuilderRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _context: RequestContext,
  _requestId: string
): Promise<boolean> {
  if (pathname === '/preview-builder') {
    return serveFile(req, res, demoPagePath, 'text/html; charset=utf-8', 'preview-builder.html introuvable');
  }
  if (pathname === '/preview-builder/app.js') {
    return serveFile(req, res, appJsPath, 'text/javascript; charset=utf-8', 'App Preview Builder non compilée');
  }
  if (pathname === '/preview-builder/engine.js') {
    return serveFile(req, res, engineJsPath, 'text/javascript; charset=utf-8', 'Moteur Preview Builder non compilé (npm run build)');
  }
  if (pathname === '/preview-builder/renderer.js') {
    return serveFile(req, res, rendererJsPath, 'text/javascript; charset=utf-8', 'Renderer Preview Builder non compilé (npm run build)');
  }
  if (pathname === '/preview-builder/layout.js') {
    return serveFile(req, res, layoutJsPath, 'text/javascript; charset=utf-8', 'Layout Preview Builder non compilé (npm run build)');
  }
  if (pathname === '/preview-builder/visuals.js') {
    return serveFile(req, res, visualsJsPath, 'text/javascript; charset=utf-8', 'Visuals Preview Builder non compilés (npm run build)');
  }
  if (pathname === '/preview-builder/mocks.js') {
    return serveFile(req, res, mocksJsPath, 'text/javascript; charset=utf-8', 'Mocks Preview Builder non compilés (npm run build)');
  }
  if (pathname === '/preview-builder/adapter.js') {
    return serveFile(req, res, adapterJsPath, 'text/javascript; charset=utf-8', 'Adaptateur Preview Builder non compilé (npm run build)');
  }
  if (pathname === '/preview-builder/flags.js') {
    return serveFile(req, res, flagsJsPath, 'text/javascript; charset=utf-8', 'Flags Preview Builder non compilés (npm run build)');
  }
  if (pathname === '/preview-builder/editing.js') {
    return serveFile(req, res, editingJsPath, 'text/javascript; charset=utf-8', 'Editing Preview Builder non compilé (npm run build)');
  }
  if (pathname === '/preview-builder/ai-edit.js') {
    return serveFile(req, res, aiEditJsPath, 'text/javascript; charset=utf-8', 'AI Edit Preview Builder non compilé (npm run build)');
  }
  if (pathname === '/preview-builder/section-parse.js') {
    return serveFile(req, res, sectionParseJsPath, 'text/javascript; charset=utf-8', 'Section Parse Preview Builder non compilé (npm run build)');
  }
  return false;
}

