/**
 * LOT B — ACTIVITY EVENT : modèle générique + normalisation (CDC Live Agent
 * Activity Stream §5-§6).
 *
 * Principe : ExecutionEvent (store) reste le format BRUT ; ActivityEvent est
 * la vue normalisée consommée par le renderer unique. Les deux sont conservés
 * (raw preservé via `raw`) — debug, replay, évolution future.
 *
 * RÈGLES :
 * - type/action OUVERTS : un type d'événement inconnu se normalise sans
 *   refonte du frontend (fallback « event/<type minuscule ») ;
 * - rétro-compatible : un record ancien sans status/timestamps produit des
 *   défauts honnêtes, jamais d'exception ;
 * - AUCUNE information perdue : le type brut est conservé dans `raw`.
 */

import type { ExecutionEvent } from './types.js';

export type ActivityStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'SKIPPED'
  | 'WAITING_USER';

/**
 * Vue normalisée d'un événement d'exécution.
 * type : famille ouverte ('file' | 'plan' | 'validation' | 'repair' | 'execution' | 'agent' | …)
 * action : verbe ouvert ('read' | 'create' | 'modify' | 'delete' | 'test' | …)
 */
export interface ActivityEvent {
  id: string;
  executionId: string;
  sequence: number;
  timestamp: number;

  type: string;
  action: string;
  status: ActivityStatus;

  title: string;
  message?: string;

  file?: string;
  files?: string[];

  parentId?: string;

  metadata?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;

  startedAt?: number;
  completedAt?: number;
  durationMs?: number;

  /** L'événement brut d'origine (traçabilité, debug, replay fidèle). */
  raw: string;
}

/** Mapping brut → { type, action } — table unique, extensible. */
const ACTIVITY_MAP: Record<string, { type: string; action: string; source: string }> = {
  EXECUTION_STARTED: { type: 'execution', action: 'start', source: 'agent' },
  PHASE_CHANGED: { type: 'agent', action: 'phase', source: 'agent' },
  PLAN_CREATED: { type: 'plan', action: 'create', source: 'agent' },
  PLAN_APPROVED: { type: 'plan', action: 'approve', source: 'user' },
  IMPACT_ASSESSED: { type: 'analysis', action: 'impact', source: 'tool' },
  DECISION_ASSESSED: { type: 'analysis', action: 'decision', source: 'tool' },
  APPLICATION_MODEL_REFRESHED: { type: 'analysis', action: 'model-refresh', source: 'tool' },
  MUTATION_FALLBACK: { type: 'file', action: 'fallback', source: 'tool' },
  MUTATION_ROLLED_BACK: { type: 'file', action: 'rollback', source: 'tool' },
  FILE_READ: { type: 'file', action: 'read', source: 'tool' },
  FILE_CREATED: { type: 'file', action: 'create', source: 'tool' },
  FILE_MODIFIED: { type: 'file', action: 'modify', source: 'tool' },
  FILE_DELETED: { type: 'file', action: 'delete', source: 'tool' },
  DIFF_GENERATED: { type: 'file', action: 'diff', source: 'tool' },
  VALIDATION_STARTED: { type: 'validation', action: 'validate', source: 'tool' },
  VALIDATION_COMPLETED: { type: 'validation', action: 'validate', source: 'tool' },
  VALIDATION_FAILED: { type: 'validation', action: 'validate', source: 'tool' },
  REPAIR_STARTED: { type: 'repair', action: 'repair', source: 'agent' },
  RETRY_STARTED: { type: 'repair', action: 'retry', source: 'agent' },
  REPAIR_COMPLETED: { type: 'repair', action: 'repair', source: 'agent' },
  EXECUTION_COMPLETED: { type: 'execution', action: 'complete', source: 'agent' },
  EXECUTION_FAILED: { type: 'execution', action: 'fail', source: 'agent' },
  EXECUTION_CANCELLED: { type: 'execution', action: 'cancel', source: 'user' },
  SUMMARY_GENERATED: { type: 'execution', action: 'summary', source: 'agent' }
};

const STATUS_MAP: Record<string, ActivityStatus> = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  WAITING_USER: 'WAITING_USER',
  SKIPPED: 'SKIPPED'
};

function pickFile(detail?: Record<string, unknown>): string | undefined {
  if (!detail) return undefined;
  const path = detail.path;
  const section = detail.section;
  if (typeof path === 'string' && path) return path;
  if (typeof section === 'string' && section) return section;
  return undefined;
}

/**
 * Normalise UN événement brut en ActivityEvent. Ne lève jamais : un type
 * inconnu ou un record ancien produit une activité générique valide.
 */
export function normalizeExecutionEvent(event: ExecutionEvent): ActivityEvent {
  const known = ACTIVITY_MAP[event.type];
  const type = known ? known.type : 'event';
  const action = known ? known.action : event.type.toLowerCase();
  const source = known ? known.source : 'system';
  const detail = (event.detail || {}) as Record<string, unknown>;
  const status: ActivityStatus = STATUS_MAP[event.status] || 'COMPLETED';

  const activity: ActivityEvent = {
    id: event.id,
    executionId: event.executionId,
    sequence: event.seq,
    timestamp: event.ts,
    type,
    action,
    status,
    title: event.title || `${type} ${action}`,
    ...(typeof detail.error === 'string' ? { error: detail.error } : {}),
    ...(event.durationMs ? { durationMs: event.durationMs } : {}),
    metadata: detail,
    raw: event.type
  };

  const file = pickFile(event.detail);
  if (file) activity.file = file;
  // Parent logique : un item COMPLETED/FAILED porte l'id de l'item RUNNING
  // qui l'a ouvert quand le détail le transporte (paires section/repair).
  if (typeof detail.startedAt === 'number') activity.startedAt = detail.startedAt;
  if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') activity.completedAt = event.ts;
  if (status === 'RUNNING' || status === 'WAITING_USER') activity.startedAt = event.ts;
  return activity;
}

/** Normalise un enregistrement complet (ordre préservé, seq fiable). */
export function normalizeExecutionRecord(events: ExecutionEvent[]): ActivityEvent[] {
  return (events || []).map(normalizeExecutionEvent);
}
