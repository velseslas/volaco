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
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RequestContext } from '../middleware/auth.js';

const here = dirname(fileURLToPath(import.meta.url));
// dist/apps/api/src/routes → racine du dépôt (5 niveaux)
const repoRoot = join(here, '..', '..', '..', '..', '..');
const demoPagePath = join(repoRoot, 'apps', 'studio', 'preview-builder.html');
const engineJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'engine.js');
const rendererJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'renderer.js');
const layoutJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'layout.js');
const visualsJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'visuals.js');
const mocksJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'mocks.js');
const adapterJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'adapter.js');
const flagsJsPath = join(repoRoot, 'dist', 'packages', 'core', 'src', 'preview-builder', 'flags.js');

function serveFile(res: ServerResponse, filePath: string, contentType: string, notFound: string): boolean {
  if (!existsSync(filePath)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(notFound);
    return true;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.end(readFileSync(filePath, 'utf8'));
  return true;
}

export async function handlePreviewBuilderRoutes(
  _req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _context: RequestContext,
  _requestId: string
): Promise<boolean> {
  if (pathname === '/preview-builder') {
    return serveFile(res, demoPagePath, 'text/html; charset=utf-8', 'preview-builder.html introuvable');
  }
  if (pathname === '/preview-builder/engine.js') {
    return serveFile(res, engineJsPath, 'text/javascript; charset=utf-8', 'Moteur Preview Builder non compilé (npm run build)');
  }
  if (pathname === '/preview-builder/renderer.js') {
    return serveFile(res, rendererJsPath, 'text/javascript; charset=utf-8', 'Renderer Preview Builder non compilé (npm run build)');
  }
  if (pathname === '/preview-builder/layout.js') {
    return serveFile(res, layoutJsPath, 'text/javascript; charset=utf-8', 'Layout Preview Builder non compilé (npm run build)');
  }
  if (pathname === '/preview-builder/visuals.js') {
    return serveFile(res, visualsJsPath, 'text/javascript; charset=utf-8', 'Visuals Preview Builder non compilés (npm run build)');
  }
  if (pathname === '/preview-builder/mocks.js') {
    return serveFile(res, mocksJsPath, 'text/javascript; charset=utf-8', 'Mocks Preview Builder non compilés (npm run build)');
  }
  if (pathname === '/preview-builder/adapter.js') {
    return serveFile(res, adapterJsPath, 'text/javascript; charset=utf-8', 'Adaptateur Preview Builder non compilé (npm run build)');
  }
  if (pathname === '/preview-builder/flags.js') {
    return serveFile(res, flagsJsPath, 'text/javascript; charset=utf-8', 'Flags Preview Builder non compilés (npm run build)');
  }
  return false;
}
