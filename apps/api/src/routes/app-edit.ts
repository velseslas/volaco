/**
 * VibeCode Core - API Tier
 * App Edit Route (P3) — édition IA par FICHIERS d'un projet React généré.
 *
 * Flux en deux temps (le modèle de confiance E43/E44 transposé aux fichiers) :
 * 1. POST /app/edit (SSE) — l'IA explore (list_files/read_file) et PROPOSE
 *    des modifications (edit_file / create_file) en mode DIFFÉRÉ : rien
 *    n'est écrit. Les propositions partent au client en fin de boucle.
 * 2. POST /app/apply-edits (SSE) — l'utilisateur a confirmé : application
 *    revalidée (find unique), révision multi-fichiers, rebuild du bundle.
 *
 * Le client affiche les propositions en diff par fichier avec confirmation
 * sélective (cases par fichier) — même UX que les éditions HTML E43/E44.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import { logger } from '../../../../packages/core/src/logger.js';
import { aiProviderRegistry } from '../../../../packages/core/src/ai/providers/registry.js';
import { runToolLoop } from '../../../../packages/core/src/ai/tool-loop.js';
import type { AIProviderTool } from '../../../../packages/core/src/ai/providers/types.js';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import {
  buildApp,
  ensureWorkspace,
  getProjectFormat,
  listAppFiles,
  readAppFile,
  writeAppFile
} from '../../../../packages/core/src/app-pipeline.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';

const EDIT_SYSTEM_PROMPT = [
  "Tu es le Lead Engineer IA de VibeCode Studio. Tu modifies un projet React + TypeScript + Tailwind EXISTANT, fichier par fichier.",
  '',
  'OUTILS :',
  '- list_files : liste les fichiers du projet (commence par là).',
  '- read_file(path) : lit le contenu d un fichier AVANT de le modifier.',
  '- edit_file(path, find, replace) : remplace la PREMIÈRE occurrence EXACTE de find par replace dans le fichier. find doit être une portion de code UNIQUE et EXACTE (copiée telle quelle, indentation comprise). Pour plusieurs changements dans un même fichier, appelle edit_file plusieurs fois.',
  '- create_file(path, content) : crée un nouveau fichier (contenu complet).',
  '',
  'RÈGLES : ne modifie que ce que la demande concerne ; conserve le style existant ; chaque fichier doit rester COMPILABLE (TypeScript strict) ; les classes de style sont des classes Tailwind. Après tes modifications, termine par une phrase courte.'
].join('\n');

interface ProposedEdit {
  action: 'edit' | 'create';
  path: string;
  find?: string;
  replace?: string;
  content?: string;
  /** Extrait lisible pour le diff client (avant → après). */
  summary: string;
}

function editTools(): AIProviderTool[] {
  return [
    {
      name: 'list_files',
      description: 'Liste les fichiers du projet.',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'read_file',
      description: 'Lit le contenu d un fichier du projet.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Chemin relatif (ex: src/App.tsx)' } },
        required: ['path']
      }
    },
    {
      name: 'edit_file',
      description: 'Propose le remplacement d une portion EXACTE et UNIQUE de fichier (find → replace). Ne s applique qu après confirmation humaine.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          find: { type: 'string', description: 'Code EXACT à remplacer (copié tel quel, unique dans le fichier)' },
          replace: { type: 'string', description: 'Nouveau code' }
        },
        required: ['path', 'find', 'replace']
      }
    },
    {
      name: 'create_file',
      description: 'Propose la création d un nouveau fichier (contenu complet). Ne s applique qu après confirmation humaine.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      }
    }
  ];
}

const cap = (t: string, n: number): string => (t.length > n ? t.slice(0, n) + '…' : t);

/**
 * Handlers en mode DIFFÉRÉ : read_file lit réellement (le modèle a besoin
 * du code), edit_file/create_file valident et COLLECTENT une proposition —
 * aucune écriture tant que l utilisateur n a pas confirmé. Le modèle reçoit
 * OK pour conclure.
 */
function editHandlers(projectId: string, proposals: ProposedEdit[]): Record<string, (args: Record<string, unknown>) => unknown> {
  return {
    list_files: () => {
      const files = listAppFiles(projectId);
      return files.map((f) => f.path + ' (' + f.size + ' o)').join('\n') || '(projet vide)';
    },
    read_file: (args) => {
      const path = String(args.path ?? '');
      const content = readAppFile(projectId, path);
      if (content === null) return 'ERREUR: fichier introuvable : ' + path;
      return cap(content, 12000) || '(fichier vide)';
    },
    edit_file: (args) => {
      const path = String(args.path ?? '');
      const find = String(args.find ?? '');
      const replace = String(args.replace ?? '');
      const current = readAppFile(projectId, path);
      if (current === null) return 'ERREUR: fichier introuvable : ' + path + ' — liste les fichiers d abord.';
      if (find.length === 0) return 'ERREUR: find vide.';
      const occurrences = current.split(find).length - 1;
      if (occurrences === 0) return 'ERREUR: find introuvable dans ' + path + ' — relis le fichier et copie le code EXACTEMENT (indentation comprise).';
      if (occurrences > 1) return 'ERREUR: find apparaît ' + occurrences + ' fois dans ' + path + ' — élargis le contexte pour le rendre UNIQUE.';
      proposals.push({ action: 'edit', path, find, replace, summary: path + ' : « ' + cap(find, 70) + ' » → « ' + cap(replace, 70) + ' »' });
      return 'OK — modification proposée (elle ne sera appliquée qu après confirmation humaine).';
    },
    create_file: (args) => {
      const path = String(args.path ?? '');
      const content = String(args.content ?? '');
      if (content.trim().length === 0) return 'ERREUR: contenu vide.';
      const res = validatePath(path);
      if (!res.ok) return 'ERREUR: ' + res.reason;
      proposals.push({ action: 'create', path, content, summary: path + ' : nouveau fichier (' + content.split('\n').length + ' lignes)' });
      return 'OK — création proposée (elle ne sera appliquée qu après confirmation humaine).';
    }
  };
}

/** Validation SANS écriture : chemin relatif confiné et autorisé. */
function validatePath(relPath: string): { ok: boolean; reason?: string } {
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized.includes('..')) return { ok: false, reason: 'path-hors-workspace' };
  if (!/^(src\/|index\.html$|package\.json$|tsconfig\.json$)/.test(normalized)) {
    return { ok: false, reason: 'path-non-autorise (src/ ou racine du projet uniquement)' };
  }
  return { ok: true };
}

function startSSE(req: IncomingMessage, res: ServerResponse): { send: (data: Record<string, unknown>) => void } {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  let clientGone = false;
  req.on('close', () => { clientGone = true; });
  const send = (data: Record<string, unknown>): void => {
    if (clientGone) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  return { send };
}

export async function handleAppEditRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // 1. POST /app/edit (SSE) — propositions DIFFÉRÉES
  const editMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/app\/edit$/);
  if (editMatch && req.method === 'POST') {
    const projectId = editMatch[1]!;
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const bodyText = await readBody(req);
    let body: { instruction?: string };
    try {
      body = bodyText ? (JSON.parse(bodyText) as { instruction?: string }) : {};
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }
    const instruction = (body.instruction || '').trim();
    if (instruction.length === 0) {
      throw new ValidationError('Le champ "instruction" est obligatoire', undefined, requestId);
    }

    const { send } = startSSE(req, res);
    const adapter = aiProviderRegistry.resolve({ preferredProviderId: process.env.MISTRAL_API_KEY ? 'mistral' : undefined });
    if (!adapter) {
      send({ type: 'error', error: 'Aucun fournisseur IA disponible (Mistral requis).' });
      res.end();
      return true;
    }
    const credentials = aiProviderRegistry.getTenantCredentials(context.tenantId, adapter.descriptor.providerId);
    const proposals: ProposedEdit[] = [];
    send({ type: 'start' });

    try {
      const result = await runToolLoop(
        adapter,
        {
          tenantId: context.tenantId,
          projectId,
          prompt: 'Demande de modification : ' + instruction,
          systemPrompt: EDIT_SYSTEM_PROMPT,
          temperature: 0.2,
          maxTokens: 8192,
          timeoutMs: 120000,
          requestId
        },
        editTools(),
        { handlers: editHandlers(projectId, proposals), maxIterations: 10, maxToolResultLength: 12000 },
        credentials
      );
      send({ type: 'proposals', edits: proposals, iterations: result.iterations, finalText: result.text });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send({ type: 'error', error: message.slice(0, 400) });
      logger.warn('Édition IA en échec', { component: 'app-edit', projectId, error: message });
    }
    res.end();
    return true;
  }

  // 2. POST /app/apply-edits (SSE) — application confirmée → révision → rebuild
  const applyMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/app\/apply-edits$/);
  if (applyMatch && req.method === 'POST') {
    const projectId = applyMatch[1]!;
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    const bodyText = await readBody(req);
    let body: { edits?: Array<{ action?: string; path?: string; find?: string; replace?: string; content?: string }> };
    try {
      body = bodyText ? (JSON.parse(bodyText) as typeof body) : {};
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }
    const edits = Array.isArray(body.edits) ? body.edits.slice(0, 30) : [];
    if (edits.length === 0) {
      throw new ValidationError('Le champ "edits" est obligatoire (au moins une modification)', undefined, requestId);
    }

    const { send } = startSSE(req, res);
    try {
      ensureWorkspace(projectId);
      const changedFiles: Record<string, string> = {};
      let applied = 0;
      send({ type: 'apply-start', count: edits.length });
      for (const edit of edits) {
        const path = String(edit.path ?? '');
        if (edit.action === 'create') {
          const content = String(edit.content ?? '');
          const res2 = writeAppFile(projectId, path, content);
          if (!res2.ok) { send({ type: 'apply-skip', path, reason: res2.reason }); continue; }
          changedFiles['app/' + path] = content;
          applied += 1;
          send({ type: 'applied', path, action: 'create' });
        } else if (edit.action === 'edit') {
          const find = String(edit.find ?? '');
          const replace = String(edit.replace ?? '');
          const current = readAppFile(projectId, path);
          if (current === null) { send({ type: 'apply-skip', path, reason: 'fichier introuvable' }); continue; }
          const occurrences = current.split(find).length - 1;
          if (find.length === 0 || occurrences !== 1) { send({ type: 'apply-skip', path, reason: 'find non unique ou absent' }); continue; }
          const updated = current.replace(find, replace);
          const res2 = writeAppFile(projectId, path, updated);
          if (!res2.ok) { send({ type: 'apply-skip', path, reason: res2.reason }); continue; }
          changedFiles['app/' + path] = updated;
          applied += 1;
          send({ type: 'applied', path, action: 'edit' });
        }
      }

      // Révision multi-fichiers (rollback possible via l'historique)
      if (applied > 0) {
        try {
          revisionStore.createRevision(context.tenantId, projectId, {
            message: 'Édition IA — projet React (' + applied + ' fichier(s))',
            author: 'Builder',
            files: changedFiles,
            provenance: { source: 'AI_AGENT', triggerRequestId: requestId }
          });
        } catch (err) {
          logger.warn('Révision d édition projet non créée', {
            component: 'app-edit', projectId,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }

      // Rebuild du bundle (les sources ont changé)
      send({ type: 'build-start' });
      let build = await buildApp(projectId);
      send({ type: build.ok ? 'build-ok' : 'build-error', durationMs: build.durationMs, errors: build.errors.slice(0, 4) });

      // P4 — auto-réparation bornée : si l'application des éditions a cassé
      // le build, les erreurs de compilation repartent à l'IA qui corrige
      // DIRECTEMENT (l'utilisateur a déjà confirmé l'intention fonctionnelle).
      let repairRounds = 0;
      while (!build.ok && repairRounds < 2) {
        repairRounds += 1;
        send({ type: 'repair', round: repairRounds });
        const adapter = aiProviderRegistry.resolve({ preferredProviderId: process.env.MISTRAL_API_KEY ? 'mistral' : undefined });
        if (!adapter) break;
        const credentials = aiProviderRegistry.getTenantCredentials(context.tenantId, adapter.descriptor.providerId);
        const repairProposals: ProposedEdit[] = [];
        await runToolLoop(
          adapter,
          {
            tenantId: context.tenantId,
            projectId,
            prompt: 'Le build TypeScript/Vite échoue avec ces erreurs :\n\n' + build.errors.join('\n---\n').slice(0, 3000)
              + '\n\nCorrige les fichiers nécessaires (edit_file pour des corrections ciblées). Ne touche à rien d\'autre.',
            systemPrompt: EDIT_SYSTEM_PROMPT,
            temperature: 0.2,
            maxTokens: 8192,
            timeoutMs: 120000,
            requestId
          },
          editTools(),
          {
            // mode DIRECT : les corrections de compilation s'appliquent
            // immédiatement (l'intention fonctionnelle est déjà confirmée).
            handlers: {
              list_files: () => listAppFiles(projectId).map((f) => f.path).join('\n'),
              read_file: (a) => readAppFile(projectId, String(a.path ?? '')) ?? 'ERREUR: fichier introuvable',
              edit_file: (a) => {
                const path = String(a.path ?? '');
                const find = String(a.find ?? '');
                const replace = String(a.replace ?? '');
                const current = readAppFile(projectId, path);
                if (current === null || find.length === 0) return 'ERREUR: fichier ou find invalide.';
                if (current.split(find).length - 1 !== 1) return 'ERREUR: find non unique — élargis le contexte.';
                const res2 = writeAppFile(projectId, path, current.replace(find, replace));
                return res2.ok ? 'OK — corrigé.' : 'ERREUR: ' + (res2.reason || 'écriture impossible');
              },
              create_file: (a) => {
                const res2 = writeAppFile(projectId, String(a.path ?? ''), String(a.content ?? ''));
                return res2.ok ? 'OK — créé.' : 'ERREUR: ' + (res2.reason || 'écriture impossible');
              }
            },
            maxIterations: 8,
            maxToolResultLength: 6000
          },
          credentials
        );
        void repairProposals;
        build = await buildApp(projectId);
        send({ type: build.ok ? 'build-ok' : 'build-error', durationMs: build.durationMs, errors: build.errors.slice(0, 4), round: repairRounds });
      }
      send({ type: 'done', ok: build.ok, buildId: build.buildId, applied });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send({ type: 'error', error: message.slice(0, 400) });
      logger.warn('Application d éditions en échec', { component: 'app-edit', projectId, error: message });
    }
    res.end();
    return true;
  }

  // 3. GET /app/status — format du projet + bundle disponible (reprise E41)
  const statusMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/app\/status$/);
  if (statusMatch && req.method === 'GET') {
    const projectId = statusMatch[1]!;
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const files = listAppFiles(projectId);
    const hasAppSources = files.some((f) => f.path.startsWith('src/'));
    const ws = ensureWorkspace(projectId);
    const format = getProjectFormat(projectId);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      format,
      hasBundle: format === 'react-vite' && hasAppSources && existsSync(join(ws, 'dist', 'index.html')),
      files: files.map((f) => f.path)
    }));
    return true;
  }

  return false;
}
