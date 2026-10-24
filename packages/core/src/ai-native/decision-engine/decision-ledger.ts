/**
 * VibeCode Core - Decision Engine
 * Decision Ledger : persistance des décisions sur disque.
 *
 * But : pouvoir détecter les contradictions avec les décisions passées.
 * Phase 9.5 : persistance JSON simple via json-disk-cache.
 *
 * V7-HARDEN-1 : le ledger est borné (LRU, défaut 500). Les décisions les
 * moins récemment lues/validées sortent au-delà de la borne ; le fichier
 * reste ainsi maîtrisé même si `/decide` est appelé en masse. La lecture
 * (`getById`, `accept`, `reject`, `supersede`) rafraîchit la récence ; les
 * requêtes de masse (`getActiveDecisions`, `findContradicting`) ne le font
 * pas pour ne pas fausser l'ordre.
 */

import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import { logger } from '../../logger.js';
import type { Decision } from './types.js';

interface DecisionLedgerStore {
  readonly decisions: Decision[];
}

const EMPTY_STORE: DecisionLedgerStore = { decisions: [] };

export const DEFAULT_DECISION_LEDGER_MAX_ENTRIES = 500;

export interface DecisionLedgerOptions {
  fileName?: string;
  /** Borne du ledger ; minimum 1. Défaut : DEFAULT_DECISION_LEDGER_MAX_ENTRIES. */
  maxEntries?: number;
}

export class DecisionLedger {
  private store: DecisionLedgerStore = { decisions: [] };
  private readonly filePath: string;
  private readonly maxEntries: number;
  /** Ordre d'accès LRU : la première clé est la moins récemment utilisée. */
  private readonly recency = new Map<string, true>();

  constructor(options: DecisionLedgerOptions = {}) {
    this.filePath = dataFilePath(options.fileName || 'decisions');
    const requested = typeof options.maxEntries === 'number' && Number.isFinite(options.maxEntries)
      ? Math.floor(options.maxEntries)
      : DEFAULT_DECISION_LEDGER_MAX_ENTRIES;
    this.maxEntries = Math.max(1, requested);
    this.load();
  }

  private load(): void {
    try {
      const loaded = readJsonFile<DecisionLedgerStore>(this.filePath, EMPTY_STORE);
      const decisions = loaded && Array.isArray(loaded.decisions) ? [...loaded.decisions] : [];
      this.store = { decisions };
      this.recency.clear();
      for (const decision of decisions) {
        if (decision && typeof decision.decisionId === 'string') {
          this.recency.set(decision.decisionId, true);
        }
      }
      const pruned = this.prune();
      if (decisions.length > 0) {
        logger.info('DecisionLedger loaded', {
          count: this.store.decisions.length,
          maxEntries: this.maxEntries
        });
      }
      if (pruned) this.persist();
    } catch (err) {
      logger.warn('DecisionLedger load failed', { error: String(err) });
      this.recency.clear();
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

  /** Touche une décision existante sans changer son contenu. */
  private touch(decisionId: string): void {
    if (!this.recency.has(decisionId)) return;
    this.recency.delete(decisionId);
    this.recency.set(decisionId, true);
  }

  /** Évince les entrées les moins récemment utilisées au-delà de la borne. */
  private prune(): boolean {
    let changed = false;
    while (this.store.decisions.length > this.maxEntries) {
      const oldest = this.recency.keys().next().value as string | undefined;
      if (!oldest) break;
      this.recency.delete(oldest);
      const next = this.store.decisions.filter((decision) => decision.decisionId !== oldest);
      if (next.length === this.store.decisions.length) {
        // Incohérence (id absent du tableau) : on refuse de boucler.
        changed = true;
        break;
      }
      this.store = { decisions: next };
      changed = true;
    }
    return changed;
  }

  /** Remplace le store, synchronise l'ordre LRU puis persiste. */
  private commit(decisions: Decision[]): void {
    const ids = new Set(decisions.map((decision) => decision.decisionId));
    for (const id of [...this.recency.keys()]) {
      if (!ids.has(id)) this.recency.delete(id);
    }
    for (const decision of decisions) {
      if (!this.recency.has(decision.decisionId)) {
        this.recency.set(decision.decisionId, true);
      }
    }
    this.store = { decisions };
    this.prune();
    this.persist();
  }

  public recordDecision(decision: Decision): void {
    const next = [
      ...this.store.decisions.filter((existing) => existing.decisionId !== decision.decisionId),
      decision
    ];
    this.recency.delete(decision.decisionId);
    this.recency.set(decision.decisionId, true);
    this.commit(next);
  }

  public getActiveDecisions(projectId?: string): readonly Decision[] {
    return this.store.decisions.filter((d) => {
      if (d.status !== 'ACCEPTED' && d.status !== 'PROPOSED') return false;
      if (projectId && d.projectId !== projectId) return false;
      return true;
    });
  }

  public getById(decisionId: string): Decision | undefined {
    const found = this.store.decisions.find((d) => d.decisionId === decisionId);
    if (found) this.touch(decisionId);
    return found;
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
    this.touch(decisionId);
    const superseded: Decision = { ...old, status: 'SUPERSEDED' };
    const next = [...this.store.decisions];
    next[idx] = superseded;
    this.commit(next);
    logger.info('DecisionLedger: superseded', { old: decisionId, new: newDecisionId });
  }

  public accept(decisionId: string): void {
    const idx = this.store.decisions.findIndex((d) => d.decisionId === decisionId);
    if (idx === -1) return;
    const old = this.store.decisions[idx];
    if (!old) return;
    this.touch(decisionId);
    const accepted: Decision = { ...old, status: 'ACCEPTED' };
    const next = [...this.store.decisions];
    next[idx] = accepted;
    this.commit(next);
  }

  public reject(decisionId: string): void {
    const idx = this.store.decisions.findIndex((d) => d.decisionId === decisionId);
    if (idx === -1) return;
    const old = this.store.decisions[idx];
    if (!old) return;
    this.touch(decisionId);
    const rejected: Decision = { ...old, status: 'REJECTED' };
    const next = [...this.store.decisions];
    next[idx] = rejected;
    this.commit(next);
  }

  public clear(): void {
    this.recency.clear();
    this.store = { decisions: [] };
    this.persist();
  }

  public count(): number {
    return this.store.decisions.length;
  }
}
