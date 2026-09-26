/**
 * VibeCode Core - Decision Engine
 * Decision Ledger : persistance des décisions sur disque.
 *
 * But : pouvoir détecter les contradictions avec les décisions passées.
 * Phase 9.5 : persistance JSON simple via json-disk-cache.
 */

import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import { logger } from '../../logger.js';
import type { Decision } from './types.js';

interface DecisionLedgerStore {
  readonly decisions: Decision[];
}

const EMPTY_STORE: DecisionLedgerStore = { decisions: [] };

export class DecisionLedger {
  private store: DecisionLedgerStore = { decisions: [] };
  private readonly filePath: string;

  constructor(options: { fileName?: string } = {}) {
    this.filePath = dataFilePath(options.fileName || 'decisions');
    this.load();
  }

  private load(): void {
    try {
      this.store = readJsonFile<DecisionLedgerStore>(this.filePath, EMPTY_STORE);
      if (this.store.decisions.length > 0) {
        logger.info('DecisionLedger loaded', { count: this.store.decisions.length });
      }
    } catch (err) {
      logger.warn('DecisionLedger load failed', { error: String(err) });
      this.store = { decisions: [] };
    }
  }

  private persist(): void {
    try {
      writeJsonFileSync(this.filePath, this.store);
    } catch (err) {
      logger.warn('DecisionLedger persist failed', { error: String(err) });
    }
  }

  public recordDecision(decision: Decision): void {
    const next: Decision[] = [...this.store.decisions, decision];
    this.store = { decisions: next };
    this.persist();
  }

  public getActiveDecisions(projectId?: string): readonly Decision[] {
    return this.store.decisions.filter((d) => {
      if (d.status !== 'ACCEPTED' && d.status !== 'PROPOSED') return false;
      if (projectId && d.projectId !== projectId) return false;
      return true;
    });
  }

  public getById(decisionId: string): Decision | undefined {
    return this.store.decisions.find((d) => d.decisionId === decisionId);
  }

  /**
   * Cherche les décisions passées qui contredisent la nouvelle décision.
   * Pour Phase 9.5 on compare le goal et les alternatives.
   */
  public findContradicting(decision: Decision): readonly Decision[] {
    const contradictions: Decision[] = [];
    const newGoal = decision.intentGoal.toLowerCase();
    const chosen = decision.chosenAlternative;

    for (const past of this.store.decisions) {
      if (past.projectId !== decision.projectId) continue;
      if (past.status === 'REJECTED' || past.status === 'SUPERSEDED') continue;
      const pastGoal = past.intentGoal.toLowerCase();

      // Conflit sémantique simple : même action sur même cible avec verdict opposé
      const sameGoalDomain =
        pastGoal.includes(newGoal) || newGoal.includes(pastGoal);
      const oppositeVerdict =
        (past.verdict === 'READY' && decision.verdict === 'BLOCKED') ||
        (past.verdict === 'BLOCKED' && decision.verdict === 'READY');

      if (sameGoalDomain && oppositeVerdict) {
        contradictions.push(past);
        continue;
      }

      // Si les alternatives choisies sont mutuellement exclusives (mêmes fichiers, actions opposées)
      if (chosen && past.chosenAlternative) {
        const sameFiles = chosen.targetFiles.some((f) =>
          past.chosenAlternative!.targetFiles.includes(f)
        );
        const oppositeAction =
          (chosen.proposedActions.includes('CREATE') &&
            past.chosenAlternative.proposedActions.includes('DELETE')) ||
          (chosen.proposedActions.includes('DELETE') &&
            past.chosenAlternative.proposedActions.includes('CREATE'));
        if (sameFiles && oppositeAction) {
          contradictions.push(past);
        }
      }
    }
    return contradictions;
  }

  public supersede(decisionId: string, newDecisionId: string, _reason: string): void {
    const idx = this.store.decisions.findIndex((d) => d.decisionId === decisionId);
    if (idx === -1) {
      logger.warn('DecisionLedger.supersede: decision not found', { decisionId });
      return;
    }
    const old = this.store.decisions[idx];
    if (!old) return;
    const superseded: Decision = { ...old, status: 'SUPERSEDED' };
    const next = [...this.store.decisions];
    next[idx] = superseded;
    this.store = { decisions: next };
    this.persist();
    logger.info('DecisionLedger: superseded', { old: decisionId, new: newDecisionId });
  }

  public accept(decisionId: string): void {
    const idx = this.store.decisions.findIndex((d) => d.decisionId === decisionId);
    if (idx === -1) return;
    const old = this.store.decisions[idx];
    if (!old) return;
    const accepted: Decision = { ...old, status: 'ACCEPTED' };
    const next = [...this.store.decisions];
    next[idx] = accepted;
    this.store = { decisions: next };
    this.persist();
  }

  public reject(decisionId: string): void {
    const idx = this.store.decisions.findIndex((d) => d.decisionId === decisionId);
    if (idx === -1) return;
    const old = this.store.decisions[idx];
    if (!old) return;
    const rejected: Decision = { ...old, status: 'REJECTED' };
    const next = [...this.store.decisions];
    next[idx] = rejected;
    this.store = { decisions: next };
    this.persist();
  }

  public clear(): void {
    this.store = { decisions: [] };
    this.persist();
  }

  public count(): number {
    return this.store.decisions.length;
  }
}
