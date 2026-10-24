/**
 * VibeCode Core - API Tier
 * Image Generation Routes (P4) — génération d'images réelles par providers.
 *
 * POST /api/v1/projects/:id/images/generate
 *   { prompt, name?, width?, height?, provider? }
 *   → génère via le registry (Pollinations par défaut), stocke :
 *     - FileStore : assets/<name> (base64 — révisable)
 *     - workspace : public/assets/<name> (servi par le bundle React)
 *   → rebuild du bundle si le workspace existe (l'asset y est référencé)
 *   → retourne { path, workspacePath?, url }
 *
 * GET /api/v1/projects/:id/images/:name
 *   → sert l'asset (décodage base64, MIME image) — utilisable depuis le
 *     preview HTML (srcdoc) comme depuis le bundle.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import { logger } from '../../../../packages/core/src/logger.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/index.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import {
  buildApp,
  ensureWorkspace,
  writeAppAsset
} from '../../../../packages/core/src/app-pipeline.js';
import {
  imageProviderRegistry,
  type ImageProvider
} from '../../../../packages/core/src/image/registry.js';
import { PollinationsImageProvider } from '../../../../packages/core/src/image/pollinations-provider.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';

// Bootstrap du provider par défaut (sans clé) — une seule fois par process.
if (imageProviderRegistry.list().length === 0) {
  imageProviderRegistry.register(new PollinationsImageProvider());
}

const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

function sanitizeName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function resolveProvider(requested?: string): ImageProvider {
  if (requested) {
    const p = imageProviderRegistry.get(requested);
    if (!p) throw new ValidationError('Provider d image inconnu : ' + requested, undefined);
    return p;
  }
  const p = imageProviderRegistry.resolveAvailable();
  if (!p) throw new ValidationError('Aucun provider d image disponible', undefined);
  return p;
}

/**
 * ISOLATION TENANT (audit 2026-10) — vérifie que le projet appartient bien au
 * tenant de la requête AVANT toute opération. Sans cela, un tenant B pouvait
 * générer/lister des images dans un espace « fantôme » tenantB:projetA (le
 * FileStore crée la map à la demande) — aucune fuite de données de A vers B,
 * mais violation du §37 (multi-tenancy). Même garde que files.ts.
 */
function assertProjectOwnership(
  tenantId: string,
  projectId: string,
  requestId: string
): void {
  const project = projectStore.getProject(tenantId, projectId);
  if (!project) {
    throw new NotFoundError(`Projet ${projectId}`, requestId);
  }
}

export async function handleImageRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // 1. POST /api/v1/projects/:id/images/generate
  const genMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/images\/generate$/);
  if (genMatch && req.method === 'POST') {
    const projectId = genMatch[1]!;
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    assertProjectOwnership(context.tenantId, projectId, requestId);
    const bodyText = await readBody(req);
    let body: { prompt?: string; name?: string; width?: number; height?: number; provider?: string };
    try {
      body = bodyText ? (JSON.parse(bodyText) as typeof body) : {};
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }
    const prompt = (body.prompt || '').trim();
    if (prompt.length < 5) {
      throw new ValidationError('Le champ "prompt" est obligatoire (5 caractères min)', undefined, requestId);
    }
    const name = sanitizeName(body.name || 'image-' + Date.now().toString(36)) || 'image';
    const fileName = name + '.jpg';

    const provider = resolveProvider(body.provider);
    logger.info('Génération d image', { component: 'image-routes', provider: provider.id, projectId });

    const image = await provider.generate(prompt, {
      width: Number(body.width) || 1024,
      height: Number(body.height) || 576
    });

    // Persistance : FileStore (base64 — révisable comme les sources)
    const fileStorePath = 'assets/' + fileName;
    fileStore.saveFile(context.tenantId, projectId, fileStorePath, image.data.toString('base64'));

    // Workspace React : si présent, l asset va dans public/assets + rebuild
    const ws = ensureWorkspace(projectId);
    const wsIndex = join(ws, 'index.html');
    let workspacePath: string | undefined;
    if (existsSync(wsIndex)) {
      const writeRes = writeAppAsset(projectId, 'public/assets/' + fileName, image.data);
      if (writeRes.ok) {
        workspacePath = 'public/assets/' + fileName;
        const build = await buildApp(projectId);
        logger.info('Rebuild post-image', {
          component: 'image-routes', projectId,
          ok: build.ok, durationMs: build.durationMs,
          error: build.ok ? undefined : build.errors.slice(0, 1).join(' | ')
        });
      }
    }

    res.statusCode = 201;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      path: fileStorePath,
      workspacePath,
      url: '/api/v1/projects/' + projectId + '/images/' + fileName,
      provider: provider.id,
      bytes: image.data.length,
      contentType: image.contentType,
      requestId
    }));
    return true;
  }

  // 2. GET /api/v1/projects/:id/images/:name — sert l'asset (décodé)
  const assetMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/images\/([a-z0-9-]+\.(?:jpg|jpeg|png|webp))$/);
  if (assetMatch && req.method === 'GET') {
    const projectId = assetMatch[1]!;
    const fileName = assetMatch[2]!;
    assertPermission(context.role, 'PROJECT_READ', requestId);
    assertProjectOwnership(context.tenantId, projectId, requestId);
    const stored = fileStore.getFile(context.tenantId, projectId, 'assets/' + fileName);
    if (!stored) {
      throw new NotFoundError('Image ' + fileName, requestId);
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', IMAGE_MIME[fileName.slice(fileName.lastIndexOf('.'))] || 'image/jpeg');
    res.end(Buffer.from(stored.content, 'base64'));
    return true;
  }

  // 3. GET /api/v1/projects/:id/images — liste les assets du projet
  if (pathname.match(/^\/api\/v1\/projects\/([^/]+)\/images$/) && req.method === 'GET') {
    const projectId = pathname.split('/')[4]!;
    assertPermission(context.role, 'PROJECT_READ', requestId);
    assertProjectOwnership(context.tenantId, projectId, requestId);
    const all = fileStore.getAllProjectFiles(context.tenantId, projectId);
    const assets = Object.keys(all)
      .filter((p) => p.startsWith('assets/') && /\.(jpg|jpeg|png|webp)$/.test(p))
      .map((p) => ({
        path: p,
        name: p.slice('assets/'.length),
        bytes: Math.round((all[p] ?? '').length * 0.75)
      }));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ assets, requestId }));
    return true;
  }

  return false;
}
