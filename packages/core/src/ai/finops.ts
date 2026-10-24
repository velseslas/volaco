/**
 * CDC §53 — FinOps.
 * Agrège les événements d'usage IA réels (usage.ts) en vues Cost / Project /
 * Model / Provider / Day. Les montants sont des ESTIMATIONS : ils proviennent
 * de MODEL_PRICING appliqué au moment de l'enregistrement (kind SUCCESS).
 * Les appels START/ERROR/ABORTED ne coûtent rien (J-6) mais sont comptés
 * comme requêtes — d'où la distinction requêtes vs événements facturés.
 */

import { aiUsageTracker, type AiUsageRecord } from './usage.js';

export interface FinOpsBucket {
  readonly key: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  /** Événements SUCCESS (facturés) — les records historiques sans kind comptent ici. */
  readonly billedRequests: number;
  readonly errorCount: number;
  readonly abortedCount: number;
}

export interface FinOpsTotals {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly billedRequests: number;
  readonly errorCount: number;
  readonly abortedCount: number;
}

export interface FinOpsSummary {
  readonly tenantId: string;
  readonly projectId?: string | undefined;
  readonly currency: 'USD';
  readonly pricing: 'estimated';
  readonly totals: FinOpsTotals;
  readonly byModel: readonly FinOpsBucket[];
  readonly byProvider: readonly FinOpsBucket[];
  readonly byProject: readonly FinOpsBucket[];
  readonly byDay: readonly FinOpsBucket[];
}

const KIND_ERROR = 'ERROR';
const KIND_ABORTED = 'ABORTED';

function emptyBucket(key: string): {
  key: string; promptTokens: number; completionTokens: number;
  totalTokens: number; costUsd: number; billedRequests: number;
  errorCount: number; abortedCount: number;
} {
  return { key, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, billedRequests: 0, errorCount: 0, abortedCount: 0 };
}

function bucketize(records: readonly AiUsageRecord[], keyOf: (r: AiUsageRecord) => string): FinOpsBucket[] {
  const map = new Map<string, ReturnType<typeof emptyBucket>>();
  for (const r of records) {
    const key = keyOf(r) || 'unknown';
    let b = map.get(key);
    if (!b) {
      b = emptyBucket(key);
      map.set(key, b);
    }
    b.promptTokens += r.promptTokens;
    b.completionTokens += r.completionTokens;
    b.totalTokens += r.totalTokens;
    b.costUsd += r.estimatedCostUsd;
    if (r.kind === undefined || r.kind === 'SUCCESS') b.billedRequests += 1;
    else if (r.kind === KIND_ERROR) b.errorCount += 1;
    else if (r.kind === KIND_ABORTED) b.abortedCount += 1;
  }
  return Array.from(map.values())
    .map((b) => ({ ...b, costUsd: Math.round(b.costUsd * 1_000_000) / 1_000_000 }))
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens || a.key.localeCompare(b.key));
}

export function summarizeFinOps(
  tenantId: string,
  options: { projectId?: string | undefined } = {}
): FinOpsSummary {
  const all = aiUsageTracker.getRecordsFor(tenantId);
  const records = options.projectId
    ? all.filter((r) => r.projectId === options.projectId)
    : all;

  const totalsList = bucketize(records, () => 'TOTAL');
  const totals = totalsList[0] ?? emptyBucket('TOTAL');

  return {
    tenantId,
    projectId: options.projectId,
    currency: 'USD',
    pricing: 'estimated',
    totals: {
      promptTokens: totals.promptTokens,
      completionTokens: totals.completionTokens,
      totalTokens: totals.totalTokens,
      costUsd: totals.costUsd,
      billedRequests: totals.billedRequests,
      errorCount: totals.errorCount,
      abortedCount: totals.abortedCount
    },
    byModel: bucketize(records, (r) => r.model),
    byProvider: bucketize(records, (r) => r.provider ?? 'unknown'),
    byProject: bucketize(records, (r) => r.projectId),
    byDay: bucketize(records, (r) => new Date(r.timestamp).toISOString().slice(0, 10))
  };
}
