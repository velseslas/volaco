/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * ÉTAPE 34 — Routage déterministe Intention → Agent via le REGISTRY
 *
 * Évolution É33 : l'agentId n'est PLUS en dur. Le routeur demande au
 * Registry (source unique É34) les agents compatibles avec la capability
 * requise par l'intention :
 *
 *   intention fichier (CREATE/MODIFY/DELETE/REFACTOR/DEBUG) + exactement
 *   un fichier source nommé → capability 'FILE_MUTATION' → resolveByCapability
 *     0 candidat  → UNSUPPORTED_AGENT_CAPABILITY
 *     >1 candidat → AMBIGUOUS_AGENT_ROUTE (candidats listés, pas de choix
 *                   arbitraire)
 *     1 candidat  → route vers cet agent
 *
 * Aucun LLM de routage. Mêmes entrées → même route.
 */

import type { AgentTask, TaskContextPayload, AgentCapability } from '../../ai-orchestrator/types.js';
import type { AgentRegistryService } from '../../ai-orchestrator/registry/agent-registry.js';
import type { IntentResult } from '../types.js';

/**
 * Capability requise pour muter un fichier via le contrat de référence
 * (déclarée uniquement par le reference-agent — v1 sans ambiguïté).
 */
export const FILE_MUTATION_CAPABILITY: AgentCapability = 'FILE_MUTATION';

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
  /** Raison explicite du non-routage (unsupported/ambiguous). */
  readonly reason?: string | undefined;
}

export interface RouteIntentParams {
  readonly intent: IntentResult | undefined;
  /** Message utilisateur brut du tour (source du chemin de fichier). */
  readonly userMessage: string;
  readonly sessionId: string;
  readonly planId: string;
  /** ÉTAPE 34 — le Registry est la source de résolution des agents. */
  readonly registry: AgentRegistryService;
}

function mapOperation(category: string): 'CREATE' | 'MODIFY' | 'DELETE' {
  if (category === 'DELETE') return 'DELETE';
  if (category === 'CREATE') return 'CREATE';
  return 'MODIFY';
}

/**
 * Route une intention conversationnelle vers un agent du Registry
 * (déterministe). Même entrée → même route.
 */
export function routeIntentToAgent(params: RouteIntentParams): ConversationAgentRoute {
  const { intent, userMessage, sessionId, planId, registry } = params;
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

  // ÉTAPE 34 — résolution par capability via le Registry (aucun agentId en dur).
  const candidates = registry.resolveByCapability(FILE_MUTATION_CAPABILITY);
  if (candidates.length === 0) {
    return unsupported(
      `UNSUPPORTED_AGENT_CAPABILITY: aucun agent du registry ne possède la capability '${FILE_MUTATION_CAPABILITY}'`
    );
  }
  if (candidates.length > 1) {
    return unsupported(
      `AMBIGUOUS_AGENT_ROUTE: ${candidates.length} agents compatibles '${FILE_MUTATION_CAPABILITY}' [${candidates.map((c) => c.id).join(', ')}] — aucun choix arbitraire`
    );
  }

  const candidate = candidates[0]!;
  const targetFile = matches[0]!;
  const operation = mapOperation(intent.category);
  const task: AgentTask = {
    id: `task-${executionId}`,
    title: intent.goal || `${operation} ${targetFile}`,
    description: userMessage.slice(0, 200),
    domain: candidate.domain,
    priority: 1,
    dependencies: [],
    requiredContext: { targetFiles: [targetFile] },
    requiredCapabilities: [FILE_MUTATION_CAPABILITY],
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
    agentId: candidate.id,
    task,
    context,
    requiredCapabilities: [FILE_MUTATION_CAPABILITY]
  };
}
