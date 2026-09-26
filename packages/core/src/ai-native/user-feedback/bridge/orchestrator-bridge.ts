/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Orchestrator Bridge: Translates Confirmed Problems into Engineering Task Graphs (AINT-010)
 */

import { createHash } from 'node:crypto';
import type { AgentCapability, AgentDomain, AgentTask, EngineeringTaskGraph } from '../../ai-orchestrator/types.js';
import type { AggregatedProblem, ProposedRemediationPlan } from '../types.js';

export class FeedbackOrchestratorBridge {
  /**
   * Convertit un problème confirmé en un graphe de tâches d'ingénierie prêt pour AINT-010
   */
  public createRemediationPlan(problem: AggregatedProblem): ProposedRemediationPlan {
    const planId = `rplan-${problem.id.toLowerCase()}`;
    const tasks: AgentTask[] = [];

    // 1. Tâche d'investigation et d'isolation de la cause racine
    const taskAnalyzeId = `${planId}-task-analyze`;
    tasks.push({
      id: taskAnalyzeId,
      title: `Investigation & Reproduction : ${problem.title}`,
      description: `Isoler la cause racine : ${problem.rootCauseHypothesis || problem.description}. Vérifier les preuves collectées (${problem.evidence.length} preuves).`,
      domain: 'ARCHITECTURE',
      priority: 1,
      dependencies: [],
      requiredContext: {
        targetFiles: problem.impact.affectedFiles,
        includeSemanticModel: true,
        maxTokensBudget: 2500
      },
      requiredCapabilities: ['SERVICE_LOGIC', 'IMPACT_ASSESSMENT'],
      status: 'READY',
      operation: 'ANALYZE',
      retryCount: 0,
      maxRetries: 2
    });

    // 2. Tâche de correction chirurgicale
    const isUiDefect = problem.category === 'UX_PROBLEM' || problem.category === 'ACCESSIBILITY' || problem.subtype === 'RENDERING';
    const primaryDomain: AgentDomain = isUiDefect ? 'UI' : 'BACKEND';
    const primaryCapability: AgentCapability = isUiDefect ? 'COMPONENT_STYLING' : 'SERVICE_LOGIC';

    const taskFixId = `${planId}-task-fix`;
    tasks.push({
      id: taskFixId,
      title: `Correction chirurgicale : ${problem.title}`,
      description: problem.suggestedRemediation || `Appliquer le correctif pour remédier à l'anomalie ${problem.id}`,
      domain: primaryDomain,
      priority: 2,
      dependencies: [taskAnalyzeId],
      requiredContext: {
        targetFiles: problem.impact.affectedFiles,
        maxTokensBudget: 4000
      },
      requiredCapabilities: [primaryCapability],
      status: 'QUEUED',
      operation: 'MODIFY',
      retryCount: 0,
      maxRetries: 3
    });

    // 3. Tâche de validation et tests de non-régression
    const taskVerifyId = `${planId}-task-verify`;
    tasks.push({
      id: taskVerifyId,
      title: `Validation & Tests de non-régression : ${problem.title}`,
      description: `Vérifier que l'anomalie ${problem.id} est résolue sans effet de bord ni régression.`,
      domain: 'TEST',
      priority: 3,
      dependencies: [taskFixId],
      requiredContext: {
        targetFiles: problem.impact.affectedFiles,
        maxTokensBudget: 2000
      },
      requiredCapabilities: ['UNIT_TEST_GEN'],
      status: 'QUEUED',
      operation: 'VERIFY',
      retryCount: 0,
      maxRetries: 2
    });

    const graphHash = `etg:${createHash('sha256').update(tasks.map(t => t.id).join('->'), 'utf8').digest('hex').substring(0, 16)}`;

    const taskGraph: EngineeringTaskGraph = {
      graphId: `graph-${planId}`,
      planId,
      tasks,
      rootTaskIds: [taskAnalyzeId],
      graphHash,
      isAcyclic: true
    };

    return {
      problemId: problem.id,
      taskGraph,
      recommendedDomain: primaryDomain,
      estimatedTokens: 8500,
      prerequisiteTasks: []
    };
  }
}
