/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Orchestrator Bridge - Projects approved recommendations into AINT-010 EngineeringTaskGraph
 * 
 * Strict Invariants:
 * - AINT-016 NEVER mutates code directly.
 * - Human Approval / AINT-009 → AINT-010 → AINT-006.
 * - Produces an EngineeringTaskGraph with strictly: ANALYZE → MODIFY → VERIFY.
 */

import { createHash } from 'node:crypto';
import type { EngineeringTaskGraph, AgentTask } from '../../ai-orchestrator/types.js';
import type { StrategicRecommendation } from '../types.js';

export class StrategyOrchestratorBridge {
  /**
   * Projects an approved StrategicRecommendation into an AINT-010 EngineeringTaskGraph.
   */
  public projectTaskGraph(recommendation: StrategicRecommendation): EngineeringTaskGraph {
    const planId = `plan-strat-${recommendation.id}`;
    const graphId = `graph-${recommendation.id}`;

    const analyzeTaskId = `task-${recommendation.id}-analyze`;
    const modifyTaskId = `task-${recommendation.id}-modify`;
    const verifyTaskId = `task-${recommendation.id}-verify`;

    const analyzeTask: AgentTask = {
      id: analyzeTaskId,
      title: `Analyser l'impact de l'intervention : ${recommendation.title}`,
      description: `Inspection AST, blast radius et dépendances pour : ${recommendation.description}`,
      domain: 'ARCHITECTURE',
      priority: Math.round(recommendation.strategicScore),
      dependencies: [],
      requiredContext: {
        includeSemanticModel: true,
        includeDna: true,
        includeSemanticGraph: true
      },
      requiredCapabilities: ['IMPACT_ASSESSMENT'],
      status: 'READY',
      operation: 'ANALYZE',
      retryCount: 0,
      maxRetries: 3
    };

    const modifyTask: AgentTask = {
      id: modifyTaskId,
      parentTaskId: analyzeTaskId,
      title: `Appliquer les modifications pour : ${recommendation.title}`,
      description: `Implémentation sécurisée Single-Writer sous contrôle AINT-006.`,
      domain: recommendation.type.includes('UI') || recommendation.type.includes('DESIGN') ? 'UI' : 'ARCHITECTURE',
      priority: Math.round(recommendation.strategicScore),
      dependencies: [analyzeTaskId],
      requiredContext: {
        includeSemanticModel: true
      },
      requiredCapabilities: ['COMPONENT_STYLING', 'SERVICE_LOGIC'],
      status: 'QUEUED',
      operation: 'MODIFY',
      retryCount: 0,
      maxRetries: 3
    };

    const verifyTask: AgentTask = {
      id: verifyTaskId,
      parentTaskId: modifyTaskId,
      title: `Vérification de non-régression et conformité : ${recommendation.title}`,
      description: `Validation TypeScript strict, tests unitaires et vérification de la règle NO EVIDENCE → NO CLAIM.`,
      domain: 'TEST',
      priority: Math.round(recommendation.strategicScore),
      dependencies: [modifyTaskId],
      requiredContext: {
        includeSemanticModel: true
      },
      requiredCapabilities: ['UNIT_TEST_GEN', 'INTEGRATION_TEST'],
      status: 'QUEUED',
      operation: 'VERIFY',
      retryCount: 0,
      maxRetries: 3
    };

    const tasks: AgentTask[] = [analyzeTask, modifyTask, verifyTask];
    const rawGraph = `${graphId}#${planId}#${tasks.map(t => t.id).join(',')}`;
    const graphHash = createHash('sha256').update(rawGraph, 'utf8').digest('hex').substring(0, 16);

    return {
      graphId,
      planId,
      tasks,
      rootTaskIds: [analyzeTaskId],
      graphHash: `grh:${graphHash}`,
      isAcyclic: true
    };
  }
}
