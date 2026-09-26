/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * Task Decomposition Engine & Deterministic Acyclic DAG Generator
 */

import { computeTaskGraphHash, deepFreeze } from '../canonical.js';
import type { AgentCapability, AgentDomain, AgentTask, EngineeringTaskGraph } from '../types.js';
import type { EngineeringPlan, IntentResult, PlanStep } from '../../conversation-intelligence/types.js';

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
            includeSemanticGraph: true
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
    if (step.targetDomain) {
      const td = step.targetDomain.toUpperCase();
      if (td === 'UI' || td === 'BACKEND' || td === 'DATA' || td === 'SECURITY' || td === 'TEST') {
        return td as AgentDomain;
      }
    }
    const text = `${step.description} ${step.targetFiles?.join(' ') || ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (text.includes('test') || text.includes('spec') || text.includes('assert')) {
      return 'TEST';
    }
    if (text.includes('auth') || text.includes('rbac') || text.includes('secret') || text.includes('security') || text.includes('securite') || text.includes('permission')) {
      return 'SECURITY';
    }
    if (text.includes('schema') || text.includes('database') || text.includes('bdd') || text.includes('donnee') || text.includes('db') || text.includes('model') || text.includes('entity') || text.includes('migration')) {
      return 'DATA';
    }
    if (text.includes('ui') || text.includes('page') || text.includes('view') || text.includes('component') || text.includes('css') || text.includes('tailwind') || text.includes('html') || text.includes('layout')) {
      return 'UI';
    }
    return 'BACKEND';
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
