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
import { aiProviderRegistry } from '../../../../packages/core/src/ai/providers/registry.js';
import { logger } from '../../../../packages/core/src/logger.js';
import type { EngineeringPlan, IntentResult } from '../../../../packages/core/src/ai-native/conversation-intelligence/types.js';
import { PlanGenerator } from '../../../../packages/core/src/ai-native/conversation-intelligence/engine/plan-generator.js';
import type { RequestContext } from '../middleware/auth.js';

import { readBody } from '../middleware/body.js';
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
export function buildStudioShell(sectionsHtml: string): string {  return `<!DOCTYPE html>
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
    @keyframes stitchReveal { 0% { opacity: 0; transform: translateY(8px); filter: blur(4px); } 100% { opacity: 1; transform: translateY(0); filter: blur(0); } }
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

    sendSSE({ type: 'start', isModification });
    // LOT 3 — Compass complet (§11 CDC) : les 9 états sont émis au fil du flux
    sendSSE({ type: 'compass', state: 'UNDERSTANDING' });

    // LOT 4 — Plan First (§17 CDC) : un plan déterministe est TOUJOURS émis
    // (traçabilité Understand Before Acting), AVANT la sélection du fournisseur
    // — le plan et la confirmation humaine ne dépendent d'aucune clé LLM.
    // En mode planFirst, le flux s'arrête ici et attend la confirmation (§3.9).
    const plan = planGenerator.generatePlan({ intent: buildStreamFallbackIntent(body.message || '') });
    sendSSE({ type: 'plan', plan });
    if (body.planFirst && !body.confirmedPlan) {
      sendSSE({ type: 'compass', state: 'WAITING_CONFIRMATION' });
      sendSSE({ type: 'done', awaitingConfirmation: true });
      res.end();
      return true;
    }

    // Sélectionne l'adaptateur Mistral (préfère le fournisseur dont la clé est env)
    const preferredProviderId = process.env.MISTRAL_API_KEY ? 'mistral' : process.env.GEMINI_API_KEY ? 'gemini' : undefined;
    const adapter = aiProviderRegistry.resolve(preferredProviderId ? { preferredProviderId } : {});
    if (!adapter || !('generateStream' in adapter)) {
      sendSSE({ type: 'error', error: "Aucun fournisseur IA streaming disponible (Mistral requis)." });
      res.end();
      return true;
    }

    // Détection du mode : CRÉATION vs MODIFICATION
    // Si on a un HTML existant > 200 chars, on est en mode modification.
    // Sinon, on est en mode création (comportement actuel).
    const isModificationMode = isModification || (currentHtml.trim().length > 200);

    // === SYSTÈME PROMPT MODE CRÉATION ===
    // (comportement actuel : génère un site complet section par section)
    const creationSystemPrompt =
      "Tu es le Lead Engineer IA de VibeCode Studio. L'utilisateur te parle en français, tu réponds en français.\n\n" +
      "RÔLE : Tu construis le site EN LIVE devant l'utilisateur, section par section, dans le preview. L'utilisateur doit VOIR le site se construire sous ses yeux — chaque section apparaît l'une après l'autre avec un effet de pulse.\n\n" +
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
      "- Le name doit correspondre à une section EXISTANTE dans le HTML fourni (header, hero, menu, reservation, footer, etc.) quand mode=\"modify\" ou mode=\"delete\"\n" +
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
      ? `Voici le code HTML ACTUEL de l'application :\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nDemande de modification de l'utilisateur : ${body.message}\n\nApplique les modifications nécessaires en respectant le format <SECTION name="..." mode="modify">.`
      : (isModification
        ? `Voici le code HTML actuel de l'application :\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nDemande de l'utilisateur : ${body.message}`
        : `Demande de l'utilisateur : ${body.message}`);

    // Signale au Studio que le stream commence
    sendSSE({ type: 'start', isModification });
    sendSSE({ type: 'compass', state: 'UNDERSTANDING' });

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
        if (clientGone) break;
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
          sendSSE({ type: 'compass', state: 'EXECUTING' });
          sendSSE({
            type: 'section_start',
            name: currentSectionName,
            mode: currentSectionMode,
            after: currentSectionAfter,
            index: sectionIndex
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
            sendSSE({
              type: 'section_end',
              name: currentSectionName,
              mode: currentSectionMode,
              after: currentSectionAfter,
              index: sectionIndex,
              text: currentSectionText,
              html: currentSectionHtml
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

      if (isModificationMode && currentHtml) {
        // Mode modification : on part du HTML existant et on applique les modifications
        // Détecte les sections existantes dans le HTML actuel via les data-section
        // ou par les IDs des balises <section>, <header>, <footer>, etc.
        // Pour simplifier, on parse les balises principales.

        // Pour chaque section modifiée par l'IA, on remplace dans le HTML existant
        let modifiedHtml = currentHtml;
        for (const sec of serverSections) {
          if (sec.mode === 'delete') {
            // Supprime la section existante avec cet attribut data-section
            const deleteRegex = new RegExp(`<div[^>]*data-section="${sec.name}"[^>]*>[\\s\\S]*?(?=<div[^>]*data-section|<\\/body>|$)`, 'g');
            modifiedHtml = modifiedHtml.replace(deleteRegex, '');
            // Ou supprime par ID de section
            const idRegex = new RegExp(`<section[^>]*id="${sec.name}"[^>]*>[\\s\\S]*?<\\/section>`, 'g');
            modifiedHtml = modifiedHtml.replace(idRegex, '');
            // Ou supprime par balise (header, footer, etc.)
            if (sec.name === 'header' || sec.name === 'footer' || sec.name === 'nav') {
              const tagRegex = new RegExp(`<${sec.name}[\\s\\S]*?<\\/${sec.name}>`, 'g');
              modifiedHtml = modifiedHtml.replace(tagRegex, '');
            }
          } else if (sec.mode === 'modify' && sec.html) {
            // Remplace la section existante par la nouvelle version
            // IMPORTANT : sec.html peut déjà contenir un wrapper <div data-section="...">
            // si le LLM l'a inclus (cf system prompt example). On ne re-wrappe PAS.
            const cleanHtml = sec.html.replace(/^<div[^>]*data-section="[^"]*"[^>]*>([\s\S]*)<\/div>$/, '$1').trim();
            // Tente par data-section d'abord (notre format stitchReveal)
            const dataAttrRegex = new RegExp(`<div[^>]*data-section="${sec.name}"[^>]*>[\\s\\S]*?(?=<div[^>]*data-section|<\\/body>|$)`, 'g');
            const before = modifiedHtml;
            modifiedHtml = modifiedHtml.replace(dataAttrRegex, `<div data-section="${sec.name}">${cleanHtml}</div>`);
            // Si pas de remplacement, tente par ID de section
            if (modifiedHtml === before) {
              const idRegex = new RegExp(`<section[^>]*id="${sec.name}"[^>]*>[\\s\\S]*?<\\/section>`, 'g');
              const before2 = modifiedHtml;
              modifiedHtml = modifiedHtml.replace(idRegex, sec.html);
              // Si toujours pas, tente par balise (header, footer, nav)
              if (modifiedHtml === before2 && (sec.name === 'header' || sec.name === 'footer' || sec.name === 'nav')) {
                const tagRegex = new RegExp(`<${sec.name}[\\s\\S]*?<\\/${sec.name}>`, 'g');
                modifiedHtml = modifiedHtml.replace(tagRegex, sec.html);
              }
            }
          } else if (sec.mode === 'add' && sec.html) {
            // Ajoute après la section 'after'
            // Nettoie aussi le wrapper si présent
            const cleanAddHtml = sec.html.replace(/^<div[^>]*data-section="[^"]*"[^>]*>([\s\S]*)<\/div>$/, '$1').trim();
            const afterRegex = new RegExp(`(<div[^>]*data-section="${sec.after}"[^>]*>[\\s\\S]*?</div>)(\\s*<div[^>]*data-section)`, 'g');
            const before = modifiedHtml;
            modifiedHtml = modifiedHtml.replace(afterRegex, `$1\n<div data-section="${sec.name}">${cleanAddHtml}</div>$2`);
            if (modifiedHtml === before) {
              // Tente par ID
              const idAfterRegex = new RegExp(`(<section[^>]*id="${sec.after}"[^>]*>[\\s\\S]*?<\\/section>)`, 'g');
              modifiedHtml = modifiedHtml.replace(idAfterRegex, `$1\n${sec.html}`);
            }
          } else if (sec.mode === 'create' && sec.html) {
            // En mode modification, une section "create" = ajout à la fin
            // Nettoie aussi le wrapper si présent
            const cleanCreateHtml = sec.html.replace(/^<div[^>]*data-section="[^"]*"[^>]*>([\s\S]*)<\/div>$/, '$1').trim();
            modifiedHtml += `<div data-section="${sec.name}">${cleanCreateHtml}</div>`;
          }
        }
        assembledHtml = modifiedHtml;
      } else {
        // Mode création : assemble simplement les sections dans l'ordre
        for (const sec of serverSections) {
          if (sec.html) {
            assembledHtml += `<div data-section="${sec.name}">${sec.html}</div>\n`;
          }
        }
      }

      // === ENVELOPPE DANS UN DOCUMENT COMPLET SI FRAGMENTS ===
      // En création, assembledHtml est une suite de <div data-section>. Le
      // sauvegarder brut laissait le fichier sans <head> (Tailwind, polices)
      // et cassait le contexte des tours suivants. Un document complet est
      // envoyé au client ET sauvegardé — le client détecte le DOCTYPE et ne
      // ré-emballe pas (même convention que buildHtmlDoc côté Studio).
      if (assembledHtml.trim().length > 100 && !/<!DOCTYPE|<html[\s>]/i.test(assembledHtml)) {
        assembledHtml = buildStudioShell(assembledHtml);
      }

      // LOT 3 — Compass : phase de validation avant la sauvegarde finale
      sendSSE({ type: 'compass', state: 'VALIDATING' });

      // Sauvegarde dans fileStore pour que la prochaine demande trouve le HTML
      if (assembledHtml.trim().length > 100) {
        try {
          fileStore.saveFile(context.tenantId, projectId, 'index.html', assembledHtml);
          // LOT 3 — Compass : cycle terminé
          sendSSE({ type: 'compass', state: 'COMPLETED' });
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

      sendSSE({
        type: 'done',
        updated: true,
        html: assembledHtml,
        thinking: fullText.replace(/<SECTION[^>]*>[\s\S]*?<\/SECTION>/g, '').trim()
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("Erreur pendant le streaming conversationnel", {
        component: 'conversation-route-stream',
        tenantId: context.tenantId,
        projectId,
        error: message
      });
      sendSSE({ type: 'error', error: message });
    } finally {
      res.end();
    }

    return true;
  }

  return false;
}
