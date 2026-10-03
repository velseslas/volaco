/**
 * VibeCode Core - API Tier
 * Conversation Routes — expose enfin le moteur conversationnel
 * (ConversationIntelligenceService / agent-runtime) via l'API HTTP.
 *
 * Jusqu'ici, ce moteur existait, était testé, mais n'était relié à aucune
 * route : impossible pour un utilisateur de "discuter" avec Volaco pour de
 * vrai. Ces routes le rendent accessible.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ConversationIntelligenceService } from '../../../../packages/core/src/ai-native/conversation-intelligence/service.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { NotFoundError, ValidationError } from '../../../../packages/core/src/errors.js';
import { projectStore } from '../../../../packages/core/src/identity/project.js';
import { fileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { revisionStore } from '../../../../packages/core/src/model/revision-store.js';
import { analyzeProjectVisual } from './visual.js';
import { aiProviderRegistry } from '../../../../packages/core/src/ai/providers/registry.js';
import { logger } from '../../../../packages/core/src/logger.js';
import type { EngineeringPlan, IntentResult } from '../../../../packages/core/src/ai-native/conversation-intelligence/types.js';
import { PlanGenerator } from '../../../../packages/core/src/ai-native/conversation-intelligence/engine/plan-generator.js';
import { executionStore, activeCancelFlags } from '../../../../packages/core/src/ai-native/execution/store.js';
import { ExecutionRecorder, type RecordableEvent } from '../../../../packages/core/src/ai-native/execution/recorder.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';
import { setProjectFormat } from '../../../../packages/core/src/app-pipeline.js';
import { classifyIntent } from '../../../../packages/core/src/ai-native/conversation-intelligence/engine/intent-engine.js';
/**
 * Instance unique du service de conversation pour tout le serveur.
 * Le moteur IA réel (Gemini/Mistral) ou le simulateur (Mock, avec avertissement)
 * lui est injecté au démarrage du serveur — voir server.ts.
 */
export let conversationIntelligenceService = new ConversationIntelligenceService();

/**
 * Permet à server.ts de remplacer l'instance par défaut par une instance
 * correctement câblée avec le vrai moteur d'exécution (agent-runtime + IA réelle).
 */
export function configureConversationIntelligenceService(service: ConversationIntelligenceService): void {
  conversationIntelligenceService = service;
}

// LOT 4 — Plan First (§17 CDC) : génération déterministe d'un plan d'ingénierie
// affiché dans le chat, sans appel LLM supplémentaire.
const planGenerator = new PlanGenerator();

/**
 * EXECUTION TRANSPARENCY (CDC Transparency Engine) : chaque génération produit
 * des événements typés persistés (executionId = requestId). Feature flag :
 * `VOLACO_EXECUTION_TIMELINE=off` restaure le comportement d'avant (frames nues,
 * aucune persistance) en cas de besoin de rollback instantané.
 */
const executionTimelineEnabled = process.env.VOLACO_EXECUTION_TIMELINE !== 'off';

/**
 * AUDIT PREVIEW — déduplication des blocs data-section : les générations
 * antérieures à la garde d'unicité ont pu accumuler des doublons
 * (footer ×3, header ×2 constatés en production). À chaque sauvegarde, la
 * dernière occurrence de chaque nom gagne — le fichier s'assainit tout seul.
 */
export function dedupeSectionBlocks(html: string): string {
  const re = /<div[^>]*data-section="([^"]+)"[^>]*>[\s\S]*?(?=<div[^>]*data-section|<\/body>|$)/g;
  const blocks: Array<{ name: string; block: string; start: number; end: number }> = [];
  for (const m of html.matchAll(re)) {
    blocks.push({ name: (m[1] || '').toLowerCase(), block: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  if (blocks.length === 0) return html;
  const lastByName = new Map<string, { start: number; end: number }>();
  for (const b of blocks) lastByName.set(b.name, { start: b.start, end: b.end });
  let out = '';
  let cursor = 0;
  for (const b of blocks) {
    const keep = lastByName.get(b.name);
    if (keep && keep.start === b.start && keep.end === b.end) {
      out += html.slice(cursor, b.end);
      cursor = b.end;
    } else {
      // doublon évincé : il est sauté (le texte qui le précède reste)
      out += html.slice(cursor, b.start);
      cursor = b.end;
    }
  }
  out += html.slice(cursor);
  return out;
}

/**
 * T7 (CDC §24-§25) — synthèse finale de l'exécution, construite UNIQUEMENT
 * à partir de mesures réelles : comptes de sections, delta de lignes,
 * score du gate s'il a tourné, durée mesurée. Aucun chiffre inventé.
 */
export function buildFinalSynthesis(input: {
  sections: Array<{ name: string; mode: string }>;
  sectionDiffs: Array<{ added: number; removed: number }>;
  gateScore: number | null;
  durationSec: number;
}): string {
  const created = input.sections.filter((s) => s.mode === 'create' || s.mode === 'add').length;
  const modified = input.sections.filter((s) => s.mode === 'modify').length;
  const deleted = input.sections.filter((s) => s.mode === 'delete').length;
  const added = input.sectionDiffs.reduce((acc, d) => acc + d.added, 0);
  const removed = input.sectionDiffs.reduce((acc, d) => acc + d.removed, 0);
  const bits: string[] = [];
  const actions: string[] = [];
  if (created) actions.push(`${created} section${created > 1 ? 's' : ''} construite${created > 1 ? 's' : ''}`);
  if (modified) actions.push(`${modified} modifiée${modified > 1 ? 's' : ''}`);
  if (deleted) actions.push(`${deleted} supprimée${deleted > 1 ? 's' : ''}`);
  bits.push(actions.length ? actions.join(' · ') : 'page assemblée');
  if (added || removed) bits.push(`+${added} −${removed} lignes`);
  if (input.gateScore !== null) bits.push(`Quality Gate ${input.gateScore}/100`);
  bits.push(`${Math.max(1, input.durationSec)}s`);
  return bits.join(' · ');
}

/**
 * Classification d'intention déterministe (mêmes heuristiques que la route
 * /decide) — utilisée quand aucun intent classifié n'est fourni au flux.
 */
function buildStreamFallbackIntent(message: string): IntentResult {
  const lower = (message || '').toLowerCase();
  let category: IntentResult['category'] = 'UNKNOWN';
  if (/\b(crée|ajoute|génère|créer|générer|add|create)\b/.test(lower)) category = 'CREATE';
  else if (/\b(modifie|change|édite|update|modify)\b/.test(lower)) category = 'MODIFY';
  else if (/\b(supprime|efface|delete|remove)\b/.test(lower)) category = 'DELETE';
  else if (/\b(refactor|nettoy|clean)\b/.test(lower)) category = 'REFACTOR';
  else if (/\b(debug|corrig|fix)\b/.test(lower)) category = 'DEBUG';
  else if (/\b(analy|audit)\b/.test(lower)) category = 'ANALYZE';
  return {
    category,
    goal: (message || '').slice(0, 200),
    requestedAction: message || '',
    entities: [],
    constraints: [],
    urgency: 'NORMAL',
    confidence: 0.5,
    ambiguities: []
  };
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

/**
 * T4 (CDC §11) — delta réel de lignes entre deux textes : diff multiset par
 * ligne (ajouts = lignes de `after` absentes de `before`, et inversement).
 * Déterministe, sans dépendance — jamais de faux chiffres affichés.
 */
export function countLineDelta(beforeText: string, afterText: string): { added: number; removed: number } {
  const count = (text: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (const line of text.split('\n')) {
      const key = line.trim();
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  };
  const before = count(beforeText || '');
  const after = count(afterText || '');
  let added = 0;
  let removed = 0;
  const keys = new Set<string>([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    const b = before.get(key) || 0;
    const a = after.get(key) || 0;
    if (a > b) added += a - b;
    else if (b > a) removed += b - a;
  }
  return { added, removed };
}

async function parseJsonBody<T>(req: IncomingMessage, requestId: string): Promise<T> {
  const bodyText = await readBody(req);
  if (!bodyText || bodyText.trim().length === 0) {
    return {} as T;
  }
  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
  }
}

function extractHtmlBlock(text: string): string | null {
  const match = text.match(/```(?:html)?([\s\S]*?)```/i);
  const candidate = (match && match[1] ? match[1] : text).trim();
  return candidate.length > 100 ? candidate : null;
}

/**
 * Enveloppe des sections générées dans un document HTML complet, aligné avec
 * le buildHtmlDoc du Studio (Tailwind CDN, polices, fond sombre). Un document
 * complet dans fileStore garantit : éditeur lisible, /render/preview fidèle
 * et contexte correct pour les tours de modification suivants.
 */
/**
 * ÉTAPE narration ancrée (effet waw — §14 CDC) : un résumé COMPACT du contenu
 * RÉEL de la page (titre, sections, titres visibles, boutons, couleurs) injecté
 * dans le prompt. L'IA ne parle plus de « la page » en général : elle commente
 * les VRAIS titres et les VRAIES couleurs de l'utilisateur. Déterministe.
 */
export function buildPageContext(currentHtml: string): string {
  if (!currentHtml || currentHtml.length < 100) return '';
  const parts: string[] = [];
  const title = (currentHtml.match(/<title>([^<]{1,80})<\/title>/i) || [])[1];
  if (title) parts.push('- Titre de la page : ' + title.trim());
  const sections = [...currentHtml.matchAll(/data-section="([^"]{1,40})"/g)].map((m) => m[1]);
  if (sections.length) parts.push('- Sections existantes : ' + [...new Set(sections)].slice(0, 12).join(', '));
  const headings = [...currentHtml.matchAll(/<h[12][^>]*>([^<]{2,60})<\/h[12]>/gi)].map((m) => (m[1] as string).trim()).slice(0, 6);
  if (headings.length) parts.push('- Titres visibles : ' + headings.join(' | '));
  const buttons = [...currentHtml.matchAll(/<button[^>]*>\s*([^<]{1,40})\s*<\/button>/gi)].map((m) => (m[1] as string).trim()).slice(0, 8);
  if (buttons.length) parts.push('- Boutons : ' + buttons.join(' | '));
  const colors = [...new Set((currentHtml.match(/#[0-9a-fA-F]{6}\b/g) || []).map((c) => c.toLowerCase()))].slice(0, 8);
  if (colors.length) parts.push('- Couleurs utilisées : ' + colors.join(', '));
  if (parts.length === 0) return '';
  return '\n\nCONTEXTE RÉEL DE LA PAGE ACTUELLE (parle de ces éléments avec tes mots, tutoiement) :\n' + parts.join('\n');
}

export function buildStudioShell(sectionsHtml: string): string {
  return `<!DOCTYPE html>
<html lang="fr" class="dark scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VibeCode Studio</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; background-color: #070913; color: #f1f5f9; margin: 0; }
    @keyframes shimmer { 0% { background-position: -1000px 0; } 100% { background-position: 1000px 0; } }
    .vibe-skeleton { background: linear-gradient(90deg, rgba(30,41,59,.5) 0%, rgba(51,65,85,.8) 50%, rgba(30,41,59,.5) 100%); background-size: 1000px 100%; animation: shimmer 1.5s infinite linear; border-radius: 8px; }
    @keyframes stitchReveal { 0% { opacity: 0; transform: translateY(8px); filter: blur(4px); } 50% { opacity: 0.8; filter: blur(2px); } 100% { opacity: 1; transform: translateY(0); filter: blur(0); } }
    .vibe-stitched { animation: stitchReveal 0.6s ease-out forwards; }
  </style>
</head>
<body>
${sectionsHtml}
</body>
</html>`;
}

/**
 * Étape qui manquait jusqu'ici : une fois le plan approuvé et "exécuté" par le
 * moteur conversationnel (agent-runtime), rien n'écrivait vraiment le nouveau
 * contenu dans le fichier du projet. Cette fonction fait ce travail concret :
 * elle redemande à l'IA le code HTML complet mis à jour, en tenant compte du
 * plan approuvé et du fichier actuel, puis l'enregistre réellement via
 * fileStore (la même persistance sur disque que le reste du projet).
 */
async function regenerateFileForPlan(
  tenantId: string,
  projectId: string,
  plan: EngineeringPlan,
  userMessage: string,
  entryFile = 'index.html',
  clientApiKey?: string | undefined
): Promise<{ updated: boolean; content?: string; error?: string }> {
  // Corrige un bug réel trouvé en testant : sans préférence explicite, le
  // registre pouvait choisir un fournisseur qui n'a pas de clé configurée
  // (ex: Gemini) plutôt que celui que l'utilisateur a réellement configuré
  // (ex: Mistral). On préfère explicitement celui dont la clé d'environnement
  // est présente.
  const preferredProviderId = process.env.MISTRAL_API_KEY
    ? 'mistral'
    : process.env.GEMINI_API_KEY
      ? 'gemini'
      : undefined;
  const adapter = aiProviderRegistry.resolve(preferredProviderId ? { preferredProviderId } : {});
  if (!adapter) {
    return { updated: false, error: "Aucun fournisseur IA réel (Gemini/Mistral) n'est disponible côté serveur." };
  }

  const existing = fileStore.getFile(tenantId, projectId, entryFile);
  const currentHtml = existing?.content || '';
  const isModification = currentHtml.trim().length > 200;

  const systemPrompt = isModification
    ? "Tu es le Lead Ingénieur IA de VibeCode Studio. Tu dois MODIFIER l'application web existante selon le plan d'ingénierie approuvé et la demande de l'utilisateur.\n\n" +
      "CONSIGNES ABSOLUES :\n" +
      "1. Base-toi fidèlement sur le code HTML complet actuel fourni.\n" +
      "2. Si la demande porte sur l'apparence (couleurs, thème, palette, style), applique VRAIMENT ce changement.\n" +
      "3. Réponds UNIQUEMENT avec le code HTML complet mis à jour dans un bloc ```html ... ```, sans aucune explication."
    : "Tu es le Lead Designer UI/UX et Ingénieur IA principal de VibeCode Studio. Conçois une application web complète, moderne et interactive avec Tailwind CSS.\n" +
      "Réponds UNIQUEMENT avec le code HTML complet dans un bloc ```html ... ```, sans explication.";

  const userPrompt = isModification
    ? `Voici le code HTML actuel de l'application :\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nPlan d'ingénierie approuvé : ${plan.summary}\n\nDemande initiale de l'utilisateur : ${userMessage}`
    : `Génère l'application complète suivante : ${userMessage}`;

  const credentials = clientApiKey
    ? { tenantId, providerId: adapter.descriptor.providerId, apiKey: clientApiKey }
    : aiProviderRegistry.getTenantCredentials(tenantId, adapter.descriptor.providerId);

  try {
    const response = await adapter.generate(
      { tenantId, projectId, prompt: userPrompt, systemPrompt, temperature: 0.2, maxTokens: 8192 },
      credentials
    );
    const html = extractHtmlBlock(response.text);
    if (!html) {
      return { updated: false, error: "La réponse de l'IA ne contenait pas de code HTML exploitable." };
    }
    if (isModification && html.trim() === currentHtml.trim()) {
      return { updated: false, error: 'Aucun changement détecté : le code généré est identique au code actuel.' };
    }
    // Cohérence avec le flux streaming : si l'IA renvoie des fragments, on les
    // enveloppe dans le shell complet avant sauvegarde et renvoi au client.
    const finalHtml = /<!DOCTYPE|<html[\s>]/i.test(html) ? html : buildStudioShell(html);
    fileStore.saveFile(tenantId, projectId, entryFile, finalHtml);
    return { updated: true, content: finalHtml };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Échec de la régénération réelle du fichier après exécution du plan", {
      component: 'conversation-route',
      tenantId,
      projectId,
      error: message
    });
    return { updated: false, error: message };
  }
}

export async function handleConversationRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  const prefix = '/api/v1/projects/';
  if (!pathname.startsWith(prefix) || !pathname.includes('/conversation')) {
    return false;
  }

  const afterPrefix = pathname.substring(prefix.length);
  const parts = afterPrefix.split('/');
  const projectId = parts[0];
  const subRoute = parts[1]; // 'conversation'
  const subResource = parts[2]; // 'sessions'
  const sessionId = parts[3];
  const action = parts[4]; // 'turns' | 'confirm' | 'execute'

  if (!projectId || subRoute !== 'conversation' || subResource !== 'sessions') {
    return false;
  }

  const project = projectStore.getProject(context.tenantId, projectId);
  if (!project) {
    throw new NotFoundError(`Projet ${projectId}`, requestId);
  }

  // POST /api/v1/projects/:projectId/conversation/sessions -> créer une session
  if (!sessionId && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const session = conversationIntelligenceService.createSession(
      { tenantId: context.tenantId, projectId },
      context.role,
      requestId
    );
    sendJson(res, 201, { session, requestId });
    return true;
  }

  // GET /api/v1/projects/:projectId/conversation/memory -> mémoire projet réelle (ÉTAPE 5)
  if (sessionId === 'memory' && !action && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const memory = conversationIntelligenceService.getLatestProjectMemory(context.tenantId, projectId, context.role, requestId);
    if (!memory) {
      sendJson(res, 404, { message: 'Aucune mémoire de conversation pour ce projet (aucune session enregistrée).', requestId });
      return true;
    }
    sendJson(res, 200, { memory, requestId });
    return true;
  }

  // GET /api/v1/projects/:projectId/conversation/sessions/:sessionId -> lire une session
  if (sessionId && !action && req.method === 'GET') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const session = conversationIntelligenceService.getSession(context.tenantId, projectId, sessionId, context.role, requestId);
    if (!session) {
      throw new NotFoundError(`Session de conversation ${sessionId}`, requestId);
    }
    sendJson(res, 200, { session, requestId });
    return true;
  }

  // POST /api/v1/projects/:projectId/conversation/sessions/:sessionId/turns -> envoyer un message
  if (sessionId && action === 'turns' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const body = await parseJsonBody<{ message?: string; autoConfirmLowRisk?: boolean }>(req, requestId);
    if (!body.message) {
      throw new ValidationError('Le champ "message" est obligatoire', undefined, requestId);
    }
    const result = await conversationIntelligenceService.processTurn(
      {
        tenantId: context.tenantId,
        projectId,
        sessionId,
        message: body.message,
        autoConfirmLowRisk: body.autoConfirmLowRisk
      },
      context.role,
      requestId
    );
    sendJson(res, 200, { ...result, requestId });
    return true;
  }

  // POST /api/v1/projects/:projectId/conversation/sessions/:sessionId/confirm -> approuver/rejeter un plan
  if (sessionId && action === 'confirm' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const body = await parseJsonBody<{ planId?: string; approved?: boolean }>(req, requestId);
    if (!body.planId || typeof body.approved !== 'boolean') {
      throw new ValidationError('Les champs "planId" et "approved" sont obligatoires', undefined, requestId);
    }
    const session = await conversationIntelligenceService.confirmPlan(
      { tenantId: context.tenantId, projectId, sessionId, planId: body.planId, approved: body.approved },
      context.role,
      requestId
    );
    sendJson(res, 200, { session, requestId });
    return true;
  }

  // POST /api/v1/projects/:projectId/conversation/sessions/:sessionId/execute -> exécuter le plan approuvé
  if (sessionId && action === 'execute' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const body = await parseJsonBody<{ entryFile?: string }>(req, requestId);

    const result = await conversationIntelligenceService.executeApprovedPlan(
      { tenantId: context.tenantId, projectId, sessionId },
      context.role,
      requestId
    );

    // Étape concrète qui manquait : régénérer et enregistrer réellement le
    // fichier du projet, pas seulement marquer le plan comme "exécuté".
    // Renforcé après un signalement utilisateur : fileUpdate doit TOUJOURS
    // contenir un message précis, jamais rester vide ni tomber sur un texte
    // générique côté client qui masquerait la vraie cause.
    let fileUpdate: { updated: boolean; content?: string; error?: string };
    try {
      if (!result.executionResult.success) {
        fileUpdate = {
          updated: false,
          error: `L'exécution du plan par le moteur conversationnel a échoué : ${result.executionResult.message || 'raison inconnue'}`
        };
      } else if (!result.session.activePlan) {
        fileUpdate = {
          updated: false,
          error: "Aucun plan actif trouvé sur la session au moment de la régénération (le plan a peut-être déjà été traité ou la session a expiré)."
        };
      } else {
        const lastTurn = result.session.turns[result.session.turns.length - 1];
        const userMessage = lastTurn?.userMessage.content || result.session.activePlan.summary;
        const clientApiKeyHeader = req.headers['x-mistral-api-key'];
        const clientApiKey = typeof clientApiKeyHeader === 'string' && clientApiKeyHeader.trim().length > 0
          ? clientApiKeyHeader.trim()
          : undefined;
        fileUpdate = await regenerateFileForPlan(
          context.tenantId,
          projectId,
          result.session.activePlan,
          userMessage,
          body.entryFile || 'index.html',
          clientApiKey
        );
      }
    } catch (error) {
      // Filet de sécurité absolu : même une erreur totalement inattendue ici
      // (jamais anticipée) doit produire un message exploitable plutôt que de
      // faire planter la requête ou de laisser fileUpdate vide.
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("Erreur inattendue lors de la régénération après exécution du plan", {
        component: 'conversation-route',
        tenantId: context.tenantId,
        projectId,
        error: message
      });
      fileUpdate = { updated: false, error: `Erreur inattendue côté serveur : ${message}` };
    }

    sendJson(res, 200, { ...result, fileUpdate, requestId });
    return true;
  }

  // =====================================================================
  // STREAMING — POST /api/v1/projects/:id/conversation/sessions/:sid/stream
  // ---------------------------------------------------------------------
  // Variante streaming de /turns. Au lieu de retourner un JSON synchrone
  // après 5-13s d'attente, on ouvre une connexion SSE (Server-Sent Events)
  // et on stream les tokens du LLM Mistral en temps réel vers le Studio.
  //
  // Le Studio boucle sur les events SSE et affiche les tokens au fur et à
  // mesure dans le chat (effet machine à écrire, comme Cursor / v0).
  //
  // À la fin, le serveur extrait le bloc ```html``` du texte complet, le
  // sauvegarde via fileStore, et envoie un event final avec le HTML.
  // =====================================================================
  if (sessionId && action === 'stream' && req.method === 'POST') {
    assertPermission(context.role, 'PROJECT_READ', requestId);
    const body = await parseJsonBody<{ message?: string; isModification?: boolean; planFirst?: boolean; confirmedPlan?: boolean }>(req, requestId);
    if (!body.message) {
      throw new ValidationError('Le champ "message" est obligatoire', undefined, requestId);
    }

    // Headers SSE
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Désactive buffering nginx

    // Déconnexion client : si l'utilisateur ferme l'onglet ou annule, on coupe
    // la consommation du stream LLM (sinon on continue de facturer des tokens
    // jusqu'à 120 s pour un socket mort) et on cesse d'écrire sur la réponse.
    let clientGone = false;
    req.on('close', () => { clientGone = true; });

    // Fonction helper pour envoyer un event SSE formaté
    const sendSSE = (data: Record<string, unknown>): void => {
      if (clientGone) return;
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Récupère le projet + fichier existant pour déterminer si modif ou création
    const existing = fileStore.getFile(context.tenantId, projectId, 'index.html');
    const currentHtml = existing?.content || '';
    const isModification = body.isModification ?? (currentHtml.trim().length > 200);

    // EXECUTION TRANSPARENCY : une exécution = un requestId. Toutes les frames
    // « milestone » passent par `emit` (enrichies executionId/seq/phase/status)
    // et les événements correspondants sont persistés dans executionStore.
    const executionId = requestId;
    let recorder: ExecutionRecorder | null = null;
    // Durée réelle de l'exécution (CDC §26 : jamais de durée inventée)
    const streamStartedAt = Date.now();
    // T5 (CDC §20) — annulation utilisateur réelle : la route cancel retourne
    // ce drapeau ; la boucle LLM le vérifie à chaque chunk et s'arrête net.
    const cancelFlag = { cancelled: false };
    if (executionTimelineEnabled) {
      executionStore.startExecution({
        executionId,
        tenantId: context.tenantId,
        projectId,
        mode: isModification ? 'modify' : 'create',
        prompt: body.message || ''
      });
      recorder = new ExecutionRecorder(executionStore, executionId, sendSSE);
      activeCancelFlags.set(executionId, cancelFlag);
    }
    /** Frame SSE enrichie ; enregistre l'événement quand il est fourni. */
    const emit = (data: Record<string, unknown>, event?: RecordableEvent): void => {
      if (recorder) recorder.frame(data, event);
      else sendSSE(data);
    };
    /** Événement persisté sans frame SSE dédiée (l'UI le découvrira au replay). */
    const recordOnly = (event: RecordableEvent): void => {
      if (recorder) executionStore.appendEvent(executionId, event);
    };

    emit({ type: 'start', isModification }, {
      type: 'EXECUTION_STARTED',
      phase: 'UNDERSTAND',
      status: 'RUNNING',
      title: isModification ? 'Modification de ta page lancée' : 'Génération lancée',
      detail: { mode: isModification ? 'modify' : 'create' }
    });
    // INSPECT : la lecture réelle du fichier existant est traçable (CDC §9-§10)
    // — ET visible en live dans le flux (frame + activity, LOT E).
    if (currentHtml.trim().length > 0) {
      emit({ type: 'file_read' }, {
        type: 'FILE_READ',
        phase: 'INSPECT',
        status: 'COMPLETED',
        title: 'Lecture de index.html',
        detail: { path: 'index.html', chars: currentHtml.length }
      });
    }
    // LOT 3 — Compass complet (§11 CDC) : les 9 états sont émis au fil du flux
    emit({ type: 'compass', state: 'UNDERSTANDING' });

    // LOT 4 — Plan First (§17 CDC) : un plan déterministe est TOUJOURS émis
    // (traçabilité Understand Before Acting), AVANT la sélection du fournisseur
    // — le plan et la confirmation humaine ne dépendent d'aucune clé LLM.
    // En mode planFirst, le flux s'arrête ici et attend la confirmation (§3.9).
    // P2 — INTENTION RÉELLE : le moteur conversationnel (LLM, temp 0,
    // repli regex intégré) remplace la regex 6 catégories. L'intention
    // détermine le plan affiché et les phrases du LLM.
    const realIntent = await classifyIntent(body.message || '', undefined, context.tenantId, projectId);
    const plan = planGenerator.generatePlan({ intent: realIntent });
    emit({ type: 'plan', plan }, {
      type: 'PLAN_CREATED',
      phase: 'PLAN',
      status: 'COMPLETED',
      title: `Plan créé — ${plan.steps.length} étape(s)`,
      detail: { planId: plan.planId, steps: plan.steps.length }
    });
    // Conversation vivante — narration aux transitions réelles (§14 CDC) :
    // l'IA raconte ce qu'elle fait au moment où elle le fait.
    if (isModification) {
      emit({ type: 'chat', text: `Je modifie ta page en gardant le reste intact : ${plan.steps.length} étape(s). Je m'y mets tout de suite !` });
    } else {
      emit({ type: 'chat', text: `Voici mon plan : ${plan.steps.length} étapes. Je construis ça sous tes yeux, section par section !` });
    }
    if (body.planFirst && !body.confirmedPlan) {
      emit({ type: 'compass', state: 'WAITING_CONFIRMATION' }, {
        type: 'PHASE_CHANGED',
        phase: 'PLAN',
        status: 'WAITING_USER',
        title: 'En attente de ta validation du plan',
        detail: { state: 'WAITING_CONFIRMATION' }
      });
      if (recorder) executionStore.setStatus(executionId, 'WAITING_USER');
      emit({ type: 'done', awaitingConfirmation: true });
      // Sortie anticipée : le finally du stream LLM ne passe pas ici —
      // le drapeau d'annulation doit partir avec l'exécution inactive.
      activeCancelFlags.delete(executionId);
      res.end();
      return true;
    }
    if (body.confirmedPlan) {
      recordOnly({
        type: 'PLAN_APPROVED',
        phase: 'PLAN',
        status: 'COMPLETED',
        title: 'Plan approuvé — je lance la génération'
      });
    }

    // Sélectionne l'adaptateur Mistral (préfère le fournisseur dont la clé est env)
    const preferredProviderId = process.env.MISTRAL_API_KEY ? 'mistral' : process.env.GEMINI_API_KEY ? 'gemini' : undefined;
    const adapter = aiProviderRegistry.resolve(preferredProviderId ? { preferredProviderId } : {});
    if (!adapter || !('generateStream' in adapter)) {
      const providerError = "Aucun fournisseur IA streaming disponible (Mistral requis).";
      emit({ type: 'error', error: providerError });
      if (recorder) executionStore.failExecution(executionId, providerError);
      activeCancelFlags.delete(executionId);
      res.end();
      return true;
    }

    // Détection du mode : CRÉATION vs MODIFICATION
    // E48 — un isModification EXPLICITE du client est RESPECTÉ : « crée un
    // site » alors qu'un fichier existe doit REMPLACER le fichier (site
    // frais), pas fusionner dedans (c'est l'accumulation de sections
    // obsolètes constatée en production). L'heuristique de repli (fichier
    // > 200 caractères → modification) ne s'applique que si le client n'a
    // rien explicité.
    const isModificationMode = body.isModification !== undefined
      ? Boolean(body.isModification)
      : (currentHtml.trim().length > 200);

    // === SYSTÈME PROMPT MODE CRÉATION ===
    // (comportement actuel : génère un site complet section par section)
    const creationSystemPrompt =
      "Tu es le Lead Engineer IA de VibeCode Studio. L'utilisateur te parle en français, tu réponds en français.\n\n" +
      "RÔLE : Tu construis le site EN LIVE devant l'utilisateur, section par section, dans le preview. L'utilisateur doit VOIR le site se construire sous ses yeux — chaque section apparaît l'une après l'autre avec un effet de pulse.\n\n" +
      "NARRATION VIVANTE (très important) : Avant CHAQUE section, raconte en 1-2 phrases chaleureuses et concrètes ce que tu construis et POURQUOI, comme un designer qui parle à son client (ex: « Je pose un header translucide avec le logo à gauche, ça donne tout de suite une impression de pro. » / « Maintenant le hero : une grande image chaleureuse et un gros titre qui claque. »). Utilise le tutoiement, sois naturel, jamais technique.\n\n" +
      "QUALITÉ DESIGN (obligatoire) : utilise de vraies images Unsplash cohérentes avec le thème (https://images.unsplash.com/photo-...), une palette limitée et cohérente, des dégradés subtils, des ombres douces, des hover states sur chaque bouton, une vraie hiérarchie typographique (grands titres, textes lisibles) et un espacement généreux. Le résultat doit avoir l'air conçu par un designer senior.\n\n" +
      "FORMAT OBLIGATOIRE de ta réponse :\n\n" +
      "1. Commence par 1-2 phrases conversationnelles pour annoncer ce que tu vas créer (ambiance, sections prévues)\n" +
      "   Ex: \"Salut ! Je te construis ta landing page pour restaurant italien avec une ambiance terracotta. Je commence par le Header, puis Hero, Menu, Réservation et Footer.\"\n\n" +
      "2. Pour CHAQUE section du site (commence par Header, finis par Footer), écris un bloc au format EXACT suivant :\n\n" +
      "   <SECTION name=\"header\">\n" +
      "   Phrase courte décrivant ce que tu fais (ex: \"Maintenant le Header avec la navigation sticky.\")\n" +
      "   <header>... code HTML de la section ...</header>\n" +
      "   </SECTION>\n\n" +
      "3. Continue ainsi pour chaque section dans l'ordre logique : Header → Hero → Sections contenu → Footer (4-6 sections max)\n\n" +
      "4. Termine par une phrase de conclusion après la dernière section\n" +
      "   Ex: \"Voilà, ta landing page pour Bella Italia est prête ! Tu peux cliquer sur les boutons Réserver pour tester.\"\n\n" +
      "RÈGLES CRITIQUES :\n" +
      "- Utilise TOUJOURS le marqueur <SECTION name=\"nom-court\"> pour délimiter chaque section\n" +
      "- Le name doit être en minuscules avec tirets : \"header\", \"hero\", \"menu\", \"testimonials\", \"pricing\", \"reservation\", \"contact\", \"footer\"\n" +
      "- Le HTML de chaque section doit être COMPLET et AUTONOME (peut être rendu seul dans une page)\n" +
      "- L'ordre des sections est important : Header d'abord, Footer en dernier\n" +
      "- Le texte décrivant chaque section doit être COURT (1 phrase max) et conversationnel (\"Maintenant...\", \"Ensuite...\", \"Je passe à...\", etc.)\n" +
      "- Utilise Tailwind CSS via CDN (https://cdn.tailwindcss.com) dans chaque section qui a besoin de styles\n" +
      "- Dark mode élégant (#070913 ou #0b0f19), cartes glassmorphism (bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl)\n" +
      "- Pour les titres en dégradé : <span class=\"bg-gradient-to-r from-X via-Y to-Z bg-clip-text text-transparent\" style=\"-webkit-background-clip: text; -webkit-text-fill-color: transparent;\">\n" +
      "- Inclura du JS interactif quand pertinent (boutons cliquables, alertes, etc.)\n\n" +
      "EXEMPLE de réponse attendue :\n" +
      "Salut ! Je te construis ta landing page pour restaurant italien avec une ambiance terracotta élégante. Je vais faire 5 sections : Header, Hero, Menu, Réservation, Footer.\n\n" +
      "<SECTION name=\"header\">\n" +
      "Maintenant je commence par le Header avec la navigation sticky.\n" +
      "<header class=\"sticky top-0 z-50 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800\">\n" +
      "  <nav class=\"max-w-6xl mx-auto px-6 py-4 flex items-center justify-between\">\n" +
      "    <div class=\"flex items-center space-x-2\">\n" +
      "      <i class=\"fa-solid fa-pizza-slice text-rose-400 text-xl\"></i>\n" +
      "      <span class=\"font-bold text-lg text-white\">Bella Italia</span>\n" +
      "    </div>\n" +
      "    <div class=\"hidden md:flex space-x-8 text-sm text-slate-300\">\n" +
      "      <a href=\"#home\" class=\"hover:text-white\">Accueil</a>\n" +
      "      <a href=\"#menu\" class=\"hover:text-white\">Menu</a>\n" +
      "      <a href=\"#reservation\" class=\"hover:text-white\">Réservations</a>\n" +
      "    </div>\n" +
      "    <button class=\"bg-rose-500 hover:bg-rose-400 text-white text-sm font-bold px-4 py-2 rounded-lg\">Réserver</button>\n" +
      "  </nav>\n" +
      "</header>\n" +
      "</SECTION>\n\n" +
      "<SECTION name=\"hero\">\n" +
      "Ensuite je passe au Hero avec un titre impactant en dégradé.\n" +
      "<section class=\"relative min-h-screen flex items-center justify-center overflow-hidden\">\n" +
      "  ... (code HTML du Hero)\n" +
      "</section>\n" +
      "</SECTION>\n\n" +
      "[... continues pour menu, reservation, footer ...]\n\n" +
      "Voilà, ta landing page pour Bella Italia est prête ! Tu peux cliquer sur les boutons pour tester l'interactivité.";

    // === SYSTÈME PROMPT MODE MODIFICATION ===
    // (nouveau : l'IA reçoit le HTML existant et modifie SEULEMENT les sections concernées)
    const modificationSystemPrompt =
      "Tu es le Lead Engineer IA de VibeCode Studio. L'utilisateur te parle en français, tu réponds en français.\n\n" +
      "CONTEXTE CRITIQUE : L'utilisateur a DÉJÀ une application web existante (le code HTML complet t'est fourni dans le message utilisateur). Il veut la MODIFIER, pas la recréer.\n\n" +
      "RÔLE : Tu modifies UNIQUEMENT les sections concernées par la demande de l'utilisateur. Tu ne renvoies pas les sections non modifiées. L'utilisateur doit voir les changements apparaître en temps réel dans le preview, section par section, avec un effet de remplacement fluide.\n\n" +
      "NARRATION VIVANTE : avant chaque section modifiée, raconte en 1-2 phrases chaleureuses ce que tu changes et pourquoi, comme un designer qui parle à son client. Utilise le tutoiement.\n\n" +
      "QUALITÉ DESIGN : garde la cohérence de l'existant et améliore-le (images cohérentes, hover states, hiérarchie typographique, espacements généreux).\n\n" +
      "FORMAT OBLIGATOIRE de ta réponse en mode modification :\n\n" +
      "1. Phrase courte pour annoncer ce que tu vas modifier (1 phrase max, conversationnelle)\n" +
      "   Ex: \"OK, je passe le bouton du Hero en bleu et j'ajoute une ombre.\"\n" +
      "   Ex: \"Compris, j'ajoute une nouvelle section témoignages entre le Menu et la Réservation.\"\n\n" +
      "2. Pour CHAQUE section à modifier ou ajouter, écris un bloc au format EXACT :\n\n" +
      "   <SECTION name=\"nom-de-la-section\" mode=\"modify\">\n" +
      "   Phrase courte décrivant ce que tu modifies (ex: \"Je passe le bouton 'Réserver' du Hero en bleu.\")\n" +
      "   [HTML COMPLET de la section modifiée, avec les changements appliqués]\n" +
      "   </SECTION>\n\n" +
      "3. Pour AJOUTER une nouvelle section à un endroit précis, utilise :\n" +
      "   <SECTION name=\"nom-nouvelle-section\" mode=\"add\" after=\"nom-section-précédente\">\n" +
      "   Phrase courte\n" +
      "   [HTML COMPLET de la nouvelle section]\n" +
      "   </SECTION>\n\n" +
      "4. Pour SUPPRIMER une section, utilise :\n" +
      "   <SECTION name=\"nom-section\" mode=\"delete\">\n" +
      "   Phrase courte expliquant la suppression\n" +
      "   </SECTION>\n\n" +
      "5. Termine par une phrase de confirmation\n" +
      "   Ex: \"Voilà, le bouton est maintenant bleu ! Tu peux voir le changement dans le Hero.\"\n\n" +
      "RÈGLES CRITIQUES :\n" +
      "- Le name doit correspondre EXACTEMENT (même orthographe) à une section EXISTANTE listée dans le CONTEXTE RÉEL de la page (header, hero, menu, reservation, footer, etc.) quand mode=\"modify\" ou mode=\"delete\" — n'invente JAMAIS un nom (ex: \"navbar\" alors que la section existante s'appelle \"header\")\n" +
      "- Pour une section NOUVELLE (qui n'existe pas encore dans le contexte), utilise mode=\"add\" avec after=<nom de la dernière section>\n" +
      "- Le HTML modifié doit être COMPLET (toute la section, pas juste la partie changée)\n" +
      "- Ne renvoie QUE les sections modifiées/ajoutées — JAMAIS les sections non modifiées\n" +
      "- Garde le style et la structure globale de l'application (ne change pas la palette ou le thème si non demandé)\n" +
      "- Si la demande concerne plusieurs sections, renvoie-les toutes avec leur propre bloc <SECTION>\n" +
      "- Le texte décrivant chaque modification doit être COURT (1 phrase max) et conversationnel\n\n" +
      "EXEMPLE pour demande \"change le bouton du Hero en bleu\" :\n\n" +
      "OK, je passe le bouton 'Réserver' du Hero en bleu avec une ombre.\n\n" +
      "<SECTION name=\"hero\" mode=\"modify\">\n" +
      "Je modifie le Hero — le bouton passe de rose à bleu.\n" +
      "<section class=\"relative min-h-screen flex items-center justify-center overflow-hidden\">\n" +
      "  <div class=\"absolute inset-0 bg-slate-900\"></div>\n" +
      "  <div class=\"relative z-10 max-w-4xl mx-auto px-6 text-center\">\n" +
      "    <h1>Bienvenue</h1>\n" +
      "    <a href=\"#menu\" class=\"bg-blue-500 hover:bg-blue-400 text-white font-bold px-8 py-3 rounded-lg shadow-lg shadow-blue-500/50\">Voir le menu</a>\n" +
      "  </div>\n" +
      "</section>\n" +
      "</SECTION>\n\n" +
      "Voilà, le bouton est maintenant bleu !";

    const systemPrompt = isModificationMode ? modificationSystemPrompt : creationSystemPrompt;

    // Pour le mode modification, on inclut TOUJOURS le HTML actuel comme contexte
    const userPrompt = isModificationMode
      ? `Voici le code HTML ACTUEL de l'application :\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nDemande de modification de l'utilisateur : ${body.message}\n\nApplique les modifications nécessaires en respectant le format <SECTION name="..." mode="modify">.${buildPageContext(currentHtml)}`
      : (isModification
        ? `Voici le code HTML actuel de l'application :\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nDemande de l'utilisateur : ${body.message}${buildPageContext(currentHtml)}`
        : `Demande de l'utilisateur : ${body.message}`);

    let fullText = '';
    let inSection = false;
    let currentSectionName = '';
    let currentSectionMode = 'create'; // 'create' | 'modify' | 'add' | 'delete'
    let currentSectionAfter = ''; // pour mode="add" : nom de la section précédente
    let currentSectionHtml = '';
    let currentSectionText = '';
    let sectionIndex = 0;
    // === ACCUMULATEUR DE SECTIONS CÔTÉ SERVEUR ===
    // Pour pouvoir sauvegarder le HTML final dans fileStore à la fin du stream,
    // le serveur doit accumuler les sections au fur et à mesure qu'elles arrivent.
    // Sinon, la prochaine demande de modification ne trouvera pas de HTML existant
    // et l'IA repassera en mode création (recréera tout le site).
    const serverSections: Array<{ name: string; mode: string; after: string; html: string }> = [];
    // Heartbeat SSE (fiabilité CDC §17) : un commentaire périodique garde la
    // connexion ouverte à travers les proxys pendant les silences du flux
    // (attente du premier token LLM, gate Chromium). Une ligne de commentaire
    // SSE est ignorée par tout consommateur qui ne lit que les `data:`.
    const heartbeatMs = Number(process.env.VOLACO_SSE_HEARTBEAT_MS ?? 15000);
    const heartbeat = heartbeatMs > 0 ? setInterval(() => {
      if (clientGone) return;
      try { res.write(': ping\n\n'); } catch { /* socket déjà fermé */ }
    }, heartbeatMs) : null;

    try {
      // @ts-expect-error — generateStream existe sur MistralProviderAdapter
      const stream = adapter.generateStream(
        {
          tenantId: context.tenantId,
          projectId,
          prompt: userPrompt,
          systemPrompt,
          temperature: 0.4,
          maxTokens: 8192,
          timeoutMs: 120000,
          requestId
        },
        aiProviderRegistry.getTenantCredentials(context.tenantId, adapter.descriptor.providerId)
      );

      for await (const chunk of stream) {
        if (clientGone || cancelFlag.cancelled) break;
        fullText += chunk;

        // Détecte l'ouverture d'une nouvelle section <SECTION name="...">
        // Regex enrichie pour capter aussi le mode (modify/add/delete) et after
        const openMatch = fullText.match(/<SECTION\s+name=["']([^"']+)["']\s*(?:\s+mode=["']([^"']+)["'])?\s*(?:\s+after=["']([^"']+)["'])?\s*>/);
        if (!inSection && openMatch && openMatch.index !== undefined) {
          // Le texte avant la section est du thinking/chat conversationnel
          const textBeforeSection = fullText.slice(0, openMatch.index);
          if (textBeforeSection.trim()) {
            // Nettoie les marqueurs de section déjà émis
            const cleanText = textBeforeSection.replace(/<SECTION[^>]*>/g, '').trim();
            if (cleanText) {
              sendSSE({ type: 'chat', text: cleanText });
            }
          }
          inSection = true;
          currentSectionName = openMatch[1] || '';
          currentSectionMode = openMatch[2] || 'create';
          currentSectionAfter = openMatch[3] || '';
          currentSectionHtml = '';
          currentSectionText = '';
          sectionIndex++;
          if (recorder) executionStore.transitionPhase(executionId, 'IMPLEMENT');
          emit({ type: 'compass', state: 'EXECUTING' });
          emit({
            type: 'section_start',
            name: currentSectionName,
            mode: currentSectionMode,
            after: currentSectionAfter,
            index: sectionIndex
          }, {
            type: currentSectionMode === 'delete' ? 'FILE_DELETED' : currentSectionMode === 'modify' ? 'FILE_MODIFIED' : 'FILE_CREATED',
            phase: 'IMPLEMENT',
            status: 'RUNNING',
            title: (currentSectionMode === 'delete'
              ? 'Suppression de la section '
              : currentSectionMode === 'modify'
                ? 'Modification de la section '
                : 'Construction de la section ') + currentSectionName,
            detail: { section: currentSectionName, mode: currentSectionMode, index: sectionIndex }
          });

          // Continue à accumuler le contenu de la section après le marqueur
          const afterMarker = fullText.slice(openMatch.index + openMatch[0].length);
          fullText = afterMarker;
          continue;
        }

        // Si on est dans une section, accumule le HTML
        if (inSection) {
          // Détecte la fermeture de section </SECTION>
          if (fullText.includes('</SECTION>')) {
            const closeIdx = fullText.indexOf('</SECTION>');
            const sectionContent = fullText.slice(0, closeIdx);

            // Sépare le texte court (avant le 1er tag HTML) du HTML réel
            const firstTagMatch = sectionContent.match(/<[a-zA-Z]/);
            if (firstTagMatch && firstTagMatch.index !== undefined) {
              currentSectionText = sectionContent.slice(0, firstTagMatch.index).trim();
              currentSectionHtml = sectionContent.slice(firstTagMatch.index).trim();
            } else {
              currentSectionText = sectionContent.trim();
              currentSectionHtml = '';
            }
            emit({
              type: 'section_end',
              name: currentSectionName,
              mode: currentSectionMode,
              after: currentSectionAfter,
              index: sectionIndex,
              text: currentSectionText,
              html: currentSectionHtml
            }, {
              type: currentSectionMode === 'delete' ? 'FILE_DELETED' : currentSectionMode === 'modify' ? 'FILE_MODIFIED' : 'FILE_CREATED',
              phase: 'IMPLEMENT',
              status: 'COMPLETED',
              title: 'Section ' + currentSectionName + ' générée',
              detail: { section: currentSectionName, mode: currentSectionMode, chars: currentSectionHtml.length }
            });

            // === ACCUMULE LA SECTION CÔTÉ SERVEUR pour sauvegarde finale ===
            serverSections.push({
              name: currentSectionName,
              mode: currentSectionMode,
              after: currentSectionAfter,
              html: currentSectionHtml
            });

            // Reset pour la prochaine section
            inSection = false;
            currentSectionName = '';
            currentSectionMode = 'create';
            currentSectionAfter = '';
            currentSectionHtml = '';
            currentSectionText = '';
            fullText = fullText.slice(closeIdx + '</SECTION>'.length);
            continue;
          }

          // Pendant la section : envoie juste le chat text qui précède les tags HTML
          sendSSE({ type: 'token', token: chunk });
        } else {
          // Hors section : texte conversationnel normal
          sendSSE({ type: 'token', token: chunk });
        }
      }

      // T5 — annulation explicite de l'utilisateur : on n'assemble ni ne
      // sauvegarde rien, on enregistre CANCELLED (⏹ pas ❌, CDC §20) et on
      // prévient le client qui a demandé l'arrêt.
      if (cancelFlag.cancelled) {
        logger.warn('Génération annulée par l\'utilisateur — HTML non sauvegardé', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          charsReceived: fullText.length
        });
        sendSSE({ type: 'cancelled' });
        if (recorder) executionStore.cancelExecution(executionId, 'user_cancel');
        return true;
      }

      // Client parti en cours de génération : on n'assemble ni ne sauvegarde un
      // HTML partiel (on éviterait d'écraser le fichier existant avec du contenu
      // tronqué) ; le finally ci-dessous ferme proprement la réponse.
      if (clientGone) {
        logger.warn('Client déconnecté pendant le stream — génération interrompue, HTML non sauvegardé', {
          component: 'conversation-route-stream',
          tenantId: context.tenantId,
          projectId,
          charsReceived: fullText.length
        });
        // Annulation honnête (⏹ pas ❌) : l'exécution reste consultable au replay.
        if (recorder) executionStore.cancelExecution(executionId, 'client_gone');
        return true;
      }

      // À la fin, envoie tout texte restant comme chat final
      if (fullText.trim()) {
        const cleanText = fullText.replace(/<SECTION[^>]*>[\s\S]*?<\/SECTION>/g, '').trim();
        if (cleanText) {
          sendSSE({ type: 'chat', text: cleanText });
        }
      }

      // === ASSEMBLE LE HTML FINAL ET SAUVEGARDE DANS FILESTORE ===
      // Pour que la prochaine demande de modification trouve un HTML existant.
      let assembledHtml = '';
      // T4 — diffs réels par section, émis au client et persistés
      const sectionDiffs: Array<{ name: string; mode: string; applied: boolean; added: number; removed: number }> = [];

      if (isModificationMode && currentHtml) {
        // Mode modification : on part du HTML existant et on applique les modifications
        // Détecte les sections existantes dans le HTML actuel via les data-section
        // ou par les IDs des balises <section>, <header>, <footer>, etc.
        // Pour simplifier, on parse les balises principales.

        // Pour chaque section modifiée par l'IA, on remplace dans le HTML existant.
        // T4 — diff réel capturé par section (bloc remplacé vs nouveau bloc) ;
        // `applied` dit la VÉRITÉ du merge : un regex qui ne matche pas n'est
        // pas une modification appliquée.
        let modifiedHtml = currentHtml;
        for (const sec of serverSections) {
          const htmlBeforeSection = modifiedHtml;
          let oldBlock = '';
          if (sec.mode === 'delete') {
            // Supprime la section existante avec cet attribut data-section
            const deleteRegex = new RegExp(`<div[^>]*data-section="${sec.name}"[^>]*>[\\s\\S]*?(?=<div[^>]*data-section|<\\/body>|$)`, 'g');
            const deleteMatch = deleteRegex.exec(modifiedHtml);
            if (deleteMatch) oldBlock = deleteMatch[0];
            modifiedHtml = modifiedHtml.replace(new RegExp(deleteRegex.source, 'g'), '');
            // Ou supprime par ID de section
            const idRegex = new RegExp(`<section[^>]*id="${sec.name}"[^>]*>[\\s\\S]*?<\\/section>`, 'g');
            const idMatch = idRegex.exec(modifiedHtml);
            if (idMatch && !oldBlock) oldBlock = idMatch[0];
            modifiedHtml = modifiedHtml.replace(new RegExp(idRegex.source, 'g'), '');
            // Ou supprime par balise (header, footer, etc.)
            if (sec.name === 'header' || sec.name === 'footer' || sec.name === 'nav') {
              const tagRegex = new RegExp(`<${sec.name}[\\s\\S]*?<\\/${sec.name}>`, 'g');
              const tagMatch = tagRegex.exec(modifiedHtml);
              if (tagMatch && !oldBlock) oldBlock = tagMatch[0];
              modifiedHtml = modifiedHtml.replace(new RegExp(tagRegex.source, 'g'), '');
            }
          } else if (sec.mode === 'modify' && sec.html) {
            // Remplace la section existante par la nouvelle version
            // IMPORTANT : sec.html peut déjà contenir un wrapper <div data-section="...">
            // si le LLM l'a inclus (cf system prompt example). On ne re-wrappe PAS.
            const cleanHtml = sec.html.replace(/^<div[^>]*data-section="[^"]*"[^>]*>([\s\S]*)<\/div>$/, '$1').trim();
            // Tente par data-section d'abord (notre format stitchReveal)
            const dataAttrRegex = new RegExp(`<div[^>]*data-section="${sec.name}"[^>]*>[\\s\\S]*?(?=<div[^>]*data-section|<\\/body>|$)`, 'g');
            const dataMatch = dataAttrRegex.exec(modifiedHtml);
            if (dataMatch) oldBlock = dataMatch[0];
            const before = modifiedHtml;
            modifiedHtml = modifiedHtml.replace(new RegExp(dataAttrRegex.source, 'g'), `<div class="vibe-stitched" data-section="${sec.name}">${cleanHtml}</div>`);
            // Si pas de remplacement, tente par ID de section
            if (modifiedHtml === before) {
              const idRegex = new RegExp(`<section[^>]*id="${sec.name}"[^>]*>[\\s\\S]*?<\\/section>`, 'g');
              const idMatch = idRegex.exec(modifiedHtml);
              if (idMatch && !oldBlock) oldBlock = idMatch[0];
              const before2 = modifiedHtml;
              // STITCH : même contrat que le chemin data-section — la section
              // insérée porte TOUJOURS son wrapper data-section (halo,
              // diff-guard et ancrages des générations suivantes en dépendent).
              modifiedHtml = modifiedHtml.replace(new RegExp(idRegex.source, 'g'), `<div class="vibe-stitched" data-section="${sec.name}">${sec.html}</div>`);
              // Si toujours pas, tente par balise (header, footer, nav)
              if (modifiedHtml === before2 && (sec.name === 'header' || sec.name === 'footer' || sec.name === 'nav')) {
                const tagRegex = new RegExp(`<${sec.name}[\\s\\S]*?<\\/${sec.name}>`, 'g');
                const tagMatch = tagRegex.exec(modifiedHtml);
                if (tagMatch && !oldBlock) oldBlock = tagMatch[0];
                modifiedHtml = modifiedHtml.replace(new RegExp(tagRegex.source, 'g'), `<div class="vibe-stitched" data-section="${sec.name}">${sec.html}</div>`);
              }
              // P3-fix — mode="modify" sur un nom INEXISTANT (l'IA a inventé
              // un nom, ex: « navbar » au lieu de « header ») : la section
              // n'est PAS perdue — elle est ajoutée en fin de page (même
              // fallback que le mode add). Sinon « Diff … non appliqué » à
              // chaque génération et le travail de l'IA est jeté.
              if (modifiedHtml === before) {
                const bodyClose = modifiedHtml.lastIndexOf('</body>');
                if (bodyClose !== -1) {
                  modifiedHtml = modifiedHtml.slice(0, bodyClose)
                    + `\n<div class="vibe-stitched" data-section="${sec.name}">${cleanHtml}</div>\n`
                    + modifiedHtml.slice(bodyClose);
                }
              }
            }
          } else if (sec.mode === 'add' && sec.html) {
            // UNICITÉ (audit preview) : une section « ajoutée » dont le nom
            // existe DÉJÀ est un REMPLACEMENT, pas un doublon — sinon chaque
            // génération ré-émettant header/footer empilait des copies
            // (footer ×3, header ×2 constatés en production).
            const cleanAddHtml = sec.html.replace(/^<div[^>]*data-section="[^"]*"[^>]*>([\s\S]*)<\/div>$/, '$1').trim();
            const existsRe = new RegExp(`<div[^>]*data-section="${sec.name}"[^>]*>[\\s\\S]*?(?=<div[^>]*data-section|<\\/body>|$)`, 'i');
            const existing = existsRe.exec(modifiedHtml);
            if (existing) {
              oldBlock = existing[0];
              modifiedHtml = modifiedHtml.replace(new RegExp(existsRe.source, 'i'), `<div class="vibe-stitched" data-section="${sec.name}">${cleanAddHtml}</div>`);
            } else {
              // SANS flag /g : si le document contient plusieurs sections du même
              // nom d'ANCRE, la section ajoutée ne doit apparaître qu'après la
              // PREMIÈRE ancre (sinon duplications en cascade).
              const afterRegex = new RegExp(`(<div[^>]*data-section="${sec.after}"[^>]*>[\\s\\S]*?</div>)(\\s*<div[^>]*data-section)`);
              const before = modifiedHtml;
              modifiedHtml = modifiedHtml.replace(afterRegex, `$1\n<div class="vibe-stitched" data-section="${sec.name}">${cleanAddHtml}</div>$2`);
              if (modifiedHtml === before) {
                // Tente par ID — avec wrapper (même contrat que le chemin principal)
                const idAfterRegex = new RegExp(`(<section[^>]*id="${sec.after}"[^>]*>[\\s\\S]*?<\\/section>)`, 'g');
                modifiedHtml = modifiedHtml.replace(idAfterRegex, `$1\n<div class="vibe-stitched" data-section="${sec.name}">${sec.html}</div>`);
              }
              if (modifiedHtml === before) {
                // T4/T7 — l'ancre est la DERNIÈRE section : insertion avant
                // </body> (même convention que le client), sinon la section
                // générée serait perdue (applied:false pour rien).
                const bodyClose = modifiedHtml.lastIndexOf('</body>');
                if (bodyClose !== -1) {
                  modifiedHtml = modifiedHtml.slice(0, bodyClose)
                    + `\n<div class="vibe-stitched" data-section="${sec.name}">${cleanAddHtml}</div>\n`
                    + modifiedHtml.slice(bodyClose);
                }
              }
            }
          } else if (sec.mode === 'create' && sec.html) {
            // UNICITÉ : « create » sur un nom déjà présent = remplacement
            // (le LLM ré-émet souvent header/footer en mode create — sans
            // cette garde, chaque génération ajoutait un doublon en fin de page).
            const cleanCreateHtml = sec.html.replace(/^<div[^>]*data-section="[^"]*"[^>]*>([\s\S]*)<\/div>$/, '$1').trim();
            const existsRe = new RegExp(`<div[^>]*data-section="${sec.name}"[^>]*>[\\s\\S]*?(?=<div[^>]*data-section|<\\/body>|$)`, 'i');
            const existing = existsRe.exec(modifiedHtml);
            if (existing) {
              oldBlock = existing[0];
              modifiedHtml = modifiedHtml.replace(new RegExp(existsRe.source, 'i'), `<div class="vibe-stitched" data-section="${sec.name}">${cleanCreateHtml}</div>`);
            } else {
              modifiedHtml += `<div class="vibe-stitched" data-section="${sec.name}">${cleanCreateHtml}</div>`;
            }
          }
          // T4 — delta réel de la section (bloc remplacé vs contenu généré)
          const applied = modifiedHtml !== htmlBeforeSection;
          const delta = countLineDelta(oldBlock, sec.mode === 'delete' ? '' : (sec.html || ''));
          sectionDiffs.push({ name: sec.name, mode: sec.mode, applied, added: delta.added, removed: delta.removed });
        }
        assembledHtml = modifiedHtml;
      } else {
        // Mode création : assemble simplement les sections dans l'ordre.
        // T4 — en création, tout est ajout : delta réel par section.
        for (const sec of serverSections) {
          if (sec.html) {
            assembledHtml += `<div class="vibe-stitched" data-section="${sec.name}">${sec.html}</div>\n`;
            sectionDiffs.push({ name: sec.name, mode: sec.mode || 'create', applied: true, added: countLineDelta('', sec.html).added, removed: 0 });
          }
        }
      }

      // === ENVELOPPE DANS UN DOCUMENT COMPLET SI FRAGMENTS ===
      // En création, assembledHtml est une suite de <div data-section>. Le
      // sauvegarder brut laissait le fichier sans <head> (Tailwind, polices)
      // et cassait le contexte des tours suivants. Un document complet est
      // envoyé au client ET sauvegardé — le client détecte le DOCTYPE et ne
      // ré-emballe pas (même convention que buildHtmlDoc côté Studio).
      // UNICITÉ — déduplication douce avant sauvegarde : la dernière
      // occurrence de chaque data-section gagne (assainit les fichiers
      // pollués par les générations antérieures).
      assembledHtml = dedupeSectionBlocks(assembledHtml);
      if (assembledHtml.trim().length > 100 && !/<!DOCTYPE|<html[\s>]/i.test(assembledHtml)) {
        assembledHtml = buildStudioShell(assembledHtml);
      }

      // LOT 3 — Compass : phase de validation avant la sauvegarde finale
      if (recorder) executionStore.transitionPhase(executionId, 'VALIDATE');
      emit({ type: 'compass', state: 'VALIDATING' });
      emit({ type: 'chat', text: 'Je vérifie le rendu réel…' });

      // Sauvegarde dans fileStore pour que la prochaine demande trouve le HTML
      let savedRevisionId: string | undefined;
      let gateEligible = false;
      if (assembledHtml.trim().length > 100) {
        try {
          fileStore.saveFile(context.tenantId, projectId, 'index.html', assembledHtml);
          // P3-fix — le dernier format généré pour ce projet est HTML :
          // la reprise du preview ne doit pas réafficher un bundle React obsolète.
          setProjectFormat(projectId, 'html');
          gateEligible = true;
          // ÉTAPE 6 — révision automatique (§32 CDC Evolution Engine) : chaque
          // génération produit une révision réversible (rollback déjà branché).
          try {
            const autoRevision = revisionStore.createRevision(context.tenantId, projectId, {
              message: `Génération IA — ${(body.message || '').slice(0, 80)}`,
              author: 'Agent IA',
              files: { 'index.html': assembledHtml },
              provenance: { source: 'AI_AGENT', triggerRequestId: requestId }
            });
            savedRevisionId = autoRevision.id;
          } catch (revErr) {
            logger.warn('Création de révision automatique impossible', {
              component: 'conversation-route-stream',
              projectId,
              error: revErr instanceof Error ? revErr.message : String(revErr)
            });
          }
          // LOT 3 — Compass : l'état COMPLETED sera émis APRÈS le Quality Gate
          // (le client ne doit pas voir « Terminé » pendant la vérification).
          logger.info('HTML final sauvegardé dans fileStore après stream', {
            component: 'conversation-route-stream',
            tenantId: context.tenantId,
            projectId,
            htmlLength: assembledHtml.length,
            sectionsCount: serverSections.length
          });
        } catch (saveErr) {
          logger.warn('Échec sauvegarde HTML final dans fileStore', {
            component: 'conversation-route-stream',
            error: saveErr instanceof Error ? saveErr.message : String(saveErr)
          });
        }
      }

      // T6 (CDC §24/§31) — QUALITY GATE SERVEUR : source de vérité unique.
      // Le gate tourne sur le HTML EXACTEMENT sauvegardé (fin de la bifurcation
      // client/serveur) et son résultat part dans la frame done + le store.
      let gateResult: { score: number; findings: Array<{ severity: string; title: string }>; stats: { colors: number; fonts: number; interactiveElements: number }; renderAvailable: boolean } | null = null;
      if (recorder && gateEligible) {
        recordOnly({
          type: 'VALIDATION_STARTED',
          phase: 'VALIDATE',
          status: 'RUNNING',
          title: 'Vérification du rendu réel (Chromium + DOM)'
        });
        try {
          const analysis = await analyzeProjectVisual(context.tenantId, context.role, projectId, requestId);
          gateResult = {
            score: analysis.score,
            findings: analysis.findings,
            stats: analysis.stats,
            renderAvailable: analysis.renderAvailable
          };
          const criticals = analysis.findings.filter((f) => f.severity === 'CRITICAL').length;
          recordOnly({
            type: 'VALIDATION_COMPLETED',
            phase: 'VALIDATE',
            status: 'COMPLETED',
            title: `Quality Gate : ${analysis.score}/100`,
            detail: {
              score: analysis.score,
              criticals,
              findings: analysis.findings.length,
              renderAvailable: analysis.renderAvailable
            }
          });
        } catch (gateErr) {
          logger.warn('Quality Gate serveur indisponible', {
            component: 'conversation-route-stream',
            error: gateErr instanceof Error ? gateErr.message : String(gateErr)
          });
          recordOnly({
            type: 'VALIDATION_FAILED',
            phase: 'VALIDATE',
            status: 'FAILED',
            title: 'Vérification impossible — gate indisponible',
            detail: { error: gateErr instanceof Error ? gateErr.message : String(gateErr) }
          });
        }
      }

      // Compass : le cycle n'est vraiment terminé qu'après le gate
      emit({ type: 'compass', state: 'COMPLETED' });

      // EXECUTION TRANSPARENCY : bilan réel (ce qui a été fait, pas ce qu'on
      // espérait) enregistré avant le done — la synthèse du CDC §24-§25 en T7
      // s'appuiera sur ces compteurs.
      // T4 — les diffs réels partent sur le fil ET dans le store.
      const totalAdded = sectionDiffs.reduce((acc, d) => acc + d.added, 0);
      const totalRemoved = sectionDiffs.reduce((acc, d) => acc + d.removed, 0);
      for (const diff of sectionDiffs) {
        // LOT E — frame + activité en UN seul passage (la frame porte la vue
        // normalisée : le flux live montre le diff sans second canal).
        emit({
          type: 'diff',
          section: diff.name,
          mode: diff.mode,
          applied: diff.applied,
          added: diff.added,
          removed: diff.removed
        }, {
          type: 'DIFF_GENERATED',
          phase: 'IMPLEMENT',
          status: diff.applied ? 'COMPLETED' : 'FAILED',
          title: diff.applied
            ? `Diff calculé — section ${diff.name}`
            : `Section ${diff.name} non appliquée : cible introuvable dans le HTML`,
          detail: { section: diff.name, mode: diff.mode, applied: diff.applied, addedLines: diff.added, removedLines: diff.removed }
        });
      }
      if (recorder) {
        executionStore.completeExecution(executionId, {
          sectionsCreated: serverSections.filter((s) => s.mode === 'create' || s.mode === 'add').length,
          sectionsModified: serverSections.filter((s) => s.mode === 'modify').length,
          sectionsDeleted: serverSections.filter((s) => s.mode === 'delete').length,
          filesTouched: ['index.html'],
          htmlChars: assembledHtml.length,
          addedLines: totalAdded,
          removedLines: totalRemoved,
          ...(gateResult ? { score: gateResult.score } : {}),
          ...(savedRevisionId ? { revisionId: savedRevisionId } : {})
        });
      }

      // T7 — synthèse finale : une phrase honnête, des chiffres réels
      const synthesisText = buildFinalSynthesis({
        sections: serverSections.map((s) => ({ name: s.name, mode: s.mode })),
        sectionDiffs,
        gateScore: gateResult ? gateResult.score : null,
        durationSec: Math.round((Date.now() - streamStartedAt) / 1000)
      });
      recordOnly({
        type: 'SUMMARY_GENERATED',
        phase: 'COMPLETE',
        status: 'COMPLETED',
        title: 'Synthèse de l\u2019exécution',
        detail: { text: synthesisText }
      });

      // P6 — CONVERSATION VIVANTE : le tour est enregistré dans la session
      // (message utilisateur, réponse de l'agent = synthèse, intention
      // réelle P2-d, plan, mémoire projet) et persisté.
      try {
        conversationIntelligenceService.recordStreamTurn({
          tenantId: context.tenantId,
          projectId,
          sessionId,
          userRole: context.role,
          userMessage: body.message || '',
          assistantMessage: 'Synthèse : ' + synthesisText,
          intent: realIntent,
          plan,
          durationMs: Date.now() - streamStartedAt,
          requestId
        });
      } catch (turnErr) {
        logger.warn('Tour de stream non enregistré', {
          component: 'conversation-route-stream', projectId,
          error: turnErr instanceof Error ? turnErr.message : String(turnErr)
        });
      }

      emit({
        type: 'done',
        updated: true,
        html: assembledHtml,
        thinking: fullText.replace(/<SECTION[^>]*>[\s\S]*?<\/SECTION>/g, '').trim(),
        synthesis: { text: synthesisText },
        ...(gateResult ? { gate: gateResult } : {})
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // CDC §39 — séparation log technique / message utilisateur : une erreur
      // d'auth fournisseur (401/403) doit être ACTIONNABLE, pas brute.
      const friendly = /HTTP\s*40[13]/.test(message)
        ? "Ta clé Mistral est refusée par l'API (HTTP 401) — elle est invalide ou révoquée. Génère une nouvelle clé sur console.mistral.ai, place-la dans .env (MISTRAL_API_KEY=...) puis redémarre le serveur."
        : message;
      logger.warn("Erreur pendant le streaming conversationnel", {
        component: 'conversation-route-stream',
        tenantId: context.tenantId,
        projectId,
        error: message
      });
      if (recorder) executionStore.failExecution(executionId, message);
      emit({ type: 'error', error: friendly });
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      activeCancelFlags.delete(executionId);
      res.end();
    }

    return true;
  }

  return false;
}
