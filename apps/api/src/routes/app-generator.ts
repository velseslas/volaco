/**
 * VibeCode Core - API Tier
 * App Generator Route (P1/P2) — génère un VRAI projet React + Vite + TS +
 * Tailwind par tool-calling, le construit côté serveur et sert le bundle
 * pour le preview. Le standard des grandes plateformes : le preview exécute
 * l'app réelle, pas du HTML injecté.
 *
 * Flux de génération (SSE) :
 *   ensureWorkspace (reset = site frais)
 *   → boucle d'outils (create_file / list_files) — l'IA écrit les composants
 *   → build Vite programmatique
 *   → si erreurs de compilation : renvoyées à l'IA (auto-réparation bornée)
 *   → 'done' : le preview pointe sur /preview-bundle/:id/?v=<buildId>
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { acquireProjectLock, isSafeProjectId, workspaceDir } from '../../../../packages/core/src/app-pipeline.js';
import { logger } from '../../../../packages/core/src/logger.js';
import { aiProviderRegistry } from '../../../../packages/core/src/ai/providers/registry.js';
import { runToolLoop } from '../../../../packages/core/src/ai/tool-loop.js';
import type { AIProviderTool } from '../../../../packages/core/src/ai/providers/types.js';
import {
  buildApp,
  ensureWorkspace,
  listAppFiles,
  readAppFile,
  setProjectFormat,
  validateAppPath,
  writeAppFile
} from '../../../../packages/core/src/app-pipeline.js';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/index.js';

/** FileStore : les SOURCES du projet sont aussi versionnées (révisions). */
function persistSource(tenantId: string, projectId: string, path: string, content: string): void {
  try {
    fileStore.saveFile(tenantId, projectId, 'app/' + path, content);
  } catch (err) {
    logger.warn('Persistance source app impossible', {
      component: 'app-generator',
      projectId,
      path,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

function toolsFor(tenantId: string, projectId: string, emit: (data: Record<string, unknown>) => void): AIProviderTool[] {
  return [
    {
      name: 'create_file',
      description: 'Crée ou REMPLIT un fichier du projet React. Écris des composants TSX complets et compilables. Respecte : src/App.tsx est le point d\'entrée rendu ; src/index.css contient déjà @import "tailwindcss" ; utilise des classes Tailwind pour le style ; jamais de script inline.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Chemin relatif du fichier (ex: src/components/Header.tsx)' },
          content: { type: 'string', description: 'Contenu COMPLET du fichier' }
        },
        required: ['path', 'content']
      }
    },
    {
      name: 'list_files',
      description: 'Liste les fichiers déjà créés dans le projet.',
      parameters: { type: 'object', properties: {} }
    }
  ];
}

const EDIT_SYSTEM_PROMPT = [
  'Tu es le Lead Engineer IA de VibeCode Studio. Tu modifies un projet React + TypeScript + Tailwind EXISTANT, fichier par fichier.',
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

/**
 * Handlers en mode DIFFÉRÉ : read_file lit réellement (le modèle a besoin
 * du code), edit_file/create_file valident et COLLECTENT une proposition
 * — aucune écriture tant que l utilisateur n a pas confirmé. Le modèle
 * reçoit OK pour conclure.
 */
function editHandlers(
  tenantId: string,
  projectId: string,
  proposals: ProposedEdit[]
): Record<string, (args: Record<string, unknown>) => unknown> {
  const cap = (t: string, n: number): string => (t.length > n ? t.slice(0, n) + '…' : t);
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
      const occurrences = current.split(find).length - 1;
      if (find.length === 0) return 'ERREUR: find vide.';
      if (occurrences === 0) return 'ERREUR: find introuvable dans ' + path + ' — relis le fichier et copie le code EXACTEMENT (indentation comprise).';
      if (occurrences > 1) return 'ERREUR: find apparaît ' + occurrences + ' fois dans ' + path + ' — élargis le contexte pour le rendre UNIQUE.';
      proposals.push({ action: 'edit', path, find, replace, summary: path + ' : « ' + cap(find, 70) + ' » → « ' + cap(replace, 70) + ' »' });
      return 'OK — modification proposée (elle ne sera appliquée qu après confirmation humaine).';
    },
    create_file: (args) => {
      const path = String(args.path ?? '');
      const content = String(args.content ?? '');
      if (content.trim().length === 0) return 'ERREUR: contenu vide.';
      const res = validateAppPath(path);
      if (!res.ok) return 'ERREUR: ' + res.reason;
      // validation de chemin OK — mais AUCUNE écriture du contenu ici
      proposals.push({ action: 'create', path, content, summary: path + ' : nouveau fichier (' + content.split('\n').length + ' lignes)' });
      return 'OK — création proposée (elle ne sera appliquée qu après confirmation humaine).';
    }
  };
}

function handlersFor(
  tenantId: string,
  projectId: string,
  emit: (data: Record<string, unknown>) => void
): Record<string, (args: Record<string, unknown>) => unknown> {
  return {
    create_file: (args) => {
      const path = String(args.path ?? '');
      const content = String(args.content ?? '');
      const res = writeAppFile(projectId, path, content);
      if (!res.ok) return 'ERREUR: ' + res.reason;
      persistSource(tenantId, projectId, path, content);
      emit({ type: 'file', path });
      return 'OK — fichier ' + path + ' écrit (' + content.length + ' caractères).';
    },
    list_files: () => {
      const files = listAppFiles(projectId);
      return files.map((f) => f.path + ' (' + f.size + ' o)').join('\n') || '(projet vide)';
    }
  };
}

const GENERATION_SYSTEM_PROMPT = [
  'Tu es le Lead Engineer IA de VibeCode Studio. Tu génères un site web complet, moderne et ÉLÉGANT, en écrivant un VRAI projet React + TypeScript + Tailwind, fichier par fichier.',
  '',
  'CONTRAINTES TECHNIQUES (obligatoires) :',
  '- src/main.tsx et src/index.css existent déjà (ne les recrée pas, ne les modifie pas).',
  '- Écris src/App.tsx qui compose le site, et UN composant par section dans src/components/ (Header.tsx, Hero.tsx, …).',
  '- Styles : UNIQUEMENT des classes Tailwind (le CSS est déjà branché). Aucun <script>, aucun import de fichier CSS autre que l\'existant.',
  '- Imports : uniquement react / react-dom et des fichiers locaux relatifs (./components/Header). Aucune dépendance npm supplémentaire.',
  '- Images : uniquement des URL https://images.unsplash.com/photo-… cohérentes avec le thème.',
  '- Chaque fichier doit COMPILER (TypeScript strict, exports nommés par défaut pour les composants).',
  '',
  'QUALITÉ DESIGN (obligatoire) : palette limitée et cohérente, hiérarchie typographique nette, espacements généreux, états hover sur les boutons, responsive (sm/md/lg), contenu réaliste en français. Le résultat doit avoir l\'air conçu par un designer senior.',
  '',
  'MODE OPÉRATOIRE : crée les fichiers un par un avec create_file (un appel par fichier, contenu COMPLET), puis termine par une phrase courte. Ne pose jamais de question.'
].join('\n');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

export async function handleAppGeneratorRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // 1. Génération SSE : POST /api/v1/projects/:id/app/generate
  const genMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/app\/generate$/);
  if (genMatch && req.method === 'POST') {
    const projectId = genMatch[1]!;
    assertPermission(context.role, 'PROJECT_UPDATE', requestId);
    // PV-02 — le projet doit exister ET appartenir au locataire (404
    // indiscernable sinon : pas d'oracle inter-locataires).
    if (!isSafeProjectId(projectId)) {
      throw new ValidationError('Identifiant de projet invalide', undefined, requestId);
    }
    if (!projectStore.getProject(context.tenantId, projectId)) {
      throw new NotFoundError(`Projet ${projectId}`, requestId);
    }

    const bodyText = await readBody(req);
    let body: { prompt?: string };
    try {
      body = bodyText ? (JSON.parse(bodyText) as { prompt?: string }) : {};
    } catch {
      throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
    }
    const prompt = (body.prompt || '').trim();
    if (prompt.length === 0) {
      throw new ValidationError('Le champ "prompt" est obligatoire', undefined, requestId);
    }

    // P1-masse — VERROU PAR PROJET : tout le flux (reset, écritures IA,
    // builds, réparations) est sérialisé par projet. Acquis AVANT le SSE
    // (sinon 503 après des en-têtes 200 = client pendu).
    const releaseProject = await acquireProjectLock(projectId, { requestId });

    // SSE
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    let clientGone = false;
    // P0-masse n°3 — l'abandon client (onglet fermé) coupe AUSSI les boucles
    // LLM (sinon crédit brûlé pour personne) via le signal ci-dessous.
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

    // Site frais : le workspace est reconstruit depuis le template.
    ensureWorkspace(projectId, true);
    setProjectFormat(projectId, 'react-vite');
    send({ type: 'start' });

    const adapter = aiProviderRegistry.resolve({ preferredProviderId: process.env.MISTRAL_API_KEY ? 'mistral' : undefined });
    if (!adapter) {
      send({ type: 'error', error: 'Aucun fournisseur IA disponible (Mistral requis).' });
      res.end();
      return true;
    }

    const credentials = aiProviderRegistry.getTenantCredentials(context.tenantId, adapter.descriptor.providerId);

    try {
      // P1 — génération des fichiers par tool-calling (boucle bornée).
      const gen = await runToolLoop(
        adapter,
        {
          tenantId: context.tenantId,
          projectId,
          prompt: 'Crée le site suivant : ' + prompt,
          systemPrompt: GENERATION_SYSTEM_PROMPT,
          temperature: 0.3,
          maxTokens: 8192,
          timeoutMs: 120000,
          requestId
        },
        toolsFor(context.tenantId, projectId, send),
        { handlers: handlersFor(context.tenantId, projectId, send), maxIterations: 12, maxToolResultLength: 2000, signal: aborter.signal },
        credentials
      );
      send({ type: 'generation-done', iterations: gen.iterations, toolCalls: gen.trace.length });

      // P2 — build + auto-réparation bornée (les erreurs compilateur
      // repartent à l'IA qui corrige les fichiers).
      let build = await buildApp(projectId);
      send({ type: build.ok ? 'build-ok' : 'build-error', durationMs: build.durationMs, errors: build.errors.slice(0, 4) });
      let repairRounds = 0;
      while (!build.ok && repairRounds < 3 && !clientGone) {
        repairRounds += 1;
        send({ type: 'repair', round: repairRounds });
        const fixPrompt = 'Le build TypeScript/Vite du projet échoue avec ces erreurs :\n\n' + build.errors.join('\n---\n').slice(0, 3000)
          + '\n\nCorrige les fichiers nécessaires avec create_file (contenu COMPLET des fichiers corrigés). Ne touche à rien d\'autre.';
        await runToolLoop(
          adapter,
          {
            tenantId: context.tenantId,
            projectId,
            prompt: fixPrompt,
            systemPrompt: GENERATION_SYSTEM_PROMPT,
            temperature: 0.2,
            maxTokens: 8192,
            timeoutMs: 120000,
            requestId
          },
          toolsFor(context.tenantId, projectId, send),
          { handlers: handlersFor(context.tenantId, projectId, send), maxIterations: 8, maxToolResultLength: 2000, signal: aborter.signal },
          credentials
        );
        build = await buildApp(projectId);
        send({ type: build.ok ? 'build-ok' : 'build-error', durationMs: build.durationMs, errors: build.errors.slice(0, 4), round: repairRounds });
      }

      const files = listAppFiles(projectId);
      send({ type: 'done', ok: build.ok, buildId: build.buildId, files: files.map((f) => f.path), durationMs: build.durationMs });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send({ type: 'error', error: message.slice(0, 400) });
      logger.warn('Génération d\'app en échec', { component: 'app-generator', projectId, error: message });
    } finally {
      releaseProject();
    }
    res.end();
    return true;
  }

  // 2. Service du bundle : GET /preview-bundle/:id/…
  const bundleMatch = pathname.match(/^\/preview-bundle\/([^/]+)(\/.*)?$/);
  if (bundleMatch && req.method === 'GET') {
    const rawId = bundleMatch[1]!;
    assertPermission(context.role, 'PROJECT_READ', requestId);
    if (!isSafeProjectId(rawId)) {
      throw new ValidationError('Identifiant de projet invalide', undefined, requestId);
    }
    // PV-02/PV-19 — lecture SEULE : jamais de matérialisation pour un
    // inconnu (fini la copie template sur ids arbitraires sans jeton).
    // Pas de contrôle de locataire ici : l'iframe preview navigue sans
    // en-têtes (contexte défaut) ; les ids sont indevinables et la
    // création est verrouillée — le résiduel est documenté, les URLs
    // signées viendront ensuite.
    const wsRoot = workspaceDir(rawId);
    const rel = bundleMatch[2] && bundleMatch[2] !== '/' ? bundleMatch[2].slice(1) : 'index.html';
    let file = join(wsRoot, 'dist', rel);
    // Confinement du fichier servi (ceinture : l'URL normalisée ne décode
    // pas les `..`, mais on ne fait jamais confiance au chemin construit).
    const resolvedFile = resolve(wsRoot, 'dist', rel);
    if (resolvedFile !== join(wsRoot, 'dist') && !resolvedFile.startsWith(join(wsRoot, 'dist') + sep)) {
      throw new NotFoundError(`Ressource ${rel}`, requestId);
    }
    file = resolvedFile;
    if (!existsSync(file) || statSync(file).isDirectory()) {
      file = join(wsRoot, 'dist', 'index.html'); // fallback SPA
    }
    if (!existsSync(file)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Aucun bundle généré pour ce projet — lancez une génération.');
      return true;
    }
    res.statusCode = 200;
    // E47/P2 — l'iframe sandboxée (origine opaque) charge les modules en
    // cross-origin : CORS ouvert sur le bundle, l'isolation reste assurée
    // par le sandbox (pas de allow-same-origin → pas d'accès aux API).
    res.setHeader('Access-Control-Allow-Origin', '*');
    // PV-01 — cage du popout : le bundle ouvert EN ONGLET héritait de
    // l'origine du Studio (localStorage = JWT + clé IA lisibles par le JS
    // généré). `sandbox allow-scripts` impose une origine OPAQUE même en
    // top-level : scripts OK, stockage/API avec identifiants morts. COOP
    // coupe window.opener. L'iframe intégrée (déjà opaque) est inchangée.
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.end(readFileSync(file));
    return true;
  }

  return false;
}
