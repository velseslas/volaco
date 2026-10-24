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
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { acquireProjectLock, isSafeProjectId } from '../../../../packages/core/src/app-pipeline.js';
import { logger } from '../../../../packages/core/src/logger.js';
import { aiProviderRegistry } from '../../../../packages/core/src/ai/providers/registry.js';
import { preferredAiProvider } from '../../../../packages/core/src/ai/providers/provider-catalog.js';
import { runToolLoop } from '../../../../packages/core/src/ai/tool-loop.js';
import type { AIProviderTool } from '../../../../packages/core/src/ai/providers/types.js';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import { withProjectDesignContext } from '../../../../packages/core/src/ai-native/design-harmony/design-context.js';
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
import { fileStore } from '../../../../packages/core/src/file-explorer/index.js';
// P1-B — images en édition React : brief thématique 'modify' dans le prompt
// réel + inspection du contenu FINAL projeté avant toute écriture (aucune
// transformation du TSX, refus par apply-skip si violation).
import {
  buildImageBrief,
  detectImageTheme,
  imageThemeOfContent,
  thematicImageRewrite,
  type ImageTheme
} from '../../../../packages/core/src/image/theme.js';
import {
  formatImageViolations,
  inspectAppImageSources,
  type AppImageInspection
} from '../../../../packages/core/src/image/app-policy.js';
import { adoptedImageIds } from '../../../../packages/core/src/image/image-adoptions.js';

/** FileStore : les sources modifiées sont aussi versionnées (révisions). */
function persistSource(tenantId: string, projectId: string, path: string, content: string): void {
  try {
    fileStore.saveFile(tenantId, projectId, 'app/' + path, content);
  } catch (err) {
    logger.warn('Persistance source app impossible', { component: 'app-edit', projectId, path, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * PATCH PERTINENCE — thème dominant des images VÉRIFIÉES déjà présentes dans
 * le projet React : l'édition/réparation conserve l'IDENTITÉ du site (une
 * demande sans secteur explicite ne bascule pas les photos existantes vers
 * le neutre ; inversement, une réintroduction pizza sur un site clinique est
 * réécrite vers le réservoir du site). Fonction pure : aucun thème inventé.
 */
function projectImageTheme(projectId: string): ImageTheme | null {
  const counts = new Map<ImageTheme, number>();
  for (const file of listAppFiles(projectId)) {
    const content = readAppFile(projectId, file.path);
    if (content === null) continue;
    const theme = imageThemeOfContent(content);
    if (theme !== null) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }
  let best: ImageTheme | null = null;
  let bestCount = 0;
  for (const [theme, count] of counts) {
    if (count > bestCount) { best = theme; bestCount = count; }
  }
  return best;
}

/**
 * P1-B — synthèse courte des violations d'images d'un contenu, pour un
 * apply-skip lisible ou un retour d'erreur au LLM (fichier, ligne, référence).
 */
function violationReason(path: string, inspection: AppImageInspection): string | null {
  const lines = formatImageViolations(inspection, 10)
    .filter((line) => line.startsWith('- ' + path + ' '))
    .map((line) => line.replace(/^- /, ''))
    .slice(0, 2);
  if (lines.length === 0) return null;
  return lines.join(' ; ').slice(0, 240);
}

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

/**
 * PV-02 — le projet doit exister ET appartenir au locataire (404
 * indiscernable sinon : pas d'oracle inter-locataires, pas de build ni
 * d'édition IA sur le projet d'autrui).
 */
function assertProjectInScope(tenantId: string, projectId: string, requestId: string): void {
  if (!isSafeProjectId(projectId)) {
    throw new ValidationError('Identifiant de projet invalide', undefined, requestId);
  }
  if (!projectStore.getProject(tenantId, projectId)) {
    throw new NotFoundError(`Projet ${projectId}`, requestId);
  }
}

function startSSE(req: IncomingMessage, res: ServerResponse): { send: (data: Record<string, unknown>) => void; signal: AbortSignal } {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  let clientGone = false;
  // P0-masse n°3 — l'abandon client coupe AUSSI les boucles LLM (signal).
  // É48 P2 : en SSE c'est `res close` (pas `req close`) qui signale
  // fiablement la déconnexion — on écoute les deux.
  const aborter = new AbortController();
  const markGone = (): void => { clientGone = true; aborter.abort(); };
  req.on('close', markGone);
  res.on('close', () => { if (!res.writableEnded) markGone(); });
  const send = (data: Record<string, unknown>): void => {
    if (clientGone) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  return { send, signal: aborter.signal };
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
    assertProjectInScope(context.tenantId, projectId, requestId);
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

    // P1-B — le même contrat de réservoir que la génération, mode 'modify' :
    // l'IA d'édition connaît les IDs vérifiés et la règle de préservation ;
    // l'inspection serveur à l'application complète ce filet (prompt-only.
    // pas de réécriture du code par le serveur).
    const editTheme = detectImageTheme(instruction);
    // P0 (audit 2026-10) — contexte Design réel du projet ajouté au prompt
    // d'édition ; sans rapport persisté, texte strictement inchangé.
    const editSystemPrompt = withProjectDesignContext(
      EDIT_SYSTEM_PROMPT + '\n\n' + buildImageBrief(editTheme, 'modify'),
      { tenantId: context.tenantId, projectId }
    );
    logger.info('Contrat de thème (édition React)', {
      component: 'app-edit',
      tenantId: context.tenantId,
      projectId,
      imageTheme: editTheme,
      requestId
    });

    const { send, signal } = startSSE(req, res);
    const adapter = aiProviderRegistry.resolve({
      // LOT MULTI-MODÈLES — fournisseur actif du tableau de bord ; héritage sinon.
      preferredProviderId: preferredAiProvider() ?? (process.env.MISTRAL_API_KEY ? 'mistral' : undefined)
    });
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
          systemPrompt: editSystemPrompt,
          temperature: 0.2,
          maxTokens: 8192,
          timeoutMs: 120000,
          requestId
        },
        editTools(),
        { handlers: editHandlers(projectId, proposals), maxIterations: 10, maxToolResultLength: 12000, signal },
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
    assertProjectInScope(context.tenantId, projectId, requestId);
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

    // P1-masse — VERROU PAR PROJET (comme /app/generate) : acquis AVANT le
    // SSE pour un 503 propre en cas de contention.
    const releaseProject = await acquireProjectLock(projectId, { requestId });
    const { send, signal } = startSSE(req, res);
    try {
      ensureWorkspace(projectId);
      // P1-B — PRÉ-SIMULATION DE L'ENSEMBLE (aucune écriture) : chaque fichier
      // est mis en chaîne dans l'ordre des edits (find/replace, même
      // sémantique d'occurrence unique que l'ancienne boucle), puis le
      // contenu FINAL de chaque fichier est inspecté. Un fichier dont l'état
      // final viole la politique d'images n'est PAS appliqué du tout (aucune
      // écriture partielle) — refus explicite par apply-skip (hôte/ligne/
      // référence) ; les autres fichiers restent applicables. Révisions et
      // bundle précédents restent préservés tant qu'aucune écriture n'a lieu.
      interface SimEdit { index: number; skip: boolean; reason: string | null; content: string | null; }
      interface SimFile { content: string | null; violation: string | null; edits: SimEdit[]; }
      const simulated = new Map<string, SimFile>();
      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i]!;
        const path = String(edit.path ?? '');
        let state = simulated.get(path);
        if (state === undefined) {
          state = { content: null, violation: null, edits: [] };
          simulated.set(path, state);
          if (edit.action !== 'create') {
            state.content = readAppFile(projectId, path);
            if (state.content === null) state.violation = 'fichier introuvable';
          }
        }
        if (state.violation === 'fichier introuvable') {
          state.edits.push({ index: i, skip: true, reason: 'fichier introuvable', content: null });
          continue;
        }
        if (edit.action === 'create') {
          const content = String(edit.content ?? '');
          if (content.trim().length === 0) {
            state.edits.push({ index: i, skip: true, reason: 'contenu vide', content: null });
            continue;
          }
          const check = validatePath(path);
          if (!check.ok) {
            state.edits.push({ index: i, skip: true, reason: check.reason ?? 'chemin non autorisé', content: null });
            continue;
          }
          state.content = content;
          state.edits.push({ index: i, skip: false, reason: null, content });
        } else if (edit.action === 'edit') {
          const find = String(edit.find ?? '');
          const replace = String(edit.replace ?? '');
          if (state.content === null) {
            state.edits.push({ index: i, skip: true, reason: 'fichier introuvable', content: null });
            continue;
          }
          if (find.length === 0 || state.content.split(find).length - 1 !== 1) {
            state.edits.push({ index: i, skip: true, reason: 'find non unique ou absent', content: null });
            continue;
          }
          const updated = state.content.replace(find, replace);
          state.content = updated;
          state.edits.push({ index: i, skip: false, reason: null, content: updated });
        } else {
          state.edits.push({ index: i, skip: true, reason: 'action inconnue', content: null });
        }
      }
      // P1-B — inspection du contenu FINAL par fichier (celui qui serait
      // écrit si l'ensemble était appliqué). Violation ? Le fichier est mis
      // sur liste de refus GLOBALE (tous ses edits).
      for (const [path, state] of simulated) {
        const content = state.content;
        if (content === null || content.trim().length === 0) continue;
        const violation = violationReason(path, inspectAppImageSources([{ path, content }], { adoptedIds: adoptedImageIds() }));
        if (violation !== null) state.violation = violation;
      }

      const changedFiles: Record<string, string> = {};
      let applied = 0;
      send({ type: 'apply-start', count: edits.length });
      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i]!;
        const path = String(edit.path ?? '');
        const state = simulated.get(path);
        const step = state?.edits.find((e) => e.index === i);
        if (!state || !step) { send({ type: 'apply-skip', path, reason: 'action inconnue' }); continue; }
        if (step.skip) { send({ type: 'apply-skip', path, reason: step.reason ?? 'non applicable' }); continue; }
        if (state.violation !== null) {
          send({ type: 'apply-skip', path, reason: 'images interdites — ' + state.violation });
          continue;
        }
        const content = step.content;
        if (content === null) { send({ type: 'apply-skip', path, reason: 'contenu indisponible' }); continue; }
        // PATCH PERTINENCE — l'édition ne réintroduit PAS les images hors
        // secteur : réécriture thématique du contenu final AVANT écriture.
        // Thème = identité du FICHIER courant, sinon du projet, sinon NEUTRE
        // (thème insuffisamment identifié → réservoir neutre). Seed 0 (ordre
        // historique) : aucune rotation à chaque edit.
        const fileTheme = imageThemeOfContent(readAppFile(projectId, path) ?? '')
          ?? projectImageTheme(projectId) ?? 'autre';
        const themed = thematicImageRewrite(content, fileTheme, 0);
        const res2 = writeAppFile(projectId, path, themed.content);
        if (!res2.ok) { send({ type: 'apply-skip', path, reason: res2.reason }); continue; }
        changedFiles['app/' + path] = themed.content;
        persistSource(context.tenantId, projectId, path, themed.content);
        applied += 1;
        send({ type: 'applied', path, action: String(edit.action ?? '') });
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
      while (!build.ok && repairRounds < 2 && !signal.aborted) {
        repairRounds += 1;
        send({ type: 'repair', round: repairRounds });
        const adapter = aiProviderRegistry.resolve({
      // LOT MULTI-MODÈLES — fournisseur actif du tableau de bord ; héritage sinon.
      preferredProviderId: preferredAiProvider() ?? (process.env.MISTRAL_API_KEY ? 'mistral' : undefined)
    });
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
            systemPrompt: withProjectDesignContext(EDIT_SYSTEM_PROMPT, { tenantId: context.tenantId, projectId }),
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
                // PATCH PERTINENCE — la réparation ne réintroduit pas les
                // images hors secteur : réécriture thématique du contenu
                // final (identité = fichier courant, sinon projet/demande)
                // avant le contrôle de politique images.
                const repairTheme = imageThemeOfContent(current)
                  ?? projectImageTheme(projectId) ?? 'autre';
                const updated = thematicImageRewrite(current.replace(find, replace), repairTheme, 0).content;
                // P1-B — la réparation directe respecte la politique images :
                // aucune URL interdite n'est écrite ; le LLM reçoit l'erreur
                // précise et corrige autrement (aucune réécriture serveur).
                const violation = violationReason(path, inspectAppImageSources([{ path, content: updated }], { adoptedIds: adoptedImageIds() }));
                if (violation !== null) return 'ERREUR: images interdites (' + violation + ') — remplace par un ID vérifié du RÉSERVOIR (voir brief) ou https://picsum.photos/seed/….';
                const res2 = writeAppFile(projectId, path, updated);
                return res2.ok ? 'OK — corrigé.' : 'ERREUR: ' + (res2.reason || 'écriture impossible');
              },
              create_file: (a) => {
                const path = String(a.path ?? '');
                // PATCH PERTINENCE — idem : le nouveau fichier suit l'identité
                // du projet (sinon le thème de la demande) avant le contrôle.
                const repairTheme = projectImageTheme(projectId) ?? 'autre';
                const content = thematicImageRewrite(String(a.content ?? ''), repairTheme, 0).content;
                const violation = violationReason(path, inspectAppImageSources([{ path, content }], { adoptedIds: adoptedImageIds() }));
                if (violation !== null) return 'ERREUR: images interdites (' + violation + ') — remplace par un ID vérifié du RÉSERVOIR (voir brief) ou https://picsum.photos/seed/….';
                const res2 = writeAppFile(projectId, path, content);
                return res2.ok ? 'OK — créé.' : 'ERREUR: ' + (res2.reason || 'écriture impossible');
              }
            },
            maxIterations: 8,
            maxToolResultLength: 6000,
            signal
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
    } finally {
      releaseProject();
    }
    res.end();
    return true;
  }

  // 3. GET /app/status — format du projet + bundle disponible (reprise E41)
  const statusMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/app\/status$/);
  if (statusMatch && req.method === 'GET') {
    const projectId = statusMatch[1]!;
    assertPermission(context.role, 'PROJECT_READ', requestId);
    assertProjectInScope(context.tenantId, projectId, requestId);
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
