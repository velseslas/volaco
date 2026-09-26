/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * Self-Repair Orchestrator with Anti-Infinite-Loop Circuit Breaker
 */

import { deepFreeze } from '../canonical.js';
import type { AgentConflict, AgentTask } from '../types.js';

export interface RepairDecision {
  readonly canRepair: boolean;
  readonly escalatedToHuman: boolean;
  readonly repairCycles: number;
  readonly repairTasks: readonly AgentTask[];
  readonly reason: string;
}

export class RepairOrchestrator {
  constructor(
    private readonly maxSelfRepairCycles = 3
  ) {}

  public evaluateRepair(params: {
    currentCycles: number;
    failedTasks: readonly AgentTask[];
    conflicts: readonly AgentConflict[];
  }): RepairDecision {
    const { currentCycles, failedTasks, conflicts } = params;

    // 1. Anti-Infinite-Loop Circuit Breaker
    if (currentCycles >= this.maxSelfRepairCycles) {
      return deepFreeze({
        canRepair: false,
        escalatedToHuman: true,
        repairCycles: currentCycles,
        repairTasks: [],
        reason: `Seuil maximal de cycles d'auto-réparation atteint (${this.maxSelfRepairCycles} cycles). Escalade obligatoire au Control Plane humain.`
      });
    }

    // 2. Blocking conflicts require immediate human intervention
    const blockingConflicts = conflicts.filter((c) => c.severity === 'BLOCKING' || c.requiresHumanIntervention);
    if (blockingConflicts.length > 0) {
      return deepFreeze({
        canRepair: false,
        escalatedToHuman: true,
        repairCycles: currentCycles,
        repairTasks: [],
        reason: `Conflit bloquant inter-agents détecté : ${blockingConflicts[0]?.description}. Arbitrage humain requis.`
      });
    }

    if (failedTasks.length === 0 && conflicts.length === 0) {
      return deepFreeze({
        canRepair: false,
        escalatedToHuman: false,
        repairCycles: currentCycles,
        repairTasks: [],
        reason: 'Aucune défaillance nécessitant une réparation.'
      });
    }

    // 3. Generate targeted repair tasks with error context
    const repairTasks: AgentTask[] = [];
    for (const failed of failedTasks) {
      const retryCount = failed.retryCount + 1;
      repairTasks.push({
        ...failed,
        id: `${failed.id}-repair-${retryCount}`,
        title: `[Réparation #${retryCount}] ${failed.title}`,
        description: `Tentative de correction suite à l'erreur: ${failed.error || 'Échec d exécution'}.`,
        status: 'QUEUED',
        retryCount,
        error: undefined
      });
    }

    return deepFreeze({
      canRepair: true,
      escalatedToHuman: false,
      repairCycles: currentCycles + 1,
      repairTasks,
      reason: `${repairTasks.length} tâche(s) réorientée(s) vers l'auto-réparation (Cycle ${currentCycles + 1}/${this.maxSelfRepairCycles}).`
    });
  }
}
