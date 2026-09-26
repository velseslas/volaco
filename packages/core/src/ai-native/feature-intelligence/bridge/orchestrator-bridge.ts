/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Orchestrator Bridge - Translates Accepted Features into Engineering Task Graphs (AINT-010)
 */

import { createHash } from 'node:crypto';
import type { AgentTask, EngineeringTaskGraph, AgentDomain, AgentCapability } from '../../ai-orchestrator/types.js';
import type { FeatureCandidate, ProposedFeaturePlan } from '../types.js';

export class FeatureOrchestratorBridge {
  /**
   * Convertit un FeatureCandidate accepté en un graphe de tâches d'ingénierie prêt pour AINT-010
   */
  public createEngineeringPlan(candidate: FeatureCandidate): ProposedFeaturePlan {
    const planId = `fplan-${candidate.id}`;
    const tasks: AgentTask[] = [];

    // 1. Tâche d'analyse / spécification
    const taskSpecId = `${planId}-task-spec`;
    tasks.push({
      id: taskSpecId,
      title: `Spécification technique : ${candidate.title}`,
      description: `Rédiger le contrat d interface et planifier les modifications pour ${candidate.title}`,
      domain: 'ARCHITECTURE',
      priority: 1,
      dependencies: [],
      requiredContext: {
        targetFiles: candidate.impact.affectedFiles,
        includeSemanticModel: true,
        maxTokensBudget: 2000
      },
      requiredCapabilities: ['SERVICE_LOGIC', 'IMPACT_ASSESSMENT'],
      status: 'READY',
      operation: 'ANALYZE',
      retryCount: 0,
      maxRetries: 2
    });

    // 2. Tâche de développement UI ou Backend selon la catégorie
    const isUiDominant = candidate.category === 'UX_IMPROVEMENT' || candidate.category === 'DESIGN_HARMONY';
    const primaryDomain: AgentDomain = isUiDominant ? 'UI' : 'BACKEND';
    const primaryCapability: AgentCapability = isUiDominant ? 'COMPONENT_STYLING' : 'SERVICE_LOGIC';

    const taskImplId = `${planId}-task-impl`;
    tasks.push({
      id: taskImplId,
      title: `Implémentation : ${candidate.title}`,
      description: candidate.specification.proposedSolution,
      domain: primaryDomain,
      priority: 2,
      dependencies: [taskSpecId],
      requiredContext: {
        targetFiles: candidate.impact.affectedFiles,
        maxTokensBudget: 4000
      },
      requiredCapabilities: [primaryCapability],
      status: 'QUEUED',
      operation: 'CREATE',
      retryCount: 0,
      maxRetries: 3
    });

    // 3. Tâche de tests unitaires / vérification
    const taskTestId = `${planId}-task-test`;
    tasks.push({
      id: taskTestId,
      title: `Validation & Tests : ${candidate.title}`,
      description: `Créer la suite de tests et vérifier les critères de succès : ${candidate.specification.successCriteria.join(', ')}`,
      domain: 'TEST',
      priority: 3,
      dependencies: [taskImplId],
      requiredContext: {
        targetFiles: candidate.impact.affectedFiles,
        maxTokensBudget: 2500
      },
      requiredCapabilities: ['UNIT_TEST_GEN'],
      status: 'QUEUED',
      operation: 'VERIFY',
      retryCount: 0,
      maxRetries: 2
    });

    const graphHash = `etg:${createHash('sha256').update(tasks.map((t) => t.id).join('->'), 'utf8').digest('hex').substring(0, 16)}`;

    const taskGraph: EngineeringTaskGraph = {
      graphId: `graph-${planId}`,
      planId,
      tasks,
      rootTaskIds: [taskSpecId],
      graphHash,
      isAcyclic: true
    };

    return {
      featureId: candidate.id,
      taskGraph,
      estimatedTokens: 8500,
      recommendedDomain: primaryDomain,
      prerequisiteTasks: []
    };
  }
}
