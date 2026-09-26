/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Task Scheduler
 */

import type { ExecutionTask } from '../types.js';
import type { TaskDAG } from './graph.js';

export interface TaskExecutionHandler {
  (task: ExecutionTask): Promise<unknown>;
}

export class TaskScheduler {
  constructor(private readonly dag: TaskDAG) {}

  /**
   * Executes the DAG batch-by-batch (parallel within batches).
   */
  public async execute(handler: TaskExecutionHandler): Promise<readonly ExecutionTask[]> {
    const batches = this.dag.getExecutionBatches();
    const executed: ExecutionTask[] = [];

    for (const batch of batches) {
      // Run batch tasks concurrently
      const promises = batch.map(async (task) => {
        task.status = 'RUNNING';
        try {
          const result = await handler(task);
          task.status = 'COMPLETED';
          task.result = result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          task.status = 'FAILED';
          task.error = msg;
          throw err;
        }
        return task;
      });

      const batchResults = await Promise.all(promises);
      executed.push(...batchResults);
    }

    return executed;
  }
}
