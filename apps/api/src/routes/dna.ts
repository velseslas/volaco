/**
 * VibeCode Core - API Tier
 * Application DNA Route (LOT 3) — expose l'ADN réellement extraite du projet
 * par l'AINT-002 (stack, architecture, composants, conventions). Avant cette
 * route, le panneau DNA du Studio affichait un manifeste JSON codé en dur.
 *
 * CDC §31 — DNA EVOLUTION (LOT 2026-11-03, audit moteurs) :
 *   - GET  /api/v1/projects/:id/dna/versions        — versions réelles + provenance ;
 *   - GET  /api/v1/projects/:id/dna/versions/diff?from=&to= — diff réel ;
 *   - POST /api/v1/projects/:id/dna/versions/:v/rollback — rollback RÉEL du
 *     code via la révision archivée (pipeline sections : gates images
 *     identiques au chemin historique, jamais contourné).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApplicationDNAService } from '../../../../packages/core/src/ai-native/dna/service.js';
import { DNAVersionStore } from '../../../../packages/core/src/ai-native/dna/version-store.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { logger } from '../../../../packages/core/src/logger.js';
import type { RequestContext } from '../middleware/auth.js';
import { performRevisionRollback } from './revisions.js';
import { ValidationError } from '../../../../packages/core/src/errors.js';

let dnaService: ApplicationDNAService | undefined;
let dnaVersionStore: DNAVersionStore | undefined;

export function configureDnaRoute(service: ApplicationDNAService): void {
  dnaService = service;
  logger.info('ApplicationDNA route configurée (Lot 3)', { component: 'dna-route' });
}

export function configureDnaVersionStore(store: DNAVersionStore): void {
  dnaVersionStore = store;
  logger.info('DNA Evolution : store de versions configuré (CDC §31)', { component: 'dna-route' });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export async function handleDnaRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // GET /api/v1/projects/:projectId/dna
  const prefix = '/api/v1/projects/';
  if (req.method === 'GET' && pathname.startsWith(prefix) && pathname.endsWith('/dna/versions/diff')) {
    const projectIdDiff = pathname.slice(prefix.length, -'/dna/versions/diff'.length);
    if (projectIdDiff) {
      assertPermission(context.role, 'PROJECT_READ', requestId);
      if (!dnaVersionStore) {
        sendJson(res, 503, { message: 'DNA Evolution non configuré.', requestId });
        return true;
      }
      const url = new URL(req.url || pathname, 'http://localhost');
      const fromRaw = url.searchParams.get('from');
      const toRaw = url.searchParams.get('to');
      const from = fromRaw ? Number.parseInt(fromRaw, 10) : Number.NaN;
      const to = toRaw ? Number.parseInt(toRaw, 10) : Number.NaN;
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        sendJson(res, 400, { message: 'Paramètres from / to obligatoires (numéros de version).', requestId });
        return true;
      }
      const diff = dnaVersionStore.diffVersions(context.tenantId, projectIdDiff, from, to);
      if (!diff) {
        sendJson(res, 404, { message: `Versions demandées absentes : v${from} / v${to}`, requestId });
        return true;
      }
      logger.info('DNA Evolution : diff réel', {
        component: 'dna-route',
        tenantId: context.tenantId,
        projectId: projectIdDiff,
        from,
        to,
        requestId
      });
      sendJson(res, 200, { diff, requestId });
      return true;
    }
  }

  // POST /api/v1/projects/:projectId/dna/versions/:version/rollback
  // Rollback RÉEL du CODE via la révision archivée à la capture (jamais un
  // DNA rétro-patch) : réutilise EXACTEMENT le pipeline guarded des
  // révisions (gates images identiques, aucune écriture sans gates).
  const rollbackMatch = req.method === 'POST' && pathname.startsWith(prefix) && pathname.endsWith('/rollback');
  if (rollbackMatch) {
    const rest = pathname.slice(prefix.length);
    const parts = rest.split('/').filter(Boolean);
    // [projectId, 'dna', 'versions', ':version', 'rollback']
    if (parts.length === 5 && parts[1] === 'dna' && parts[2] === 'versions' && parts[4] === 'rollback') {
      const projectIdRoll = parts[0];
      if (!projectIdRoll) {
        sendJson(res, 400, { message: 'projectId manquant dans l\'URL', requestId });
        return true;
      }
      const versionNum = Number.parseInt(parts[3] ?? '', 10);
      assertPermission(context.role, 'PROJECT_UPDATE', requestId);
      if (!dnaVersionStore) {
        sendJson(res, 503, { message: 'DNA Evolution non configuré.', requestId });
        return true;
      }
      if (!Number.isFinite(versionNum)) {
        sendJson(res, 400, { message: 'Numéro de version DNA invalide.', requestId });
        return true;
      }
      const versionRecord = dnaVersionStore.getVersion(context.tenantId, projectIdRoll, versionNum);
      if (!versionRecord) {
        sendJson(res, 404, { message: `Version DNA v${versionNum} introuvable pour ce projet.`, requestId });
        return true;
      }
      if (!versionRecord.revisionId) {
        // Honnête : les captures SANS révision (fallback direct très ancien)
        // ne peuvent pas rouler le code — jamais un faux succès.
        sendJson(res, 422, {
          message: 'Version DNA sans révision archivée : rollback du code impossible (provenance incomplète).',
          version: versionRecord.version,
          requestId
        });
        return true;
      }
      const rollback = await performRevisionRollback({
        tenantId: context.tenantId,
        projectId: projectIdRoll,
        targetRevisionId: versionRecord.revisionId,
        role: context.role,
        requestId
      });
      logger.info('DNA Evolution : rollback réel via révision archivée', {
        component: 'dna-route',
        tenantId: context.tenantId,
        projectId: projectIdRoll,
        version: versionRecord.version,
        revisionId: versionRecord.revisionId,
        requestId
      });
      sendJson(res, 200, { success: rollback.success, rolledBackTo: { version: versionRecord.version, revisionId: versionRecord.revisionId }, rollback, requestId });
      return true;
    }
  }

  // GET /api/v1/projects/:projectId/dna/versions
  // §31 — paramètre optionnel ?branch=<nom> : seules les entrées de la ligne.
  if (req.method === 'GET' && pathname.startsWith(prefix) && pathname.endsWith('/dna/versions')) {
    const projectIdVersions = pathname.slice(prefix.length, -'/dna/versions'.length);
    if (projectIdVersions) {
      assertPermission(context.role, 'PROJECT_READ', requestId);
      if (!dnaVersionStore) {
        sendJson(res, 503, { message: 'DNA Evolution non configuré.', requestId });
        return true;
      }
      const url = new URL(req.url || pathname, 'http://localhost');
      const branchParam = url.searchParams.get('branch');
      const all = dnaVersionStore.getVersions(context.tenantId, projectIdVersions);
      const versions = branchParam
        ? all.filter((v) => (typeof v.branch === 'string' && v.branch.length > 0 ? v.branch : 'main') === branchParam)
        : all;
      // payload complet retiré de la liste (lourde) : map summary + hash.
      sendJson(res, 200, {
        versions: versions.map((v) => ({
          version: v.version,
          hash: v.hash.slice(0, 16),
          capturedAt: v.capturedAt,
          trigger: v.trigger,
          revisionId: v.revisionId ?? null,
          decisionId: v.decisionId ?? null,
          branch: typeof v.branch === 'string' && v.branch.length > 0 ? v.branch : 'main',
          summary: v.summary
        })),
        requestId
      });
      return true;
    }
  }

  // §31 — BRANCHES & MERGE (lignes d'évolution + point de fusion tracé)
  //   GET  /api/v1/projects/:projectId/dna/branches
  //   POST /api/v1/projects/:projectId/dna/branches             {name, fromVersion}
  //   POST /api/v1/projects/:projectId/dna/branches/:name/activate {}
  //   POST /api/v1/projects/:projectId/dna/branches/:name/merge    {upToVersion}
  const branchesPath = pathname.startsWith(prefix) && pathname.includes('/dna/branches');
  if (branchesPath) {
    const rest = pathname.slice(prefix.length);
    const parts = rest.split('/').filter(Boolean);
    // [projectId, 'dna', 'branches'] / [projectId, 'dna', 'branches', name, action]
    if (parts.length === 3 && parts[1] === 'dna' && parts[2] === 'branches') {
      const projectIdB = parts[0];
      if (!projectIdB) {
        sendJson(res, 400, { message: 'projectId manquant dans l\'URL', requestId });
        return true;
      }
      if (req.method === 'GET') {
        assertPermission(context.role, 'PROJECT_READ', requestId);
        if (!dnaVersionStore) {
          sendJson(res, 503, { message: 'DNA Evolution non configuré.', requestId });
          return true;
        }
        const branches = dnaVersionStore.getBranches(context.tenantId, projectIdB).map((b) => ({
          name: b.name,
          fromVersion: b.fromVersion,
          createdAt: b.createdAt,
          merged: dnaVersionStore!.isBranchMerged(context.tenantId, projectIdB, b.name)
        }));
        sendJson(res, 200, {
          branches,
          activeBranch: dnaVersionStore.getActiveBranch(context.tenantId, projectIdB),
          requestId
        });
        return true;
      }
      if (req.method === 'POST') {
        assertPermission(context.role, 'PROJECT_UPDATE', requestId);
        if (!dnaVersionStore) {
          sendJson(res, 503, { message: 'DNA Evolution non configuré.', requestId });
          return true;
        }
        let body: { name?: unknown; fromVersion?: unknown } = {};
        try {
          const chunks: Buffer[] = [];
          const raw = await new Promise<string>((resolve) => {
            const buffers: Buffer[] = [];
            req.on('data', (c) => buffers.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
            req.on('end', () => resolve(Buffer.concat(buffers).toString('utf8')));
            req.on('error', () => resolve(''));
          });
          if (raw.trim().length > 0) body = JSON.parse(raw) as { name?: unknown; fromVersion?: unknown };
        } catch {
          sendJson(res, 400, { message: 'JSON invalide dans le corps de la requête', requestId });
          return true;
        }
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const fromVersion = typeof body.fromVersion === 'number' ? body.fromVersion : Number.NaN;
        if (!name || !Number.isFinite(fromVersion)) {
          sendJson(res, 400, { message: 'Champs requis : {name, fromVersion} (la version d\'origine archivée).', requestId });
          return true;
        }
        try {
          const branch = dnaVersionStore.createBranch(context.tenantId, projectIdB, name, fromVersion);
          logger.info('DNA Evolution : branche créée', {
            component: 'dna-route',
            tenantId: context.tenantId,
            projectId: projectIdB,
            branch: branch.name,
            fromVersion: branch.fromVersion,
            requestId
          });
          sendJson(res, 201, { branch, requestId });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { message, requestId });
        }
        return true;
      }
    }
    if (parts.length === 5 && parts[1] === 'dna' && parts[2] === 'branches' && (parts[4] === 'activate' || parts[4] === 'merge')) {
      const projectIdB = parts[0];
      const branchName = parts[3];
      const actionKind = parts[4];
      if (!projectIdB || !branchName) {
        sendJson(res, 400, { message: 'projectId ou branche manquants dans l\'URL', requestId });
        return true;
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { message: 'Méthode non autorisée pour cette action de branche.', requestId });
        return true;
      }
      assertPermission(context.role, 'PROJECT_UPDATE', requestId);
      if (!dnaVersionStore) {
        sendJson(res, 503, { message: 'DNA Evolution non configuré.', requestId });
        return true;
      }
      let upToVersion = Number.NaN;
      if (actionKind === 'merge') {
        try {
          const raw = await new Promise<string>((resolve) => {
            const buffers: Buffer[] = [];
            req.on('data', (c) => buffers.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
            req.on('end', () => resolve(Buffer.concat(buffers).toString('utf8')));
            req.on('error', () => resolve(''));
          });
          const parsed = raw.trim().length > 0 ? (JSON.parse(raw) as { upToVersion?: unknown }) : {};
          if (typeof parsed.upToVersion === 'number') upToVersion = parsed.upToVersion;
        } catch {
          sendJson(res, 400, { message: 'JSON invalide dans le corps de la requête', requestId });
          return true;
        }
        if (!Number.isFinite(upToVersion)) {
          sendJson(res, 400, { message: 'Champ requis : {upToVersion} (la version source du merge, sur la branche).', requestId });
          return true;
        }
      }
      try {
        if (actionKind === 'activate') {
          const active = dnaVersionStore.setActiveBranch(context.tenantId, projectIdB, branchName);
          logger.info('DNA Evolution : ligne active basculée', {
            component: 'dna-route',
            tenantId: context.tenantId,
            projectId: projectIdB,
            activeBranch: active,
            requestId
          });
          sendJson(res, 200, { activeBranch: active, requestId });
        } else {
          const merged = dnaVersionStore.mergeBranch(context.tenantId, projectIdB, branchName, upToVersion);
          // Le merge est une version ARCHIVÉE : le code de la branche devient le
          // code courant via sa révision — le rollback décennale existant
          // (arènes images gardées) restaure exactement ce code.
          const rollback = await performRevisionRollback({
            tenantId: context.tenantId,
            projectId: projectIdB,
            targetRevisionId: merged.revisionId ?? '',
            role: context.role,
            requestId
          });
          logger.info('DNA Evolution : branche fusionnée dans main (version "merge" tracée)', {
            component: 'dna-route',
            tenantId: context.tenantId,
            projectId: projectIdB,
            branch: branchName,
            mergedVersion: merged.version,
            mergedHash: merged.hash.slice(0, 16),
            rollbackSuccess: rollback.success,
            requestId
          });
          sendJson(res, 200, {
            branch: branchName,
            mergedVersion: merged.version,
            mergedHash: merged.hash.slice(0, 16),
            rollback,
            requestId
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, { message, requestId });
      }
      return true;
    }
    return true;
  }

  if (req.method !== 'GET' || !pathname.startsWith(prefix) || !pathname.endsWith('/dna')) {
    return false;
  }
  const projectId = pathname.slice(prefix.length, -'/dna'.length);
  if (!projectId) return false;

  assertPermission(context.role, 'PROJECT_READ', requestId);

  if (!dnaService) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'ApplicationDNAService non configuré.', requestId }));
    return true;
  }

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: `Projet ${projectId} introuvable`, requestId }));
    return true;
  }

  try {
    const dna = dnaService.extractDNA(context.tenantId, projectId, context.role, requestId);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ dna, requestId }));
  } catch (error) {
    // Projet vide ou inextraction possible : réponse structurée, pas un 500 brut
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Extraction DNA impossible', {
      component: 'dna-route',
      tenantId: context.tenantId,
      projectId,
      error: message,
      requestId
    });
    res.statusCode = 422;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: `Extraction DNA impossible : ${message}`, requestId }));
  }
  return true;
}
