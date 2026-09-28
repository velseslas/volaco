/**
 * AI EXECUTION TRANSPARENCY ENGINE — modèle d'événements (CDC §4-§8).
 *
 * Chaque action réelle du moteur de génération produit un ExecutionEvent
 * typé, ordonné (seq) et persistable. Ce modèle est la source de vérité
 * unique : tout ce que l'UI affiche provient d'un de ces événements,
 * jamais d'un libellé inventé côté client.
 */

export type ExecutionPhase =
  | 'UNDERSTAND'
  | 'PLAN'
  | 'INSPECT'
  | 'IMPLEMENT'
  | 'VALIDATE'
  | 'REPAIR'
  | 'COMPLETE';

export type ExecutionStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'WAITING_USER';

export type ExecutionEventType =
  | 'EXECUTION_STARTED'
  | 'PHASE_CHANGED'
  | 'PLAN_CREATED'
  | 'PLAN_APPROVED'
  | 'FILE_READ'
  | 'FILE_CREATED'
  | 'FILE_MODIFIED'
  | 'FILE_DELETED'
  | 'DIFF_GENERATED'
  | 'VALIDATION_STARTED'
  | 'VALIDATION_COMPLETED'
  | 'VALIDATION_FAILED'
  | 'REPAIR_STARTED'
  | 'RETRY_STARTED'
  | 'REPAIR_COMPLETED'
  | 'EXECUTION_CANCELLED'
  | 'EXECUTION_FAILED'
  | 'EXECUTION_COMPLETED'
  | 'SUMMARY_GENERATED';

/** Événement unitaire — jamais de secrets dans `detail` (CDC §38). */
export interface ExecutionEvent {
  id: string;
  executionId: string;
  /** Ordre fiable au sein de l'exécution, incrémenté à partir de 1 (CDC §43). */
  seq: number;
  /** Epoch ms. */
  ts: number;
  phase: ExecutionPhase;
  type: ExecutionEventType;
  status: ExecutionStatus;
  /** Libellé utilisateur en français, non technique (CDC §53). */
  title: string;
  detail?: Record<string, unknown>;
  /** Seulement quand réellement mesuré (CDC §26). */
  durationMs?: number;
}

/** Bilan final d'une exécution — alimente la synthèse (CDC §24-§25). */
export interface ExecutionSummary {
  sectionsCreated?: number;
  sectionsModified?: number;
  sectionsDeleted?: number;
  filesTouched?: string[];
  htmlChars?: number;
  /** T4 — delta réel de lignes (diff multiset, jamais inventé). */
  addedLines?: number;
  removedLines?: number;
  revisionId?: string;
  prompt?: string;
  error?: string;
}

export type ExecutionMode = 'create' | 'modify';

/** Enregistrement complet d'une exécution (une génération = un record). */
export interface ExecutionRecord {
  executionId: string;
  tenantId: string;
  projectId: string;
  /** Ordre monotone d' création — départage fiable des startedAt identiques. */
  order: number;
  status: ExecutionStatus;
  phase: ExecutionPhase;
  mode: ExecutionMode;
  prompt: string;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  /** Plafonné : les plus anciens événements sont retirés, les seq restent fiables. */
  events: ExecutionEvent[];
  summary?: ExecutionSummary;
  cancelReason?: string;
}
