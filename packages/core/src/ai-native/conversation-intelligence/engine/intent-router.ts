/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * ÉTAPE 33 — Routage déterministe Intention → Agent (Conversation → Agent)
 *
 * Routage MINIMAL et EXPLICABLE (aucun LLM, aucun scoring, aucun état) :
 * une intention conversationnelle clairement identifiable est routée vers le
 * reference-agent (contrat É32) ; tout ce qui dépasse le contrat de référence
 * est explicitement NON SUPPORTÉ (échec honnête, aucun agent exécuté).
 *
 * Règle (v1, volontairement bornée) :
 *   - le message utilisateur nomme EXACTEMENT UN fichier avec extension
 *     source connue (.ts/.tsx/.js/.jsx/.json/.md/.css/.html) ;
 *   - la catégorie d'intention est une opération de fichier exécutable
 *     (CREATE / MODIFY / DELETE / REFACTOR / DEBUG) ;
 *   → agentId 'reference-agent', AgentTask construit depuis l'intention.
 *   Sinon → UNSUPPORTED_INTENT (raison explicite), AUCUN agent exécuté.
 *
 * Contrats réutilisés (aucun second système) : IntentResult, AgentTask,
 * TaskContextPayload — exécution par AgentExecutionService (É32).
 */

import type { AgentTask, TaskContextPayload } from '../../ai-orchestrator/types.js';
import type { IntentResult } from '../types.js';

/** Agent cible du routage v1 (l'unique agent du contrat de référence). */
export const ROUTED_AGENT_ID = 'reference-agent';

/** Capacité requise pour le reference-agent (déclarée dans son contrat É32). */
export const ROUTED_AGENT_CAPABILITIES = ['SERVICE_LOGIC'] as const;

/** Catégories d'intention exécutables sur fichiers. */
const EXECUTABLE_CATEGORIES: ReadonlySet<string> = new Set([
  'CREATE', 'MODIFY', 'DELETE', 'REFACTOR', 'DEBUG'
]);

/** Extensions de fichiers reconnues par le contrat de référence. */
const SOURCE_FILE_PATTERN = /[\w][\w./-]*\.(?:ts|tsx|js|jsx|json|md|css|html)\b/gi;

export interface ConversationAgentRoute {
  readonly supported: boolean;
  readonly executionId: string;
  readonly agentId?: string | undefined;
  readonly task?: AgentTask | undefined;
  readonly context?: TaskContextPayload | undefined;
  readonly requiredCapabilities?: readonly string[] | undefined;
  /** Raison explicite du non-routage (unsupported). */
  readonly reason?: string | undefined;
}

export interface RouteIntentParams {
  readonly intent: IntentResult | undefined;
  /** Message utilisateur brut du tour (source du chemin de fichier). */
  readonly userMessage: string;
  readonly sessionId: string;
  readonly planId: string;
}

function mapOperation(category: string): 'CREATE' | 'MODIFY' | 'DELETE' {
  if (category === 'DELETE') return 'DELETE';
  if (category === 'CREATE') return 'CREATE';
  return 'MODIFY';
}

/**
 * Route une intention conversationnelle vers un agent (déterministe).
 * Même entrée → même route.
 */
export function routeIntentToAgent(params: RouteIntentParams): ConversationAgentRoute {
  const { intent, userMessage, sessionId, planId } = params;
  const executionId = `agx-${sessionId}-${planId}`;

  const unsupported = (reason: string): ConversationAgentRoute => ({
    supported: false,
    executionId,
    reason
  });

  if (!intent) {
    return unsupported('UNSUPPORTED_INTENT: aucune intention active dans la session');
  }
  if (!EXECUTABLE_CATEGORIES.has(intent.category)) {
    return unsupported(
      `UNSUPPORTED_INTENT: la catégorie d'intention '${intent.category}' n'est pas une opération de fichier exécutable par un agent`
    );
  }

  const normalized = userMessage.replace(/\s+/g, ' ');
  const matches = Array.from(new Set(normalized.match(SOURCE_FILE_PATTERN) ?? []));

  if (matches.length === 0) {
    return unsupported(
      'UNSUPPORTED_INTENT: aucun fichier cible nommé dans la demande (le contrat de référence exige un chemin de fichier explicite)'
    );
  }
  if (matches.length > 1) {
    return unsupported(
      `UNSUPPORTED_INTENT: ${matches.length} fichiers nommés (${matches.join(', ')}) — le contrat de référence ne traite qu'un seul fichier`
    );
  }

  const targetFile = matches[0]!;
  const operation = mapOperation(intent.category);
  const task: AgentTask = {
    id: `task-${executionId}`,
    title: intent.goal || `${operation} ${targetFile}`,
    description: userMessage.slice(0, 200),
    domain: 'ARCHITECTURE',
    priority: 1,
    dependencies: [],
    requiredContext: { targetFiles: [targetFile] },
    requiredCapabilities: [...ROUTED_AGENT_CAPABILITIES],
    status: 'READY',
    operation,
    retryCount: 0,
    maxRetries: 0
  };
  const context: TaskContextPayload = {
    relevantFiles: {},
    relevantSymbols: [],
    decisions: [],
    constraints: [],
    recentHistory: []
  };

  return {
    supported: true,
    executionId,
    agentId: ROUTED_AGENT_ID,
    task,
    context,
    requiredCapabilities: [...ROUTED_AGENT_CAPABILITIES]
  };
}
