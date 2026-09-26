/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Execution Task Model & Invariants
 */

import { randomUUID } from 'node:crypto';
import type { AgentRole, AgentType, ExecutionTask, TaskStatus, ToolRisk } from '../types.js';

export interface CreateTaskOptions {
  readonly taskId?: string | undefined;
  readonly description: string;
  readonly type?: string | undefined;
  readonly dependencies?: readonly string[] | undefined;
  readonly requiredAgent: AgentType | AgentRole;
  readonly requiredContext?: readonly string[] | undefined;
  readonly requiredTools?: readonly string[] | undefined;
  readonly riskLevel?: ToolRisk | undefined;
}

export function createExecutionTask(options: CreateTaskOptions): ExecutionTask {
  const taskId = options.taskId ?? `task-${randomUUID().substring(0, 8)}`;

  return {
    taskId,
    id: taskId,
    description: options.description,
    title: options.description,
    type: options.type ?? 'GENERIC_TASK',
    dependencies: options.dependencies ? [...options.dependencies] : [],
    requiredAgent: options.requiredAgent,
    assignedAgent: options.requiredAgent,
    requiredContext: options.requiredContext ? [...options.requiredContext] : [],
    requiredTools: options.requiredTools ? [...options.requiredTools] : [],
    riskLevel: options.riskLevel ?? 'LOW',
    status: 'PENDING',
    estimatedTokens: 1000
  };
}
