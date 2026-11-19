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
import type { AgentRegistryService, RegisteredAgent } from '../../ai-orchestrator/registry/agent-registry.js';
import { detectDomainKeywords, resolveDeclaredTargetDomain } from '../../ai-orchestrator/engine/task-decomposer.js';
import type { IntentResult, ConversationAssumption } from '../types.js';

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
  /**
   * É48 — cible déclarée par le PLAN approuvé (étape de mutation unique),
   * utilisée UNIQUEMENT quand le message du tour n'en nomme aucune. Ce n'est
   * JAMAIS une substitution à un fichier nommé par l'utilisateur (aucun
   * message multi-fichiers réécrit) : c'est le réancrage du routage sur le
   * contrat approuvé quand le tour porteur du plan ne répète pas le chemin
   * (précision, rappel d'interdiction, question post-planification). Absent
   * ou ambigu (0 ou ≥2 cibles de mutation) → comportement historique.
   */
  readonly fallbackTargetFile?: string | undefined;
  /**
   * É48 — étape de mutation unique du PLAN approuvé (title + targetFile +
   * targetDomain) : source de la désambiguïsation de spécialité, EXACTEMENT
   * la sémantique du chemin batch É45 (`déclaré d'abord, taxonomie
   * titre+cible ensuite`). Les mots-clés de spécialité scannent le texte par
   * sous-chaîne : un message de PRÉCISION (« doit respecter l'accessibilité »)
   * contient « spec » à l'intérieur de « respecter » et classait le travail
   * en spécialité TEST — le TRAVAIL approuvé (titre + cible du plan) est la
   * source fidèle. Absente → comportement historique (mots-clés du message).
   */
  readonly planMutationStep?:
    | {
        readonly title: string;
        readonly targetFile: string;
        readonly targetDomain?: string | undefined;
      }
    | undefined;
  /** ÉTAPE 34 — le Registry est la source de résolution des agents. */
  readonly registry: AgentRegistryService;
  /**
   * É44 — contexte conversationnel de la session (OPTIONNEL pour rester
   * rétrocompatible : absent → tâche et contexte IDENTIQUES à l'historique).
   * Présent → contraintes/décisions remplissent le TaskContextPayload ET la
   * description porte le bloc de contexte tracé.
   */
  readonly conversation?: ConversationTaskContext | undefined;
}

function mapOperation(category: string): 'CREATE' | 'MODIFY' | 'DELETE' {
  if (category === 'DELETE') return 'DELETE';
  if (category === 'CREATE') return 'CREATE';
  return 'MODIFY';
}

// ===========================================================================
// É44 — contexte conversationnel transmis aux tâches (fidélité de trace)
//
// Le scheduler É37 (gelé) ne transmet AUCUN contexte conversationnel : le
// seul canal disponible est la TÂCHE elle-même (description +, pour le chemin
// routé, TaskContextPayload). Ce bloc porte la demande ACTIVE de
// l'utilisateur — contraintes actives, décisions actives, hypothèses
// marquées comme telles — afin qu'aucun agent ne puisse interpréter une
// hypothèse comme une décision, une ancienne demande comme la demande
// active, ou l'absence d'information comme une autorisation d'inventer.
// Déterministe : mêmes entrées → même bloc (aucun horodatage, aucun hasard).
// ===========================================================================

/** Contexte conversationnel réel à tracer dans les tâches (source : session). */
export interface ConversationTaskContext {
  /** Contraintes actives de la mémoire de session (chaînes BRUTES — fidélité É42). */
  readonly constraints: readonly string[];
  /** Statements des décisions au statut ACTIVE uniquement. */
  readonly decisions: readonly string[];
  /** Hypothèses NON rejetées (statut conservé : PROPOSED n'est PAS une décision). */
  readonly assumptions: readonly ConversationAssumption[];
}

function dedupeStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values));
}

/**
 * Bloc de contexte tracé, déterministe. Rien à transmettre → '' (chaîne
 * vide : la description reste IDENTIQUE au comportement historique).
 */
export function buildConversationContextBlock(
  conversation: ConversationTaskContext | undefined | null
): string {
  if (!conversation) return '';
  const constraints = dedupeStrings(conversation.constraints);
  const decisions = dedupeStrings(conversation.decisions);
  const assumptions = conversation.assumptions ?? [];
  if (constraints.length === 0 && decisions.length === 0 && assumptions.length === 0) {
    return '';
  }
  const lines: string[] = ['Contexte conversationnel à respecter (demande active de l utilisateur) :'];
  if (constraints.length > 0) {
    lines.push(`Contraintes actives (OBLIGATOIRES) : ${constraints.map((c) => `«${c}»`).join(' ; ')}`);
  }
  if (decisions.length > 0) {
    lines.push(`Décisions actives (à appliquer) : ${decisions.map((d) => `«${d}»`).join(' ; ')}`);
  }
  const proposed = assumptions.filter((a) => a.status === 'PROPOSED');
  const confirmed = assumptions.filter((a) => a.status === 'CONFIRMED');
  if (proposed.length > 0) {
    lines.push(
      `Hypothèses NON confirmées (à ne PAS traiter comme des décisions — ne rien inventer à partir d une absence) : ` +
        `${proposed.map((a) => `«${a.statement}»`).join(' ; ')}`
    );
  }
  if (confirmed.length > 0) {
    lines.push(`Hypothèses confirmées : ${confirmed.map((a) => `«${a.statement}»`).join(' ; ')}`);
  }
  return `\n${lines.join('\n')}`;
}

/**
 * É40 — extraction réutilisable des chemins de fichiers source nommés dans
 * un texte (MÊME pattern que le routage É33/É34 : une seule définition de
 * « qu'est-ce qu'un fichier cible nommé »). Ordre de préservation : les
 * fichiers sortent dans l'ordre d'apparition dans le texte (l'ordre de
 * l'énumération de l'utilisateur), dédupliqués.
 */
export function extractSourceFiles(text: string): readonly string[] {
  const normalized = text.replace(/\s+/g, ' ');
  return Array.from(new Set(normalized.match(SOURCE_FILE_PATTERN) ?? []));
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

  // É40 — extraction des fichiers via la fonction partagée (définition
  // unique du pattern, même sémantique que le générateur de plans).
  // É48 — repli sur la cible DÉCLARÉE par le plan approuvé uniquement
  // quand le message n'en nomme aucune (0 fichier extrait). Un message qui
  // en nomme 2 reste un refus AMBIGU historique — jamais réécrit.
  const extracted = extractSourceFiles(userMessage);
  const matches =
    extracted.length > 0
      ? [...extracted]
      : params.fallbackTargetFile
        ? [params.fallbackTargetFile]
        : [];

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
  // É45 — désambiguïsation par SPÉCIALITÉ DÉCLARÉE : dès que ≥2 agents
  // FILE_MUTATION coexistent, le travail énoncé (message utilisateur) est
  // classé par la taxonomie déterministe partagée AINT-010/É45 (mots-clés du
  // TRAVAIL, jamais le nom d'un agent). Une spécialité résolvable désignant
  // EXACTEMENT UN agent tranche le choix ; sans spécialité résolvable, le
  // refus historique AMBIGUOUS_AGENT_ROUTE est conservé TEL QUEL (aucun
  // choix arbitraire, aucun fallback, aucune activation superflue).
  const candidates = registry.resolveByCapability(FILE_MUTATION_CAPABILITY);
  let candidate: RegisteredAgent;
  if (candidates.length === 0) {
    return unsupported(
      `UNSUPPORTED_AGENT_CAPABILITY: aucun agent du registry ne possède la capability '${FILE_MUTATION_CAPABILITY}'`
    );
  }
  if (candidates.length === 1) {
    candidate = candidates[0]!;
  } else {
    // É48 — désambiguïsation par spécialité sur le TRAVAIL DU PLAN approuvé :
    // la spécialité DÉCLARÉE d'abord, la taxonomie déterministe sur
    // titre + cible ensuite — EXACTEMENT la sémantique du chemin batch É45
    // (analyzePlanForBatch section 5). Le message du tour ne sert qu'en
    // repli historique (aucune étape de plan transmise). Un message de
    // PRÉCISION (« doit respecter l'accessibilité ») ne définit plus la
    // spécialité d'un travail qu'il ne décrit pas.
    const declared = params.planMutationStep
      ? resolveDeclaredTargetDomain(params.planMutationStep.targetDomain)
      : undefined;
    const domain = declared
      ?? (params.planMutationStep
        ? detectDomainKeywords(`${params.planMutationStep.title} ${params.planMutationStep.targetFile}`)
        : detectDomainKeywords(userMessage));
    if (!domain) {
      return unsupported(
        `AMBIGUOUS_AGENT_ROUTE: ${candidates.length} agents compatibles '${FILE_MUTATION_CAPABILITY}' [${candidates.map((c) => c.id).join(', ')}] — aucun choix arbitraire`
      );
    }
    const domainCandidates = candidates.filter((c) => c.domain === domain);
    if (domainCandidates.length === 0) {
      return unsupported(
        `UNSUPPORTED_AGENT_CAPABILITY_DOMAIN: ${candidates.length} agents possèdent '${FILE_MUTATION_CAPABILITY}' [${candidates.map((c) => c.id).join(', ')}] mais AUCUN agent du domaine '${domain}' requis par le travail n'en possède — la spécialité '${domain}' n'est pas couverte`
      );
    }
    if (domainCandidates.length > 1) {
      return unsupported(
        `AMBIGUOUS_AGENT_ROUTE: ${domainCandidates.length} agents du domaine '${domain}' compatibles '${FILE_MUTATION_CAPABILITY}' [${domainCandidates.map((c) => c.id).join(', ')}] — aucun choix arbitraire`
      );
    }
    candidate = domainCandidates[0]!;
  }
  const targetFile = matches[0]!;
  const operation = mapOperation(intent.category);
  // É44 — la description porte le bloc de contexte tracé (bloc vide →
  // description STRICTEMENT identique au comportement historique).
  const description =
    userMessage.slice(0, 200) + buildConversationContextBlock(params.conversation);
  const task: AgentTask = {
    id: `task-${executionId}`,
    title: intent.goal || `${operation} ${targetFile}`,
    description,
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
  // É44 — le TaskContextPayload porte les contraintes de l'intention DU TOUR
  // ET les contraintes actives de la mémoire de session (dédupliquées, ordre
  // de conversation préservé) ; les décisions actives complètent le payload.
  // Absent de conversation → contraintes de l'intention seules (défaut avant
  // É44 = tableau vide, inchangé quand l'intention n'en porte pas).
  const context: TaskContextPayload = {
    relevantFiles: {},
    relevantSymbols: [],
    decisions: [...(params.conversation?.decisions ?? [])],
    constraints: dedupeStrings([
      ...(intent.constraints ?? []),
      ...(params.conversation?.constraints ?? [])
    ]),
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
