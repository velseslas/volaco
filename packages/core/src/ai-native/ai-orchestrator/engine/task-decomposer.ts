/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * Task Decomposition Engine & Deterministic Acyclic DAG Generator
 */

import { computeTaskGraphHash, deepFreeze } from '../canonical.js';
import type { AgentCapability, AgentDomain, AgentTask, EngineeringTaskGraph } from '../types.js';
import type { EngineeringPlan, IntentResult, PlanStep } from '../../conversation-intelligence/types.js';

// ===========================================================================
// É45 — taxonomie de classification DÉTERMINISTE des spécialités.
//
// SOURCE UNIQUE partagée par le décomposeur AINT-010 (detectStepDomain) et
// le routage conversationnel É45 (intent-router / execution-bridge) :
// une seule liste de règles, un seul ordre de priorité, une seule sémantique
// de correspondance (includes() sur texte normalisé sans accents).
// L'ORDRE des règles EST la priorité : TEST > SECURITY > DATA > UI > BACKEND.
// ===========================================================================

/** Règles de mots-clés du TRAVAIL (pas du nom d'agent) → spécialité. */
export const STEP_DOMAIN_KEYWORD_RULES: readonly {
  readonly domain: AgentDomain;
  readonly keywords: readonly string[];
}[] = deepFreeze([
  { domain: 'TEST', keywords: ['test', 'spec', 'assert'] },
  { domain: 'SECURITY', keywords: ['auth', 'rbac', 'secret', 'security', 'securite', 'permission'] },
  { domain: 'DATA', keywords: ['schema', 'database', 'bdd', 'donnee', 'db', 'model', 'entity', 'migration'] },
  { domain: 'UI', keywords: ['ui', 'page', 'view', 'component', 'css', 'tailwind', 'html', 'layout'] },
  // É45 — BACKEND n'avait AUCUN mot-clé positif (il n'était que le fallback
  // final de l'heuristique) : ces mots du travail backend rendent la
  // spécialité DÉCLARABLE pour la désambiguïsation É45. NEUTRE pour
  // detectStepDomain : un texte ne matchant que ces mots retombait déjà sur
  // BACKEND via le fallback — l'issue AINT-010 est identique pour toute
  // entrée, seule la distinction « signal explicite / aucun signal » est
  // nouvelle (et seule elle intéresse le routage É45).
  { domain: 'BACKEND', keywords: ['api', 'service', 'endpoint', 'controller', 'route', 'server'] }
]) as readonly { readonly domain: AgentDomain; readonly keywords: readonly string[] }[];

/** Spécialités déclarables explicitement via PlanStep.targetDomain (gate AINT-010). */
export const DECLARABLE_STEP_DOMAINS: readonly AgentDomain[] = deepFreeze([
  'UI',
  'BACKEND',
  'DATA',
  'SECURITY',
  'TEST'
]) as readonly AgentDomain[];

/**
 * Gate pure targetDomain → AgentDomain (aucun fallback, aucune invention) :
 * les domaines MÉTIER (« dom_authentication », « core », …) ne sont JAMAIS
 * des spécialités d'agent et ne franchissent pas cette gate.
 */
export function resolveDeclaredTargetDomain(
  targetDomain: string | undefined | null
): AgentDomain | undefined {
  if (!targetDomain) return undefined;
  const td = targetDomain.toUpperCase();
  return (DECLARABLE_STEP_DOMAINS as readonly string[]).includes(td) ? (td as AgentDomain) : undefined;
}

/**
 * Scan par mots-clés PUR (même sémantique includes() que l'heuristique
 * AINT-010, texte normalisé sans accents, minuscule). AUCUN fallback :
 * aucun signal → undefined (l'appelant décide ; le routage É45 ne doit
 * jamais deviner une spécialité).
 */
export function detectDomainKeywords(text: string): AgentDomain | undefined {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  for (const rule of STEP_DOMAIN_KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) return rule.domain;
  }
  return undefined;
}

export class TaskDecomposer {
  public decomposePlan(
    plan: EngineeringPlan,
    intent?: IntentResult | undefined
  ): EngineeringTaskGraph {
    const tasks: AgentTask[] = [];

    // If plan has explicit steps, map them to specialized domain tasks
    if (plan.steps && plan.steps.length > 0) {
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i]!;
        const domain = this.detectStepDomain(step);
        const capabilities = this.resolveRequiredCapabilities(domain, step);
        const taskId = `task-${plan.planId}-${i + 1}-${domain.toLowerCase()}`;

        // Infer dependencies based on previous steps and domain topology
        const dependencies: string[] = [];
        if (i > 0) {
          // By default, depend on the immediate prior step if it targets overlapping files
          const prior = plan.steps[i - 1]!;
          const priorTaskId = `task-${plan.planId}-${i}-${this.detectStepDomain(prior).toLowerCase()}`;
          dependencies.push(priorTaskId);
        }

        tasks.push({
          id: taskId,
          title: step.description,
          description: `Exécution outillée pour : ${step.description} (Opération: ${step.operation})`,
          domain,
          priority: Math.max(1, 10 - i),
          dependencies,
          requiredContext: {
            targetFiles: step.targetFiles ?? [],
            includeSemanticModel: true,
            includeSemanticGraph: true,
            // CDC V8 §11 — les tâches UI lisent aussi le Design DNA réel du
            // projet (tokens/direction/règles) quand un rapport existe.
            ...(domain === 'UI' ? { includeDna: true } : {})
          },
          requiredCapabilities: capabilities,
          operation: step.operation,
          status: 'QUEUED',
          retryCount: 0,
          maxRetries: 3
        });
      }
    } else {
      // Decompose intent into a standard 4-phase engineering DAG: Data -> Backend -> UI -> Test
      const baseId = `task-${Date.now().toString(36)}`;
      const dataTaskId = `${baseId}-1-data`;
      const beTaskId = `${baseId}-2-backend`;
      const uiTaskId = `${baseId}-3-ui`;
      const secTaskId = `${baseId}-4-security`;
      const testTaskId = `${baseId}-5-test`;

      const goal = intent?.goal || plan.title || 'Développement de solution';

      tasks.push(
        {
          id: dataTaskId,
          title: `Modélisation des schémas de données pour : ${goal}`,
          description: 'Définition des entités, types et contrats de persistance.',
          domain: 'DATA',
          priority: 9,
          dependencies: [],
          requiredContext: { includeSemanticModel: true },
          requiredCapabilities: ['SCHEMA_MODELING', 'DATA_INTEGRITY'],
          status: 'QUEUED',
          retryCount: 0,
          maxRetries: 3
        },
        {
          id: beTaskId,
          title: `Implémentation des services backend pour : ${goal}`,
          description: 'Création des endpoints d API, logique métier et validation.',
          domain: 'BACKEND',
          priority: 8,
          dependencies: [dataTaskId],
          requiredContext: { includeSemanticModel: true, includeSemanticGraph: true },
          requiredCapabilities: ['API_DESIGN', 'SERVICE_LOGIC'],
          status: 'QUEUED',
          retryCount: 0,
          maxRetries: 3
        },
        {
          id: secTaskId,
          title: `Audit de sécurité et RBAC pour : ${goal}`,
          description: 'Vérification de l authentification, contrôle des accès et isolation multi-tenant.',
          domain: 'SECURITY',
          priority: 7,
          dependencies: [beTaskId],
          requiredContext: { includeSemanticModel: true },
          requiredCapabilities: ['AUTH_RBAC', 'VULNERABILITY_SCAN'],
          status: 'QUEUED',
          retryCount: 0,
          maxRetries: 3
        },
        {
          id: uiTaskId,
          title: `Conception de l interface utilisateur pour : ${goal}`,
          description: 'Génération des vues interactives, composants responsive et styling Tailwind.',
          domain: 'UI',
          priority: 6,
          dependencies: [beTaskId],
          requiredContext: { includeDna: true },
          requiredCapabilities: ['PAGE_GENERATION', 'COMPONENT_STYLING', 'RESPONSIVE_LAYOUT'],
          status: 'QUEUED',
          retryCount: 0,
          maxRetries: 3
        },
        {
          id: testTaskId,
          title: `Élaboration des tests automatisés pour : ${goal}`,
          description: 'Génération de la suite de tests unitaires et scénarios de non-régression.',
          domain: 'TEST',
          priority: 5,
          dependencies: [uiTaskId, secTaskId],
          requiredContext: { includeSemanticModel: true },
          requiredCapabilities: ['UNIT_TEST_GEN', 'INTEGRATION_TEST'],
          status: 'QUEUED',
          retryCount: 0,
          maxRetries: 3
        }
      );
    }

    const isAcyclic = this.verifyAcyclicity(tasks);
    const rootTaskIds = tasks.filter((t) => t.dependencies.length === 0).map((t) => t.id);
    const graphHash = computeTaskGraphHash(tasks);

    return deepFreeze({
      graphId: `graph-${plan.planId || 'adhoc'}-${Date.now().toString(36)}`,
      planId: plan.planId || 'adhoc-plan',
      tasks,
      rootTaskIds,
      graphHash,
      isAcyclic
    });
  }

  public detectStepDomain(step: PlanStep): AgentDomain {
    const declared = resolveDeclaredTargetDomain(step.targetDomain);
    if (declared) return declared;
    const text = `${step.description} ${step.targetFiles?.join(' ') || ''}`;
    return detectDomainKeywords(text) ?? 'BACKEND';
  }

  public resolveRequiredCapabilities(domain: AgentDomain, step: PlanStep): readonly AgentCapability[] {
    switch (domain) {
      case 'UI':
        return ['PAGE_GENERATION', 'COMPONENT_STYLING', 'RESPONSIVE_LAYOUT'];
      case 'BACKEND':
        return ['API_DESIGN', 'SERVICE_LOGIC'];
      case 'DATA':
        return ['SCHEMA_MODELING', 'DATA_INTEGRITY'];
      case 'SECURITY':
        return ['AUTH_RBAC', 'VULNERABILITY_SCAN'];
      case 'TEST':
        return ['UNIT_TEST_GEN', 'INTEGRATION_TEST'];
      default:
        return ['SERVICE_LOGIC'];
    }
  }

  public verifyAcyclicity(tasks: readonly AgentTask[]): boolean {
    const adj = new Map<string, string[]>();
    for (const t of tasks) {
      adj.set(t.id, [...t.dependencies]);
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();

    const dfs = (node: string): boolean => {
      visited.add(node);
      recStack.add(node);

      const neighbors = adj.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (recStack.has(neighbor)) {
          return true; // Cycle detected
        }
      }

      recStack.delete(node);
      return false;
    };

    for (const task of tasks) {
      if (!visited.has(task.id)) {
        if (dfs(task.id)) {
          return false; // Not acyclic
        }
      }
    }

    return true; // Strictly acyclic
  }
}
