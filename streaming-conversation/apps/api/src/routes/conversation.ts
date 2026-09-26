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
import type { EngineeringPlan } from '../../../../packages/core/src/ai-native/conversation-intelligence/types.js';
import type { RequestContext } from '../middleware/auth.js';

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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
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
    fileStore.saveFile(tenantId, projectId, entryFile, html);
    return { updated: true, content: html };
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
    const body = await parseJsonBody<{ message?: string; isModification?: boolean }>(req, requestId);
    if (!body.message) {
      throw new ValidationError('Le champ "message" est obligatoire', undefined, requestId);
    }

    // Headers SSE
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Désactive buffering nginx

    // Fonction helper pour envoyer un event SSE formaté
    const sendSSE = (data: Record<string, unknown>): void => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Récupère le projet + fichier existant pour déterminer si modif ou création
    const existing = fileStore.getFile(context.tenantId, projectId, 'index.html');
    const currentHtml = existing?.content || '';
    const isModification = body.isModification ?? (currentHtml.trim().length > 200);

    // Sélectionne l'adaptateur Mistral (préfère le fournisseur dont la clé est env)
    const preferredProviderId = process.env.MISTRAL_API_KEY ? 'mistral' : process.env.GEMINI_API_KEY ? 'gemini' : undefined;
    const adapter = aiProviderRegistry.resolve(preferredProviderId ? { preferredProviderId } : {});
    if (!adapter || !('generateStream' in adapter)) {
      sendSSE({ type: 'error', error: "Aucun fournisseur IA streaming disponible (Mistral requis)." });
      res.end();
      return true;
    }

    // System prompt conversationnel — l'IA parle comme un ingénieur qui pense
    // à voix haute, pas comme un générateur de code silencieux.
    const systemPrompt =
      "Tu es le Lead Engineer IA de VibeCode Studio. L'utilisateur te parle en français, tu réponds en français.\n\n" +
      "RÔLE : Tu es un ingénieur conversationnel, pas un robot muet. Quand l'utilisateur te demande quelque chose :\n" +
      "1. Réponds d'abord en pensant à voix haute (2-4 phrases sur ton approche, ton raisonnement, ce que tu vas faire)\n" +
      "2. Sois conversationnel : utilise 'je', 'tu', 'nous', 'on', pose des questions si utile\n" +
      "3. Pour les créations/modifs, décris en 3-5 puces ce que tu vas faire (sections, composants, etc.)\n" +
      "4. À LA FIN de ta réponse, génère le code HTML complet dans un bloc ```html ... ```\n\n" +
      "CONTRAINTES DESIGN (si génération HTML) :\n" +
      "- Dark mode élégant (#070913 ou #0b0f19), cartes glassmorphism, jamais de fond terne\n" +
      "- Tailwind CSS via CDN, FontAwesome pour les icônes\n" +
      "- Structure : Header sticky + Hero riche + sections + footer\n" +
      "- Interactivité JS (boutons cliquables, modals, filtres réactifs)\n" +
      "- Pour les titres en dégradé : <span class=\"bg-gradient-to-r from-X via-Y to-Z bg-clip-text text-transparent\" style=\"-webkit-background-clip: text; -webkit-text-fill-color: transparent;\">\n" +
      "- Avatars horizontaux en groupe superposé (-space-x-3), jamais empilés verticalement\n\n" +
      "EXEMPLE de réponse attendue :\n" +
      "\"Salut ! Je vais te faire une landing page pour ton restaurant italien. \"\n" +
      "\"Je vais partir sur une ambiance chaleureuse avec des couleurs terracotta et crème. \"\n" +
      "\"Voici mon plan :\\n\"\n" +
      "\"- Hero avec titre accrocheur et photo de pâtes\\n\"\n" +
      "\"- Section menu avec 5 plats signatures\\n\"\n" +
      "\"- Système de réservation interactif\\n\"\n" +
      "\"- Footer avec adresse et horaires\\n\\n\"\n" +
      "\"Voici le code :\\n\"\n" +
      "\"\\n\\n```html\\n<!DOCTYPE html>...\\n```\\n";

    const userPrompt = isModification
      ? `Voici le code HTML actuel de l'application :\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nDemande de l'utilisateur : ${body.message}`
      : `Demande de l'utilisateur : ${body.message}`;

    // Signale au Studio que le stream commence
    sendSSE({ type: 'start', isModification });

    let fullText = '';
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
        fullText += chunk;
        // Envoie chaque token au Studio
        sendSSE({ type: 'token', token: chunk });
      }

      // Extrait le bloc HTML du texte complet
      const htmlMatch = fullText.match(/```html\s*([\s\S]*?)```/i) || fullText.match(/```\s*([\s\S]*?)```/i);
      const html = htmlMatch && htmlMatch[1] ? htmlMatch[1].trim() : '';

      if (html.length > 100) {
        // Sauvegarde le HTML dans le projet
        fileStore.saveFile(context.tenantId, projectId, 'index.html', html);

        // Envoie le signal final avec le HTML complet
        sendSSE({
          type: 'done',
          updated: true,
          html,
          thinking: fullText.replace(/```[\s\S]*?```/g, '').trim()
        });
      } else {
        sendSSE({
          type: 'done',
          updated: false,
          error: "Aucun bloc HTML valide trouvé dans la réponse de l'IA.",
          thinking: fullText
        });
      }
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
