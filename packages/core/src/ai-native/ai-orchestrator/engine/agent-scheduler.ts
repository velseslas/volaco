/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * Deterministic DAG Task Scheduler & Agent Dispatcher
 */

import { compareTasks, deepFreeze } from '../canonical.js';
import type {
  AgentArtifact,
  AgentConflict,
  AgentDomain,
  AgentResult,
  AgentTask,
  EngineeringTaskGraph
} from '../types.js';
import type { BaseSpecializedAgent } from '../agents/base-agent.js';
import type { ContextOrchestrator } from './context-orchestrator.js';
import type { Role } from '../../../identity/permissions.js';

export interface SchedulerExecutionResult {
  /** P2 — tâches exécutées en mode dégradé (sans IA). */
  degradedCount: number;
  readonly updatedGraph: EngineeringTaskGraph;
  readonly artifacts: readonly AgentArtifact[];
  readonly conflicts: readonly AgentConflict[];
  readonly totalTokens: number;
  readonly durationMs: number;
  readonly hasFailures: boolean;
}

export class AgentScheduler {
  constructor(
    private readonly agents: Map<AgentDomain, BaseSpecializedAgent>,
    private readonly contextOrchestrator: ContextOrchestrator,
    private readonly maxConcurrentTasks = 4
  ) {}

  public async executeGraph(params: {
    taskGraph: EngineeringTaskGraph;
    tenantId: string;
    projectId: string;
    rawFiles?: Record<string, string> | undefined;
    decisions?: readonly string[] | undefined;
    constraints?: readonly string[] | undefined;
    userRole?: Role | undefined;
    requestId?: string | undefined;
  }): Promise<SchedulerExecutionResult> {
    const { taskGraph, tenantId, projectId, rawFiles, decisions, constraints, userRole, requestId } = params;
    const startTime = Date.now();
    let degradedCount = 0;

    const tasksMap = new Map<string, AgentTask>();
    for (const t of taskGraph.tasks) {
      tasksMap.set(t.id, { ...t });
    }

    const allArtifacts: AgentArtifact[] = [];
    const allConflicts: AgentConflict[] = [];
    let totalTokens = 0;
    let hasFailures = false;

    // Loop until all tasks are COMPLETED or no more tasks can be scheduled
    let progressMade = true;
    while (progressMade) {
      progressMade = false;

      // Find tasks ready to execute: status === 'QUEUED' and all dependencies COMPLETED
      const readyTasks: AgentTask[] = [];
      for (const task of tasksMap.values()) {
        if (task.status === 'QUEUED') {
          const depsCompleted = task.dependencies.every(
            (depId) => tasksMap.get(depId)?.status === 'COMPLETED'
          );
          if (depsCompleted) {
            readyTasks.push(task);
          }
        }
      }

      if (readyTasks.length === 0) {
        break;
      }

      // Sort ready tasks by priority
      readyTasks.sort(compareTasks);

      // Execute up to maxConcurrentTasks concurrently
      const batch = readyTasks.slice(0, this.maxConcurrentTasks);
      progressMade = true;

      // Mark running
      for (const t of batch) {
        tasksMap.set(t.id, { ...t, status: 'RUNNING' });
      }

      const executionPromises = batch.map(async (task): Promise<AgentResult> => {
        const agent = this.agents.get(task.domain);
        if (!agent) {
          return {
            taskId: task.id,
            agentId: 'unknown-agent',
            status: 'FAILURE',
            artifacts: [],
            conflicts: [],
            tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            durationMs: 0,
            error: `Aucun agent spécialisé enregistré pour le domaine '${task.domain}'`
          };
        }

        const taskContext = this.contextOrchestrator.assembleTaskContext({
          tenantId,
          projectId,
          task,
          rawFiles,
          decisions,
          constraints,
          userRole,
          requestId
        });

        try {
          return await agent.executeTask({
            task,
            context: taskContext,
            tenantId,
            projectId,
            requestId
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            taskId: task.id,
            agentId: agent.definition.id,
            status: 'FAILURE',
            artifacts: [],
            conflicts: [],
            tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            durationMs: 0,
            error: msg
          };
        }
      });

      const results = await Promise.all(executionPromises);

      for (const res of results) {
        const currentTask = tasksMap.get(res.taskId)!;
        totalTokens += res.tokensUsed.totalTokens;
        if (res.degraded) degradedCount += 1;

        if (res.status === 'SUCCESS') {
          tasksMap.set(res.taskId, {
            ...currentTask,
            status: 'COMPLETED',
            assignedAgentId: res.agentId
          });
          allArtifacts.push(...res.artifacts);
          allConflicts.push(...res.conflicts);
        } else {
          hasFailures = true;
          tasksMap.set(res.taskId, {
            ...currentTask,
            status: 'FAILED',
            error: res.error,
            assignedAgentId: res.agentId
          });
        }
      }
    }

    const updatedTasks = Array.from(tasksMap.values());
    const updatedGraph: EngineeringTaskGraph = deepFreeze({
      ...taskGraph,
      tasks: updatedTasks
    });

    const durationMs = Date.now() - startTime;

    return deepFreeze({
      updatedGraph,
      artifacts: allArtifacts,
      conflicts: allConflicts,
      totalTokens,
      durationMs,
      hasFailures,
      // P2 — vérité sur la provenance : tâches exécutées sans IA (fallback
      // local). Le consommateur peut afficher « dégradé » au lieu de
      // prétendre à une génération IA.
      degradedCount
    });
  }
}
