/**
 * VibeCode Core - API Tier
 * PHASE 9.5 — Decision Engine Route
 *
 * Expose le DecisionEngine via une route HTTP.
 * L'utilisateur (ou le Studio) envoie un Intent + le texte du message,
 * la route :
 *   1. Appelle l'IntelligencePool pour collecter les recommendations consultatives
 *   2. Appelle le DecisionEngine pour produire un Decision (READY / NEEDS_CONFIRMATION / BLOCKED / DEFERRED)
 *   3. Calcule le next state via le ConversationCompass piloté par le Decision
 *   4. Retourne { decision, nextState, recommendations }
 *
 * C'est la SEULE autorité décisionnelle du système.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ValidationError } from '../../../../packages/core/src/errors.js';
import { assertPermission } from '../../../../packages/core/src/identity/permissions.js';
import { logger } from '../../../../packages/core/src/logger.js';
import type { RequestContext } from '../middleware/auth.js';
import type { IntentResult, ProjectMemory } from '../../../../packages/core/src/ai-native/conversation-intelligence/types.js';
import type { DecisionEngine } from '../../../../packages/core/src/ai-native/decision-engine/decision-engine.js';
import type { Decision, DecisionVerdict } from '../../../../packages/core/src/ai-native/decision-engine/types.js';
import { matchMemorySignals, type MemorySignals } from '../../../../packages/core/src/ai-native/decision-engine/memory-signals.js';
import type { AnalystRegistry } from '../../../../packages/core/src/ai-native/intelligence-pool/analysts/index.js';
import type { IntelligenceRecommendation } from '../../../../packages/core/src/ai-native/intelligence-pool/types.js';
import type { FileStore } from '../../../../packages/core/src/file-explorer/store.js';
import { ConversationCompass } from '../../../../packages/core/src/ai-native/conversation-intelligence/engine/conversation-compass.js';

import { readBody } from '../middleware/body.js';
interface DecideRouteDeps {
  decisionEngine: DecisionEngine;
  analystRegistry: AnalystRegistry;
  fileStore: FileStore;
}

let deps: DecideRouteDeps | undefined;
const compass = new ConversationCompass();

export function configureDecideRoute(d: DecideRouteDeps): void {
  deps = d;
  logger.info('DecisionEngine route configurée (Phase 9.5)', { component: 'decide-route' });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function emptyMemory(): ProjectMemory {
  return {
    architecturalDecisions: [],
    userPreferences: {},
    acceptedPlans: [],
    rejectedPlans: [],
    knownConstraints: [],
    knownConventions: [],
    knownRisks: []
  };
}

/**
 * V7-WIRE-3 — DÉCISION CONSULTATIVE DANS LE FLUX.
 *
 * Le DecisionEngine reste l'autorité de la route POST /decide (décision
 * persistée dans le ledger). Le flux de génération appelle le même moteur en
 * mode consultatif : décision réelle (contraintes + alternatives +
 * contradictions), SANS écriture par défaut.
 *
 * CDC §15 — LOT ADR AUTO (2026-11-03, audit moteurs) : `record: true` active
 * l'enregistrement automatique de la décision consultative au ledger. Le
 * mode consultatif par défaut reste intact (aucune écriture). L'appelant du
 * flux active le flag UNIQUEMENT quand (a) on n'est pas sous node:test (PORTE
 * anti-pollution des suites), (b) la catégorie d'intention change réellement
 * l'application (CREATE/MODIFY/DELETE/REFACTOR), (c) l'interrupteur
 * `VOLACO_DECISION_AUTORECORD` n'est pas à '0'.
 *
 * La déduplication protège le ledger de la croissance par génération : si une
 * décision ACTIVE du projet porte déjà la MÊME catégorie et le MÊME but, le
 * doublon n'est pas enregistré (note `recordNote` tracée). Le verdict
 * `recorded` devient donc honnête : `true` = écrit, `false` = consultatif ou
 * doublon.
 */
export interface AdvisoryDecisionInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly intent: IntentResult;
  /** Mémoire projet réelle ; absente = mémoire vide, jamais un faux historique. */
  readonly memory?: ProjectMemory | undefined;
  /**
   * CDC §15 — ADR auto : `true` = enregistrer la décision au ledger après
   * déduplication (défaut `undefined` = consultatif pur, comportement historique).
   */
  readonly record?: boolean | undefined;
}

export interface AdvisoryDecisionSummary {
  readonly decisionId: string;
  readonly verdict: DecisionVerdict;
  readonly intentCategory: string;
  readonly intentGoal: string;
  readonly alternatives: number;
  readonly viableAlternatives: number;
  readonly chosenAlternative: {
    readonly label: string;
    readonly riskScore: number;
    readonly reversible: boolean;
    readonly estimatedEffort: 'LOW' | 'MEDIUM' | 'HIGH';
  } | null;
  readonly requiredClarifications: readonly string[];
  readonly contradictingDecisions: number;
  readonly rationale: string;
  /** Signaux mémoire réellement transmis au moteur. */
  readonly memory: MemorySignals;
  /**
   * CDC §15 — ADR auto : `true` = décision écrite au Decision Ledger ;
   * `false` = mode consultatif OU doublon dédupliqué (voir `recordNote`).
   */
  readonly recorded: boolean;
  /** Raison d'un non-enregistrement en mode ADR auto (doublon, ledger indisponible). */
  readonly recordNote?: string;
}

export async function produceAdvisoryDecision(
  input: AdvisoryDecisionInput
): Promise<AdvisoryDecisionSummary | null> {
  if (!deps) return null;

  const memory = input.memory ?? emptyMemory();

  // CDC §15 — ADR auto avec déduplication : on enregistre UNIQUEMENT si
  // aucune décision ACTIVE du projet ne porte déjà la même catégorie et le
  // même but (anti-pollution du ledger, cf. commentaire de bloc ci-dessus).
  // En cas d'échec de lecture du ledger, on NE PASSE PAS en aveugle : rien
  // n'est écrit, une note honnête est tracée.
  let record = false;
  let recordNote: string | undefined;
  if (input.record === true) {
    try {
      const actives = deps.decisionEngine.getHistory(input.projectId);
      const duplicate = actives.some(
        (d) => d.intentCategory === input.intent.category && d.intentGoal === input.intent.goal
      );
      if (duplicate) {
        recordNote = 'doublon ignoré (décision active identique)';
      } else {
        record = true;
      }
    } catch (ledgerError) {
      recordNote =
        'ledger indisponible, rien enregistré (' +
        (ledgerError instanceof Error ? ledgerError.message : String(ledgerError)) +
        ')';
    }
  }

  const decision = await deps.decisionEngine.decide(
    {
      intent: input.intent,
      projectId: input.projectId,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      memory,
      intelligenceRecommendations: []
    },
    { record }
  );

  const viable = decision.alternatives.filter((a) => a.constraintsViolated.length === 0);
  return {
    decisionId: decision.decisionId,
    verdict: decision.verdict,
    intentCategory: decision.intentCategory,
    intentGoal: decision.intentGoal,
    alternatives: decision.alternatives.length,
    viableAlternatives: viable.length,
    chosenAlternative: decision.chosenAlternative
      ? {
          label: decision.chosenAlternative.label,
          riskScore: decision.chosenAlternative.riskScore,
          reversible: decision.chosenAlternative.reversible,
          estimatedEffort: decision.chosenAlternative.estimatedEffort
        }
      : null,
    requiredClarifications: decision.requiredClarifications,
    contradictingDecisions: decision.contradictingDecisions.length,
    rationale: decision.rationale,
    memory: decision.memorySignals ?? matchMemorySignals(input.intent, memory),
    recorded: record,
    ...(recordNote ? { recordNote } : {})
  };
}

/**
 * Si le body ne contient pas d'Intent déjà classifié, on en construit un
 * minimaliste à partir du message (utile pour tests rapides sans LLM).
 */
function buildFallbackIntent(message: string, projectId: string): IntentResult {
  const lower = message.toLowerCase();
  let category: IntentResult['category'] = 'UNKNOWN';
  if (/\b(crée|ajoute|génère|créer|générer|add|create)\b/.test(lower)) category = 'CREATE';
  else if (/\b(modifie|change|édite|update|modify)\b/.test(lower)) category = 'MODIFY';
  else if (/\b(supprime|efface|delete|remove)\b/.test(lower)) category = 'DELETE';
  else if (/\b(refactor|nettoy|clean)\b/.test(lower)) category = 'REFACTOR';
  else if (/\b(debug|corrig|fix)\b/.test(lower)) category = 'DEBUG';
  else if (/\b(analy|analyser|audit)\b/.test(lower)) category = 'ANALYZE';
  else if (/\b(expliqu|expliquer|explique|explain)\b/.test(lower)) category = 'EXPLAIN';
  else if (/\b(question|comment|pourquoi|what|why|how)\b/.test(lower)) category = 'QUESTION';
  else if (/\b(test|teste|tester)\b/.test(lower)) category = 'TEST';
  else if (/\b(déploie|deploy|publish|publish)\b/.test(lower)) category = 'DEPLOYMENT';

  return {
    category,
    goal: message.slice(0, 200),
    requestedAction: message,
    entities: [],
    constraints: [],
    urgency: 'NORMAL',
    confidence: 0.5,
    ambiguities: []
  };
}

export async function handleDecideRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RequestContext,
  requestId: string
): Promise<boolean> {
  // POST /api/v1/projects/:projectId/decide
  if (!pathname.includes('/decide') || req.method !== 'POST') {
    return false;
  }

  assertPermission(context.role, 'PROJECT_READ', requestId);

  if (!deps) {
    sendJson(res, 503, {
      message: 'DecisionEngine route non configurée. Redémarrez le serveur.',
      requestId
    });
    return true;
  }

  // Extract projectId from path: /api/v1/projects/:projectId/decide
  const parts = pathname.split('/');
  const projectId = parts[4];

  if (!projectId) {
    sendJson(res, 400, { message: 'projectId manquant dans l\'URL', requestId });
    return true;
  }

  const bodyText = await readBody(req);
  let body: {
    message: string;
    intent?: IntentResult;
    sessionId?: string;
    files?: Array<{ path: string; content: string }>;
    feedback?: Array<{ message: string; sentiment: string }>;
  };

  try {
    body = bodyText
      ? (JSON.parse(bodyText) as typeof body)
      : { message: '' };
  } catch {
    throw new ValidationError('JSON invalide dans le corps de la requête', undefined, requestId);
  }

  if (!body.message && !body.intent) {
    sendJson(res, 400, {
      message: 'Le champ "message" ou "intent" est obligatoire',
      requestId
    });
    return true;
  }

  const intent = body.intent || buildFallbackIntent(body.message, projectId);
  const sessionId = body.sessionId || `sess-${Date.now().toString(36)}`;

  logger.info('Decision demandée', {
    component: 'decide-route',
    tenantId: context.tenantId,
    projectId,
    sessionId,
    intentCategory: intent.category,
    hasFiles: !!body.files
  });

  try {
    // 1. Récupérer les fichiers du projet (depuis le body ou le FileStore)
    let files = body.files;
    if (!files) {
      try {
        const allFiles = deps.fileStore.getAllProjectFiles(context.tenantId, projectId);
        files = Object.entries(allFiles).map(([path, content]) => ({ path, content }));
      } catch {
        files = [];
      }
    }

    // 2. Appeler l'IntelligencePool (consultatif)
    const recommendations: readonly IntelligenceRecommendation[] = await deps.analystRegistry.analyzeAll({
      projectId,
      tenantId: context.tenantId,
      files: files || [],
      feedback: body.feedback,
      memory: emptyMemory(),
      userIntent: body.message
    });

    logger.info('IntelligencePool analysis', {
      component: 'decide-route',
      recommendations: recommendations.length,
      sources: Array.from(new Set(recommendations.map((r) => r.source)))
    });

    // 3. Appeler le DecisionEngine
    const decision: Decision = await deps.decisionEngine.decide({
      intent,
      projectId,
      tenantId: context.tenantId,
      sessionId,
      memory: emptyMemory(),
      intelligenceRecommendations: recommendations
    });

    // 4. Calculer le next state via le Compass piloté par le Decision
    const currentState = 'EXPLORING' as const; // Phase 9.5 : on démarre depuis EXPLORING
    const nextState = compass.determineNextStateWithDecision({
      currentState,
      intent,
      decision
    });

    logger.info('Decision terminée', {
      component: 'decide-route',
      decisionId: decision.decisionId,
      verdict: decision.verdict,
      nextState,
      alternatives: decision.alternatives.length,
      chosen: decision.chosenAlternative?.label || 'none'
    });

    sendJson(res, 200, {
      decision,
      recommendations,
      nextState,
      reasoningTrace: [
        `Intent classifié: ${intent.category} (confidence=${intent.confidence.toFixed(2)})`,
        `${recommendations.length} recommendations consultatives collectées`,
        `${decision.alternatives.length} alternatives générées (${decision.alternatives.filter((a) => a.constraintsViolated.length === 0).length} viables)`,
        `Verdict: ${decision.verdict}`,
        `Next state: ${nextState}`
      ],
      requestId
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Échec de decision', {
      component: 'decide-route',
      error: message,
      requestId
    });
    sendJson(res, 500, { message: `Erreur de décision: ${message}`, requestId });
    return true;
  }
}
