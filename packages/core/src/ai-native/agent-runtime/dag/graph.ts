/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Task Directed Acyclic Graph (DAG) Engine
 */

import { CycleDetectedError, type ExecutionTask } from '../types.js';

export class TaskDAG {
  private readonly tasks = new Map<string, ExecutionTask>();

  constructor(initialTasks?: readonly ExecutionTask[] | undefined) {
    if (initialTasks) {
      for (const t of initialTasks) {
        this.addTask(t);
      }
    }
  }

  public addTask(task: ExecutionTask): void {
    this.tasks.set(task.taskId, { ...task });
  }

  public getTask(taskId: string): ExecutionTask | undefined {
    return this.tasks.get(taskId);
  }

  public listTasks(): readonly ExecutionTask[] {
    return Array.from(this.tasks.values());
  }

  public getDependencies(taskId: string): readonly ExecutionTask[] {
    const task = this.tasks.get(taskId);
    if (!task) return [];
    const deps: ExecutionTask[] = [];
    for (const depId of task.dependencies) {
      const dep = this.tasks.get(depId);
      if (dep) deps.push(dep);
    }
    return deps;
  }

  public getDependents(taskId: string): readonly ExecutionTask[] {
    const dependents: ExecutionTask[] = [];
    for (const task of this.tasks.values()) {
      if (task.dependencies.includes(taskId)) {
        dependents.push(task);
      }
    }
    return dependents;
  }

  /**
   * Validates DAG integrity: checks that all dependencies exist and detects cycles.
   */
  public validate(): void {
    // 1. Missing dependency check
    for (const task of this.tasks.values()) {
      for (const depId of task.dependencies) {
        if (!this.tasks.has(depId)) {
          throw new Error(`Tâche '${task.taskId}' dépend d'une tâche inexistante '${depId}'`);
        }
      }
    }

    // 2. Cycle detection via DFS
    this.detectCycles();
  }

  /**
   * Cycle detection using DFS with recursion stack tracking.
   * Throws CycleDetectedError if a cycle is found.
   */
  public detectCycles(): void {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const path: string[] = [];

    const dfs = (currentId: string): void => {
      visited.add(currentId);
      inStack.add(currentId);
      path.push(currentId);

      const task = this.tasks.get(currentId);
      if (task) {
        for (const depId of task.dependencies) {
          if (inStack.has(depId)) {
            const cycle = [...path.slice(path.indexOf(depId)), depId];
            throw new CycleDetectedError(cycle);
          }
          if (!visited.has(depId)) {
            dfs(depId);
          }
        }
      }

      path.pop();
      inStack.delete(currentId);
    };

    for (const taskId of this.tasks.keys()) {
      if (!visited.has(taskId)) {
        dfs(taskId);
      }
    }
  }

  /**
   * Produces a deterministic topological ordering of all tasks.
   */
  public getTopologicalOrder(): readonly ExecutionTask[] {
    this.validate();

    const inDegree = new Map<string, number>();
    for (const taskId of this.tasks.keys()) {
      inDegree.set(taskId, 0);
    }

    // A task depends on its dependencies; in dependency-first ordering,
    // dependencies must be executed before the task.
    // In-degree count = number of pending dependencies.
    for (const task of this.tasks.values()) {
      inDegree.set(task.taskId, task.dependencies.length);
    }

    const queue: string[] = [];
    // Start with tasks that have 0 dependencies, sorted by taskId for determinism
    for (const [taskId, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(taskId);
      }
    }
    queue.sort();

    const result: ExecutionTask[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentTask = this.tasks.get(currentId)!;
      result.push(currentTask);

      // Find all tasks that depend on currentId and decrement their in-degree
      const dependents = [...this.getDependents(currentId)].sort((a: ExecutionTask, b: ExecutionTask) => a.taskId.localeCompare(b.taskId));
      for (const dep of dependents) {
        const currentDeg = inDegree.get(dep.taskId)! - 1;
        inDegree.set(dep.taskId, currentDeg);
        if (currentDeg === 0) {
          queue.push(dep.taskId);
          queue.sort();
        }
      }
    }

    return result;
  }

  /**
   * Computes execution batches for parallel execution.
   * Tasks within the same batch have zero inter-dependencies and all previous dependencies satisfied.
   */
  public getExecutionBatches(): readonly (readonly ExecutionTask[])[] {
    this.validate();

    const batches: ExecutionTask[][] = [];
    const completedTasks = new Set<string>();
    const remainingTasks = new Map(this.tasks);

    while (remainingTasks.size > 0) {
      const readyBatch: ExecutionTask[] = [];

      for (const [id, task] of remainingTasks.entries()) {
        const canExecute = task.dependencies.every((depId) => completedTasks.has(depId));
        if (canExecute) {
          readyBatch.push(task);
        }
      }

      if (readyBatch.length === 0) {
        throw new CycleDetectedError(Array.from(remainingTasks.keys()));
      }

      // Sort batch deterministically by taskId
      readyBatch.sort((a, b) => a.taskId.localeCompare(b.taskId));

      batches.push(readyBatch);
      for (const t of readyBatch) {
        completedTasks.add(t.taskId);
        remainingTasks.delete(t.taskId);
      }
    }

    return batches;
  }
}
