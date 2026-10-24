/**
 * VibeCode Core - Design Harmony
 * CDC V8.1 WOW §9 — ÉVALUATION PAIRWISE (Version A vs Version B).
 *
 * Le CDC impose de privilégier la comparaison de deux versions et de
 * construire un dataset de référence à partir des préférences humaines.
 * Ce module est DÉTERMINISTE et n'invente aucune préférence :
 *  - chaque critère est un sous-score AQS RÉELLEMENT mesuré des deux côtés ;
 *  - une dimension non mesurée reste UNKNOWN (jamais 0) ;
 *  - une préférence système seule est marquée SYSTEM_ONLY et accompagnée d'un
 *    avertissement de confirmation humaine ;
 *  - une préférence humaine est conservée telle quelle, même si elle contredit
 *    le système (elle devient la vérité du dataset).
 */

import { createHash } from 'node:crypto';
import { deepFreeze } from '../ai-orchestrator/canonical.js';
import { dataFilePath, readJsonFile, writeJsonFileSync } from '../../persistence/json-disk-cache.js';
import type { AestheticQualityScore, AqsDimensionId } from './types.js';

export const PAIRWISE_EVALUATION_VERSION = '8.1' as const;
export const PAIRWISE_DECISION_THRESHOLD = 2;
export const PAIRWISE_MIN_COVERAGE = 0.5;
export const PAIRWISE_DATASET_MAX_RECORDS = 500;
export const PAIRWISE_DATA_FILE = 'design-evaluation-dataset';

export type PairwisePreference = 'A' | 'B' | 'EQUIVALENT';
export type PairwiseSystemPreference = PairwisePreference | 'UNKNOWN';
export type PairwiseReferenceStatus = 'SYSTEM_ONLY' | 'HUMAN_CONFIRMED';

export const PAIRWISE_CRITERIA: readonly { readonly id: AqsDimensionId; readonly label: string }[] = [
  { id: 'visual_hierarchy', label: 'Hiérarchie visuelle' },
  { id: 'composition', label: 'Composition' },
  { id: 'typography', label: 'Typographie' },
  { id: 'color_harmony', label: 'Harmonie des couleurs' },
  { id: 'spacing_rhythm', label: 'Rythme des espacements' },
  { id: 'component_quality', label: 'Qualité des composants' },
  { id: 'visual_balance', label: 'Équilibre visuel' },
  { id: 'information_density', label: 'Densité informationnelle' },
  { id: 'interaction_design', label: 'Design des interactions' },
  { id: 'responsive_quality', label: 'Qualité responsive' },
  { id: 'brand_alignment', label: 'Alignement de marque' },
  { id: 'perceived_quality', label: 'Qualité perçue' }
];

export interface PairwiseCriterion {
  readonly id: AqsDimensionId;
  readonly label: string;
  readonly before: number | null;
  readonly after: number | null;
  readonly delta: number | null;
  readonly comparable: boolean;
  readonly evidence: readonly string[];
}

export interface PairwiseEvaluation {
  readonly version: typeof PAIRWISE_EVALUATION_VERSION;
  readonly evaluationId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly beforeVersionId: string;
  readonly afterVersionId: string;
  readonly beforeOverall: number | null;
  readonly afterOverall: number | null;
  readonly overallDelta: number | null;
  readonly criteria: readonly PairwiseCriterion[];
  readonly comparableCriteria: number;
  readonly coverage: number;
  readonly systemPreference: PairwiseSystemPreference;
  readonly systemConfidence: number;
  readonly humanPreference: PairwisePreference | null;
  readonly finalPreference: PairwiseSystemPreference;
  readonly referenceStatus: PairwiseReferenceStatus;
  readonly improvements: readonly string[];
  readonly regressions: readonly string[];
  readonly selfGradingWarning: string | null;
  readonly conclusion: string;
  readonly notes: string | null;
  readonly evaluatorId: string;
  readonly evaluatedAt: string;
}

export interface PairwiseEvaluationInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly beforeVersionId: string;
  readonly afterVersionId: string;
  readonly before: AestheticQualityScore;
  readonly after: AestheticQualityScore;
  readonly humanPreference?: PairwisePreference | null | undefined;
  readonly evaluatorId?: string | undefined;
  readonly notes?: string | undefined;
  readonly evaluatedAt?: string | undefined;
}

export class PairwiseEvaluationError extends Error {
  public readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'PairwiseEvaluationError';
    this.field = field;
  }
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function subScoreMap(aqs: AestheticQualityScore): Map<AqsDimensionId, number | null> {
  return new Map(aqs.subScores.map((score) => [score.id, score.value]));
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((total, value) => total + value, 0) / values.length);
}

function deterministicEvaluationId(input: {
  tenantId: string;
  projectId: string;
  beforeVersionId: string;
  afterVersionId: string;
  before: AestheticQualityScore;
  after: AestheticQualityScore;
}): string {
  const payload = JSON.stringify({
    tenantId: input.tenantId.trim(),
    projectId: input.projectId.trim(),
    beforeVersionId: input.beforeVersionId.trim(),
    afterVersionId: input.afterVersionId.trim(),
    beforeOverall: input.before.overall,
    afterOverall: input.after.overall,
    beforeScores: input.before.subScores.map((score) => [score.id, score.value]),
    afterScores: input.after.subScores.map((score) => [score.id, score.value])
  });
  return 'pw-' + createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 16);
}

function normalizeHumanPreference(value: unknown): PairwisePreference | null {
  if (value === null || value === undefined || value === '') return null;
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (text === 'A' || text === 'B' || text === 'EQUIVALENT') return text;
  throw new PairwiseEvaluationError(
    'humanPreference',
    '"humanPreference" doit valoir A, B ou EQUIVALENT.'
  );
}

/**
 * Évalue deux versions à partir de leurs AQS RÉELS.
 * `systemPreference` est un avis mesuré, jamais une vérité : il devient
 * `finalPreference` uniquement en l'absence de préférence humaine.
 */
export function evaluatePairwiseVisual(input: PairwiseEvaluationInput): PairwiseEvaluation {
  const humanPreference = normalizeHumanPreference(input.humanPreference);
  const evaluatorId = (input.evaluatorId ?? '').trim();
  if (humanPreference !== null && evaluatorId.length < 2) {
    throw new PairwiseEvaluationError(
      'evaluatorId',
      'Une préférence humaine exige "evaluatorId" (2 caractères minimum).'
    );
  }

  const beforeMap = subScoreMap(input.before);
  const afterMap = subScoreMap(input.after);
  const criteria: PairwiseCriterion[] = PAIRWISE_CRITERIA.map(({ id, label }) => {
    const before = beforeMap.get(id) ?? null;
    const after = afterMap.get(id) ?? null;
    const comparable = before !== null && after !== null;
    return {
      id,
      label,
      before,
      after,
      delta: comparable ? round((after as number) - (before as number)) : null,
      comparable,
      evidence: comparable
        ? [`AQS ${id} : ${before} → ${after}`]
        : [`AQS ${id} non comparable (mesure absente d'un côté au moins)`]
    };
  });

  const comparableCriteria = criteria.filter((criterion) => criterion.comparable).length;
  const coverage = round(
    Math.max(
      0,
      Math.min(
        1,
        (input.before.coverage + input.after.coverage + comparableCriteria / PAIRWISE_CRITERIA.length) / 3
      )
    ),
    3
  );

  const beforeFallback = average(
    criteria.map((criterion) => criterion.before).filter((value): value is number => value !== null)
  );
  const afterFallback = average(
    criteria.map((criterion) => criterion.after).filter((value): value is number => value !== null)
  );
  const beforeOverall = input.before.overall ?? beforeFallback;
  const afterOverall = input.after.overall ?? afterFallback;
  const overallDelta =
    beforeOverall !== null && afterOverall !== null ? round(afterOverall - beforeOverall) : null;

  const improvements: string[] = [];
  const regressions: string[] = [];
  for (const criterion of criteria) {
    if (criterion.delta === null || criterion.delta === 0) continue;
    const formatted = `${criterion.delta > 0 ? '+' : ''}${criterion.delta} ${criterion.label.toLowerCase()}`;
    if (criterion.delta > 0) improvements.push(formatted);
    else regressions.push(formatted);
  }

  let systemPreference: PairwiseSystemPreference = 'UNKNOWN';
  if (overallDelta !== null && comparableCriteria >= 3 && coverage >= PAIRWISE_MIN_COVERAGE) {
    if (overallDelta >= PAIRWISE_DECISION_THRESHOLD) systemPreference = 'B';
    else if (overallDelta <= -PAIRWISE_DECISION_THRESHOLD) systemPreference = 'A';
    else systemPreference = 'EQUIVALENT';
  }

  const agreement = systemPreference === 'UNKNOWN' ? 0 : Math.min(1, comparableCriteria / PAIRWISE_CRITERIA.length + 0.35);
  const systemConfidence = round(Math.min(1, coverage * (0.55 + 0.45 * agreement)), 3);
  const finalPreference: PairwiseSystemPreference = humanPreference ?? systemPreference;
  const referenceStatus: PairwiseReferenceStatus = humanPreference === null ? 'SYSTEM_ONLY' : 'HUMAN_CONFIRMED';

  let conclusion: string;
  if (humanPreference !== null) {
    const systemLabel = systemPreference === 'UNKNOWN' ? 'indéterminée' : systemPreference;
    conclusion =
      `Préférence humaine : ${humanPreference} (système : ${systemLabel}). ` +
      (overallDelta === null
        ? 'Delta global non mesurable.'
        : `Delta AQS global : ${overallDelta > 0 ? '+' : ''}${overallDelta}.`);
  } else if (systemPreference === 'B') {
    conclusion =
      `Version B améliore : ${improvements.slice(0, 3).join(', ') || 'delta global positif'}. ` +
      (regressions.length === 0 ? 'Aucune régression détectée. ' : `Régressions : ${regressions.join(', ')}. `) +
      'Recommandation : ACCEPT (à confirmer par un humain).';
  } else if (systemPreference === 'A') {
    conclusion =
      `Version A reste préférable : ${regressions.slice(0, 3).join(', ') || 'delta global négatif'}. ` +
      'Recommandation : KEEP (à confirmer par un humain).';
  } else if (systemPreference === 'EQUIVALENT') {
    conclusion = 'Les deux versions sont équivalentes sur les preuves mesurées. Recommandation : KEEP.';
  } else {
    conclusion =
      'Préférence système indéterminée : couverture AQS insuffisante ou delta non mesurable. ' +
      'Aucune recommandation fabriquée.';
  }

  const evaluationId = deterministicEvaluationId({
    tenantId: input.tenantId,
    projectId: input.projectId,
    beforeVersionId: input.beforeVersionId,
    afterVersionId: input.afterVersionId,
    before: input.before,
    after: input.after
  });

  return deepFreeze({
    version: PAIRWISE_EVALUATION_VERSION,
    evaluationId,
    tenantId: input.tenantId.trim(),
    projectId: input.projectId.trim(),
    beforeVersionId: input.beforeVersionId.trim(),
    afterVersionId: input.afterVersionId.trim(),
    beforeOverall,
    afterOverall,
    overallDelta,
    criteria,
    comparableCriteria,
    coverage,
    systemPreference,
    systemConfidence,
    humanPreference,
    finalPreference,
    referenceStatus,
    improvements,
    regressions,
    selfGradingWarning:
      humanPreference === null
        ? 'Évaluation système seule : à confirmer par une préférence humaine (CDC V8.1 §9).'
        : null,
    conclusion,
    notes: input.notes !== undefined && input.notes.trim().length > 0 ? input.notes.trim() : null,
    evaluatorId: humanPreference === null ? 'system' : evaluatorId,
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString()
  });
}

/** Ajoute ou remplace la préférence humaine d'une évaluation (non destructive). */
export function withHumanPreference(
  evaluation: PairwiseEvaluation,
  preference: PairwisePreference,
  evaluatorId: string,
  evaluatedAt: string,
  notes?: string | undefined
): PairwiseEvaluation {
  const normalizedPreference = normalizeHumanPreference(preference);
  if (normalizedPreference === null) {
    throw new PairwiseEvaluationError('preference', '"preference" est obligatoire.');
  }
  const author = evaluatorId.trim();
  if (author.length < 2) {
    throw new PairwiseEvaluationError(
      'evaluatorId',
      'Une préférence humaine exige "evaluatorId" (2 caractères minimum).'
    );
  }
  const finalPreference = normalizedPreference;
  return deepFreeze({
    ...structuredClone(evaluation),
    humanPreference: normalizedPreference,
    finalPreference,
    referenceStatus: 'HUMAN_CONFIRMED' as const,
    selfGradingWarning: null,
    evaluatorId: author,
    evaluatedAt,
    notes:
      notes !== undefined && notes.trim().length > 0
        ? notes.trim()
        : evaluation.notes,
    conclusion:
      `Préférence humaine : ${normalizedPreference} ` +
      `(système : ${evaluation.systemPreference}). ` +
      (evaluation.overallDelta === null
        ? 'Delta global non mesurable.'
        : `Delta AQS global : ${evaluation.overallDelta > 0 ? '+' : ''}${evaluation.overallDelta}.`)
  });
}

interface StoredDataset {
  records: Record<string, PairwiseEvaluation[]>;
}

export function pairwiseDatasetKey(tenantId: string, projectId: string): string {
  return `${tenantId.trim()}:${projectId.trim()}`;
}

export class DesignEvaluationDatasetStore {
  private state: StoredDataset = { records: {} };
  private readonly persistent: boolean;
  private readonly filePath: string;

  constructor(options?: { persist?: boolean }) {
    this.persistent = options?.persist === true;
    this.filePath = dataFilePath(PAIRWISE_DATA_FILE);
    if (this.persistent) {
      try {
        const loaded = readJsonFile<StoredDataset>(this.filePath, { records: {} });
        if (loaded && typeof loaded === 'object' && loaded.records && typeof loaded.records === 'object') {
          this.state = { records: loaded.records };
        }
      } catch {
        this.state = { records: {} };
      }
    }
  }

  private persist(): void {
    if (!this.persistent) return;
    try {
      writeJsonFileSync(this.filePath, this.state);
    } catch {
      // FAILURE-SAFE.
    }
  }

  public record(evaluation: PairwiseEvaluation): { evaluation: PairwiseEvaluation; created: boolean } {
    const key = pairwiseDatasetKey(evaluation.tenantId, evaluation.projectId);
    const entries = this.state.records[key] ?? [];
    const existingIndex = entries.findIndex((entry) => entry.evaluationId === evaluation.evaluationId);
    if (existingIndex >= 0) {
      const existing = entries[existingIndex]!;
      // Une évaluation système seule peut être complétée par la MÊME paire
      // avec une préférence humaine : le dataset ne doit pas rester bloqué
      // en SYSTEM_ONLY. Une confirmation explicite reste prioritaire.
      if (existing.referenceStatus === 'SYSTEM_ONLY' && evaluation.referenceStatus === 'HUMAN_CONFIRMED') {
        const upgraded = deepFreeze(structuredClone(evaluation));
        entries[existingIndex] = upgraded;
        this.state.records[key] = entries;
        this.persist();
        return { evaluation: upgraded, created: false };
      }
      return { evaluation: existing, created: false };
    }
    entries.push(deepFreeze(structuredClone(evaluation)));
    this.state.records[key] = entries.slice(-PAIRWISE_DATASET_MAX_RECORDS);
    this.persist();
    return { evaluation: evaluation, created: true };
  }

  public list(tenantId: string, projectId: string, limit = 100): readonly PairwiseEvaluation[] {
    const entries = this.state.records[pairwiseDatasetKey(tenantId, projectId)] ?? [];
    const bounded = Math.max(1, Math.min(PAIRWISE_DATASET_MAX_RECORDS, Math.round(limit)));
    return entries
      .filter((entry) => entry.tenantId === tenantId.trim() && entry.projectId === projectId.trim())
      .slice(-bounded)
      .reverse();
  }

  public get(tenantId: string, projectId: string, evaluationId: string): PairwiseEvaluation | undefined {
    return this.list(tenantId, projectId, PAIRWISE_DATASET_MAX_RECORDS).find(
      (entry) => entry.evaluationId === evaluationId
    );
  }

  public setHumanPreference(params: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly evaluationId: string;
    readonly preference: PairwisePreference;
    readonly evaluatorId: string;
    readonly evaluatedAt: string;
    readonly notes?: string | undefined;
  }): PairwiseEvaluation | undefined {
    const key = pairwiseDatasetKey(params.tenantId, params.projectId);
    const entries = this.state.records[key];
    if (!entries) return undefined;
    const index = entries.findIndex((entry) => entry.evaluationId === params.evaluationId);
    if (index < 0) return undefined;
    const updated = withHumanPreference(
      entries[index]!,
      params.preference,
      params.evaluatorId,
      params.evaluatedAt,
      params.notes
    );
    entries[index] = updated;
    this.state.records[key] = entries;
    this.persist();
    return updated;
  }

  public stats(tenantId: string, projectId: string): {
    readonly total: number;
    readonly humanConfirmed: number;
    readonly systemOnly: number;
  } {
    const entries = this.list(tenantId, projectId, PAIRWISE_DATASET_MAX_RECORDS);
    const humanConfirmed = entries.filter((entry) => entry.referenceStatus === 'HUMAN_CONFIRMED').length;
    return {
      total: entries.length,
      humanConfirmed,
      systemOnly: entries.length - humanConfirmed
    };
  }

  public clear(): void {
    this.state = { records: {} };
    this.persist();
  }
}

/** Singleton de production — dataset persistant. */
export const designEvaluationDatasetStore = new DesignEvaluationDatasetStore({ persist: true });
