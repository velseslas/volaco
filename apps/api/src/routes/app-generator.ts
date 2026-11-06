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
import { preferredAiProvider } from '../../../../packages/core/src/ai/providers/provider-catalog.js';
import {
  buildImageBrief,
  buildSectorContract,
  detectImageTheme,
  poolRotationSeed,
  thematicImageRewrite,
  type ImageTheme,
} from '../../../../packages/core/src/image/theme.js';
// P1-B — contrôle images des apps React : inspection AVANT sauvegarde/build
// (aucune réécriture server-side du TSX ; violations renvoyées au LLM).
import {
  formatImageViolations,
  inspectAppImageSources,
  isInspectableAppFile,
  type AppImageInspection
} from '../../../../packages/core/src/image/app-policy.js';
// PATCH L2 — barrière d'écriture du générateur (B1) : le contenu CANDIDAT de
// create_file est inspecté par la porte partagée R3-B (cité unique du
// checker : app-policy) AVANT toute écriture. Fail-closed et `undetermined`
// non bloquant sont ceux du pipeline — aucun second scanner.
import { imageGateInspect, type ImageGateInspector } from '../middleware/image-gate.js';
import { adoptedImageIds } from '../../../../packages/core/src/image/image-adoptions.js';
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
import { withProjectDesignContext } from '../../../../packages/core/src/ai-native/design-harmony/design-context.js';
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

/** PATCH L2 — événement d'écriture candidate refusée par la barrière. */
export interface ImageWriteRefusalEvent {
  readonly path: string;
  /** Vocabulaire ImageGateKind : 'violations' (politique) ou 'inspection-error' (fail-closed). */
  readonly kind: 'violations' | 'inspection-error';
  /** Issues formatées par le checker (fichier, ligne, référence, motif). */
  readonly issues: readonly string[];
}

/** PATCH L2 — seams du contrôle d'écriture (réservés aux tests ; défaut = production). */
export interface GenerateWriteGateHooks {
  /** Inspecteur injecté pour tester le fail-closed ; défaut : scanner du pipeline. */
  readonly inspector?: ImageGateInspector;
  /** Comptabilité route : signalé pour TOUTE écriture candidate refusée. */
  readonly onImageWriteRefusal?: (entry: ImageWriteRefusalEvent) => void;
  /**
   * PATCH PERTINENCE — thème de réécriture thématique du candidat create_file
   * (défaut 'autre') : une URL Unsplash VÉRIFIÉE appartenant à un autre
   * secteur est remplacée par une image du réservoir de ce thème AVANT que la
   * barrière de sécurité n'inspecte ce qui sera réellement écrit. La
   * SÉCURITÉ (app-policy.ts / image-gate.ts) n'est ni modifiée ni contournée.
   */
  readonly imageTheme?: ImageTheme;
  /** PATCH PERTINENCE — seed de rotation déterministe (0 = ordre historique). */
  readonly imageRotationSeed?: number;
}

/**
 * PATCH L2 (B1) — handlers de génération avec contrôle AVANT ÉCRITURE : le
 * contenu candidat de create_file passe par la porte partagée
 * (imageGateInspect → app-policy) AVANT writeAppFile. Garanties :
 *  1. violation        → RIEN n'est écrit (ni workspace, ni miroir
 *     FileStore) : le fichier préexistant garde son contenu exact ; l'LLM
 *     reçoit fichier/ligne/référence et peut corriger dans la même boucle ;
 *  2. checker indisponible → fail-closed : RIEN n'est écrit (jamais traité
 *     comme une validation) ;
 *  3. `undetermined` → non bloquant inchangé (politique L1/L7 intacte).
 * La barrière terminale L1 de buildApp reste en place au-delà de ce contrôle
 * (défense en profondeur, inchangée).
 */
export function handlersFor(
  tenantId: string,
  projectId: string,
  emit: (data: Record<string, unknown>) => void,
  gate: GenerateWriteGateHooks = {}
): Record<string, (args: Record<string, unknown>) => unknown> {
  // PATCH PERTINENCE — pertinence ≠ sécurité : app-policy / image-gate restent
  // l'unique autorité des HÔTES/IDs autorisés ; en amont, le candidat
  // create_file passe par la réécriture thématique (IDs vérifiés d'un autre
  // secteur → réservoir du thème), PUIS la porte L2 inspecte exactement ce
  // qui sera écrit — Inspection = contenu final = contenu sur disque.
  const pertinenceTheme = gate.imageTheme ?? 'autre';
  const pertinenceSeed = gate.imageRotationSeed ?? 0;
  return {
    create_file: (args) => {
      const path = String(args.path ?? '');
      const themed = thematicImageRewrite(
        String(args.content ?? ''),
        pertinenceTheme,
        pertinenceSeed
      );
      const content = themed.content;
      if (isInspectableAppFile(path)) {
        const candidate = imageGateInspect([{ path, content }], gate.inspector);
        if (candidate.kind !== 'clean') {
          gate.onImageWriteRefusal?.({ path, kind: candidate.kind, issues: candidate.imageIssues });
          return candidate.kind === 'violations'
            ? 'ERREUR: images interdites par la politique du serveur — écriture REFUSÉE (rien n a été écrit) :\n'
              + candidate.imageIssues.join('\n')
              + '\nCorrige ce fichier et écris-le ENTIÈREMENT conforme avec create_file.'
            : 'ERREUR: inspection des images impossible — écriture REFUSÉE par précaution (fail-closed). '
              + candidate.imageIssues.join(' ');
        }
      }
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
  '- Images (CONTRÔLE SERVEUR RÉEL après écriture des fichiers, avant chaque build) : n’invente jamais d’URL de mémoire (ni loremflickr, en panne). Photos à sujet = UNIQUEMENT les IDs vérifiés du RÉSERVOIR du brief sectoriel ci-joint, sinon fallback https://picsum.photos/seed/<mot>/800/520 thématique. Le serveur inspecte chaque référence d’image (img src, srcset, url(…), classes Tailwind bg-[url(...)]). Une URL interdite provoque un RETOUR AUTOMATIQUE INDIQUANT fichier/ligne/référence pour correction (UNE seule tentative) ; si une URL interdite persiste, la génération est REFUSÉE (ok:false, aucun bundle publié). Admis : IDs vérifiés ci-joint, https://picsum.photos/..., data:image/..., références locales relatives (./assets/..., /api/.../images/...).',
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

// ============================================================================
// P1-B — politique d'images des apps React, au niveau du générateur.
// Les contenus inspectés sont TOUJOURS relus sur disque (workspace) : ce sont
// exactement ceux que buildApp consomme pour produire le bundle servi.
// ============================================================================

/** Sources inspectables du workspace (cellules du bundle ; sources du FileStore exclues). */
function collectWorkspaceSources(projectId: string): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  for (const f of listAppFiles(projectId)) {
    if (!isInspectableAppFile(f.path)) continue;
    const content = readAppFile(projectId, f.path);
    if (content !== null && content.length > 0) out.push({ path: f.path, content });
  }
  return out;
}

function inspectWorkspaceAppImages(projectId: string): AppImageInspection {
  return inspectAppImageSources(collectWorkspaceSources(projectId), { adoptedIds: adoptedImageIds() });
}

/**
 * Rond de correction assistée P1-B : violations exactes (fichier, ligne,
 * référence, motif) nourries au LLM, avec le rappel de la procédure autorisée.
 */
function imageRepairPrompt(
  inspection: AppImageInspection,
  unresolvedRefusals: ReadonlyArray<{ path: string; issues: readonly string[] }> = []
): string {
  // PATCH L2 — une écriture candidate refusée n'apparaît PAS dans
  // l'inspection du workspace (elle n'a jamais été écrite). La liste des
  // refus non résolus est injectée dans le prompt de correction, au format
  // du checker (fichier, ligne, référence, motif).
  const refusedSection = unresolvedRefusals.length > 0
    ? '\n\nÉcritures REFUSÉES AVANT enregistrement (aucune trace écrite — proposer un contenu INTÉGRALEMENT conforme) :'
      + '\n' + unresolvedRefusals.map((r) => r.path + ' :\n' + r.issues.join('\n')).join('\n---\n')
    : '';
  return 'Le serveur a trouvé des références d\'images interdites ; la génération ne sera pas publiée tant qu\'elles existent.'
    + '\n\n' + formatImageViolations(inspection).join('\n')
    + refusedSection
    + '\n\nCorrige CHAQUE fichier cité avec create_file (contenu COMPLET) : remplace toute URL interdite par un ID vérifié du RÉSERVOIR sectoriel (faire référence au brief ci-dessous) ou https://picsum.photos/seed/<mot-sujet>/800/520 pour une photo neutre — en gardant TOUT le reste du fichier identique. Un ID Unsplash HORS du réservoir ci-joint compte comme interdit.';
}

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

    // Contrat de thème global (PATCH secteur) : le chemin React générait sans
    // aucune contrainte de secteur ni d'images — même brief que le stream HTML.
    const reactTheme = detectImageTheme(prompt);
    // PATCH PERTINENCE — seed stable pour TOUTE la génération (brief + seams) :
    // rotation déterministe par requestId, jamais aléatoire.
    const themeSeed = poolRotationSeed(requestId);
    const reactSectorAppendix = '\n\n' + buildSectorContract(reactTheme, 'create')
      + '\n\n' + buildImageBrief(reactTheme, 'create', themeSeed);
    logger.info('Contrat de thème (générateur React)', {
      component: 'app-generator',
      tenantId: context.tenantId,
      projectId,
      imageTheme: reactTheme,
      requestId
    });

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

    // PATCH L2 (B1/B3) — comptabilité des écritures de la génération :
    // chaque fichier écrit avec succès ('file') et chaque écriture candidate
    // REFUSÉE par la barrière L2 sont horodatés (seq monotone). À la décision
    // de publication, un refus dont le fichier n'a PAS été réécrit avec
    // succès ensuite est « non résolu » : il bloque la publication avec la
    // forme de refus P1-B existante (aucun build, done ok:false, imageIssues
    // + imageWriteRefusals additifs). Les refus résolus en boucle (l'LLM
    // réécrit conforme) ne changent pas le droit de publication.
    let writeSeq = 0;
    const okWrites: Array<{ seq: number; path: string }> = [];
    const refusedWrites: Array<{ seq: number; path: string; kind: 'violations' | 'inspection-error'; issues: string[] }> = [];
    const emit = (data: Record<string, unknown>): void => {
      if (data.type === 'file' && typeof data.path === 'string') {
        writeSeq += 1;
        okWrites.push({ seq: writeSeq, path: data.path });
      }
      send(data);
    };
    const gateHooks = {
      imageTheme: reactTheme,
      imageRotationSeed: themeSeed,
      onImageWriteRefusal: (entry: { path: string; kind: 'violations' | 'inspection-error'; issues: readonly string[] }): void => {
        writeSeq += 1;
        refusedWrites.push({ seq: writeSeq, path: entry.path, kind: entry.kind, issues: [...entry.issues] });
        logger.warn('Génération : écriture candidate refusée par la barrière d images (avant écriture)', {
          component: 'app-generator',
          tenantId: context.tenantId,
          projectId,
          path: entry.path,
          kind: entry.kind,
          requestId
        });
      }
    };
    /** Refus L2 jamais suivis d'une réécriture réussie du même chemin. */
    const pendingImageRefusals = (): Array<{ path: string; kind: 'violations' | 'inspection-error'; issues: string[] }> =>
      refusedWrites.filter((r) => !okWrites.some((w) => w.path === r.path && w.seq > r.seq));
    /** Champ additif du done : traçabilité de TOUTES les écritures refusées. */
    const refusalDoneEntries = (): Array<{ path: string; kind: string; issues: string[] }> =>
      refusedWrites.map((r) => ({ path: r.path, kind: r.kind, issues: r.issues }));

    // Site frais : le workspace est reconstruit depuis le template.
    ensureWorkspace(projectId, true);
    setProjectFormat(projectId, 'react-vite');
    send({ type: 'start' });

    const adapter = aiProviderRegistry.resolve({
      // LOT MULTI-MODÈLES — fournisseur actif du tableau de bord (ON/OFF) ;
      // sans sélection → héritage exact : mistral si clé présente.
      preferredProviderId: preferredAiProvider() ?? (process.env.MISTRAL_API_KEY ? 'mistral' : undefined)
    });
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
          systemPrompt: withProjectDesignContext(GENERATION_SYSTEM_PROMPT + reactSectorAppendix, { tenantId: context.tenantId, projectId }),
          temperature: 0.3,
          maxTokens: 8192,
          timeoutMs: 120000,
          requestId
        },
        toolsFor(context.tenantId, projectId, emit),
        { handlers: handlersFor(context.tenantId, projectId, emit, gateHooks), maxIterations: 12, maxToolResultLength: 2000, signal: aborter.signal },
        credentials
      );
      send({ type: 'generation-done', iterations: gen.iterations, toolCalls: gen.trace.length });

      // P1-B — CONTRÔLE IMAGES AVANT PUBLICATION : inspection des sources
      // réelles (disque). PATCH L2 — une écriture candidate refusée n'a
      // laissé AUCUN contenu dangereux sur disque ; un refus « non résolu »
      // (le fichier refusé n'a jamais été réécrit avec succès ensuite)
      // déclenche donc le MÊME round de correction assistée puis le MÊME
      // refus qu'une violation persistante : aucun build, le bundle
      // précédent (éventuel) reste servi, la génération n'est PAS déclarée
      // réussie (ok:false + imageIssues + imageWriteRefusals additifs).
      let inspection = inspectWorkspaceAppImages(projectId);
      let pending = pendingImageRefusals();
      if (inspection.violations.length > 0 || pending.length > 0) {
        send({ type: 'repair', round: 1, reason: 'images' });
        await runToolLoop(
          adapter,
          {
            tenantId: context.tenantId,
            projectId,
            prompt: imageRepairPrompt(inspection, pending),
            systemPrompt: withProjectDesignContext(GENERATION_SYSTEM_PROMPT + reactSectorAppendix, { tenantId: context.tenantId, projectId }),
            temperature: 0.2,
            maxTokens: 8192,
            timeoutMs: 120000,
            requestId
          },
          toolsFor(context.tenantId, projectId, emit),
          { handlers: handlersFor(context.tenantId, projectId, emit, gateHooks), maxIterations: 8, maxToolResultLength: 2000, signal: aborter.signal },
          credentials
        );
        inspection = inspectWorkspaceAppImages(projectId);
        pending = pendingImageRefusals();
        if (inspection.violations.length > 0 || pending.length > 0) {
          const issues = formatImageViolations(inspection);
          const refusalIssues = pending.flatMap((r) => r.issues);
          logger.warn('Génération NON PUBLIÉE — URLs d\'images interdites persistantes', {
            component: 'app-generator',
            tenantId: context.tenantId,
            projectId,
            violations: issues,
            refusals: pending.map((r) => ({ path: r.path, kind: r.kind })),
            requestId
          });
          send({ type: 'error', error: ('Images interdites persistantes après la tentative de correction — génération NON publiée. ' + (issues[0] ?? refusalIssues[0] ?? '')).slice(0, 400) });
          send({
            type: 'done',
            ok: false,
            buildId: '',
            files: listAppFiles(projectId).map((f) => f.path),
            durationMs: 0,
            imageIssues: issues.length > 0 ? issues : [...new Set(refusalIssues)],
            ...(refusedWrites.length > 0 ? { imageWriteRefusals: refusalDoneEntries() } : {})
          });
          res.end();
          return true;
        }
      }

      // P2 — build + auto-réparation bornée (les erreurs compilateur
      // repartent à l'IA qui corrige les fichiers).
      let build = await buildApp(projectId);
      send({ type: build.ok ? 'build-ok' : 'build-error', durationMs: build.durationMs, errors: build.errors.slice(0, 4) });
      let repairRounds = 0;
      while (!build.ok && repairRounds < 3 && !clientGone) {
        repairRounds += 1;
        send({ type: 'repair', round: repairRounds, reason: 'compilation' });
        // P1-B — si des violations d'images existent à ce stade, elles partent
        // AUSSI dans le prompt de correction de compilation et la réinspection
        // OBLIGATOIRE bloque tout build sur des sources non conformes
        // (aucune réécriture serveur : le LLM corrige avec le brief).
        const roundIssues = formatImageViolations(inspectWorkspaceAppImages(projectId));
        const fixPrompt = 'Le build TypeScript/Vite du projet échoue avec ces erreurs :\n\n' + build.errors.join('\n---\n').slice(0, 3000)
          + (roundIssues.length > 0
            ? '\n\nViolations d\'images à corriger en même temps (URLs interdites par la politique du serveur — remplace par un ID vérifié du RÉSERVOIR sectoriel) :\n' + roundIssues.join('\n')
            : '')
          + '\n\nCorrige les fichiers nécessaires avec create_file (contenu COMPLET des fichiers corrigés). Ne touche à rien d\'autre.';
        await runToolLoop(
          adapter,
          {
            tenantId: context.tenantId,
            projectId,
            prompt: fixPrompt,
            systemPrompt: withProjectDesignContext(GENERATION_SYSTEM_PROMPT, { tenantId: context.tenantId, projectId }),
            temperature: 0.2,
            maxTokens: 8192,
            timeoutMs: 120000,
            requestId
          },
          toolsFor(context.tenantId, projectId, emit),
          { handlers: handlersFor(context.tenantId, projectId, emit, gateHooks), maxIterations: 8, maxToolResultLength: 2000, signal: aborter.signal },
          credentials
        );
        inspection = inspectWorkspaceAppImages(projectId);
        pending = pendingImageRefusals();
        if (inspection.violations.length > 0 || pending.length > 0) {
          const issues = formatImageViolations(inspection);
          const refusalIssues = pending.flatMap((r) => r.issues);
          logger.warn('Publication refusée — la correction de compilation a réintroduit des URLs interdites', {
            component: 'app-generator',
            tenantId: context.tenantId,
            projectId,
            violations: issues,
            refusals: pending.map((r) => ({ path: r.path, kind: r.kind })),
            requestId
          });
          send({ type: 'error', error: ('Images interdites persistantes après correction de compilation — génération NON publiée. ' + (issues[0] ?? refusalIssues[0] ?? '')).slice(0, 400) });
          send({
            type: 'done',
            ok: false,
            buildId: '',
            files: listAppFiles(projectId).map((f) => f.path),
            durationMs: 0,
            imageIssues: issues.length > 0 ? issues : [...new Set(refusalIssues)],
            ...(refusedWrites.length > 0 ? { imageWriteRefusals: refusalDoneEntries() } : {})
          });
          res.end();
          return true;
        }
        build = await buildApp(projectId);
        send({ type: build.ok ? 'build-ok' : 'build-error', durationMs: build.durationMs, errors: build.errors.slice(0, 4), round: repairRounds });
      }

      const files = listAppFiles(projectId);
      // P1-B — done : ok reflète le build ET la conforme images : chaque
      // buildApp ci-dessus était immédiatement précédé d'une inspection propre,
      // donc le bundle publié ne contient jamais d'URL interdite.
      // PATCH L2 — champ ADDITIF du contrat done : les écritures candidates
      // refusées (y compris résolues en boucle) sont listées pour l'appelant ;
      // AUCUN nouveau type d'événement SSE n'est introduit.
      send({
        type: 'done',
        ok: build.ok,
        buildId: build.buildId,
        files: files.map((f) => f.path),
        durationMs: build.durationMs,
        ...(refusedWrites.length > 0 ? { imageWriteRefusals: refusalDoneEntries() } : {})
      });
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
    // PV-02/PV-19 + LOT S3 (audit sécurité 04/11) — lecture SEULE : jamais de
    // matérialisation pour un inconnu (fini la copie template sur ids
    // arbitraires sans jeton). La vérification tenant+projet est EXIGÉE sur
    // toute reconnaissance d'un projet existant : sans elle, un tenant sans
    // aucun autre accès pouvait énumérer proj_* cross-tenant et lire le bundle.
    // Les requêtes non authentifiées (navigations iframe intégré : contexte défaut)
    // tombent dans throw NotFoundError — indiscernable d'un projet absent.
    // Firestore isolation : getProject(tenantId, rawId) reproduit la check
    // multi-tenant de `projectStore`.
    const projectForBundle = projectStore.getProject(context.tenantId, rawId);
    if (!projectForBundle) {
      throw new NotFoundError(`Projet ${rawId}`, requestId);
    }
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
