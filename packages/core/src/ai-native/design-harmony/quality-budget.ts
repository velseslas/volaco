/**
 * VibeCode Core - Design Harmony
 * CDC V8.1 WOW §18 — QUALITY BUDGETS.
 *
 * Un budget de qualité est un contrat EXÉCUTABLE, pas une intention :
 *  - il borne les itérations, les tokens, le temps de calcul, les changements
 *    visuels, les fichiers touchés et la latence d'un appel ;
 *  - il fixe la cible AQS et le delta minimum d'une amélioration ;
 *  - chaque exécution réelle peut être confrontée au budget (usage mesuré),
 *    avec un statut OK / EXHAUSTED explicite.
 *
 * Aucune valeur de remplissage : une limite absente prend le défaut documenté,
 * une valeur invalide est refusée en mode strict ou ramenée dans ses bornes en
 * mode tolérant. Le budget n'est jamais modifié par l'exécution.
 */

import { deepFreeze } from '../ai-orchestrator/canonical.js';

export const QUALITY_BUDGET_VERSION = '8.1' as const;

export const MIN_USEFUL_TOKENS_PER_CALL = 64;

export interface QualityBudget {
  readonly version: typeof QUALITY_BUDGET_VERSION;
  /** Nombre maximum d'itérations mesurées (1..4). */
  readonly maxIterations: number;
  /** Total de tokens réellement consommables sur l'exécution (pas par appel). */
  readonly maxTokens: number;
  /** Budget de calcul mural total de l'exécution, en millisecondes. */
  readonly maxComputeMs: number;
  /** Nombre de modifications visuelles candidates autorisées. */
  readonly maxVisualChanges: number;
  /** Nombre de fichiers que l'exécution peut modifier. */
  readonly maxFilesChanged: number;
  /** Latence maximum d'un appel modèle, en millisecondes. */
  readonly maxLatencyMs: number;
  /** Cible AQS (0..100) — atteinte = arrêt propre. */
  readonly qualityTarget: number;
  /** Delta AQS minimum considéré comme une amélioration (points). */
  readonly minimumImprovementDelta: number;
}

export const QUALITY_BUDGET_BOUNDS = deepFreeze({
  maxIterations: { min: 1, max: 4 },
  maxTokens: { min: 64, max: 131_072 },
  maxComputeMs: { min: 1_000, max: 900_000 },
  maxVisualChanges: { min: 0, max: 4 },
  maxFilesChanged: { min: 1, max: 10 },
  maxLatencyMs: { min: 1_000, max: 300_000 },
  qualityTarget: { min: 0, max: 100 },
  minimumImprovementDelta: { min: 0, max: 25 }
} as const);

export const DEFAULT_QUALITY_BUDGET: QualityBudget = deepFreeze({
  version: QUALITY_BUDGET_VERSION,
  maxIterations: 2,
  maxTokens: 16_384,
  maxComputeMs: 180_000,
  maxVisualChanges: 2,
  maxFilesChanged: 1,
  maxLatencyMs: 60_000,
  qualityTarget: 90,
  minimumImprovementDelta: 2
});

export type QualityBudgetField = Exclude<keyof QualityBudget, 'version'>;

export const QUALITY_BUDGET_FIELDS: readonly QualityBudgetField[] = [
  'maxIterations',
  'maxTokens',
  'maxComputeMs',
  'maxVisualChanges',
  'maxFilesChanged',
  'maxLatencyMs',
  'qualityTarget',
  'minimumImprovementDelta'
];

const SNAKE_ALIASES: Record<QualityBudgetField, readonly string[]> = {
  maxIterations: ['maxIterations', 'max_iterations'],
  maxTokens: ['maxTokens', 'max_tokens', 'maxTokensTotal', 'max_tokens_total'],
  maxComputeMs: ['maxComputeMs', 'max_compute_ms', 'max_compute'],
  maxVisualChanges: ['maxVisualChanges', 'max_visual_changes'],
  maxFilesChanged: ['maxFilesChanged', 'max_files_changed'],
  maxLatencyMs: ['maxLatencyMs', 'max_latency_ms', 'max_latency'],
  qualityTarget: ['qualityTarget', 'quality_target', 'target'],
  minimumImprovementDelta: ['minimumImprovementDelta', 'minimum_improvement_delta', 'deltaThreshold', 'delta_threshold']
};

export class QualityBudgetValidationError extends Error {
  public readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'QualityBudgetValidationError';
    this.field = field;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readField(source: Record<string, unknown>, field: QualityBudgetField): unknown {
  for (const alias of SNAKE_ALIASES[field]) {
    if (source[alias] !== undefined) return source[alias];
  }
  return undefined;
}

/**
 * Normalise un budget (objet partiel ou complet).
 * - `strict: true` : refuse une valeur non numérique ou hors bornes ;
 * - défaut : ramène dans les bornes (compatibilité des clients historiques).
 */
export function normalizeQualityBudget(
  raw: unknown,
  options: { readonly strict?: boolean; readonly base?: QualityBudget | undefined } = {}
): QualityBudget {
  const source = asRecord(raw);
  const strict = options.strict === true;
  const base = options.base ?? DEFAULT_QUALITY_BUDGET;
  const normalized: Record<QualityBudgetField, number> = {
    maxIterations: base.maxIterations,
    maxTokens: base.maxTokens,
    maxComputeMs: base.maxComputeMs,
    maxVisualChanges: base.maxVisualChanges,
    maxFilesChanged: base.maxFilesChanged,
    maxLatencyMs: base.maxLatencyMs,
    qualityTarget: base.qualityTarget,
    minimumImprovementDelta: base.minimumImprovementDelta
  };

  for (const field of QUALITY_BUDGET_FIELDS) {
    const rawValue = readField(source, field);
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    if (!Number.isFinite(value)) {
      if (strict) {
        throw new QualityBudgetValidationError(field, `"${field}" doit être un nombre fini.`);
      }
      continue;
    }
    const bounds = QUALITY_BUDGET_BOUNDS[field];
    if (strict && (value < bounds.min || value > bounds.max)) {
      throw new QualityBudgetValidationError(
        field,
        `"${field}" doit être compris entre ${bounds.min} et ${bounds.max}.`
      );
    }
    normalized[field] = Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
  }

  return deepFreeze({
    version: QUALITY_BUDGET_VERSION,
    ...normalized
  });
}

/** Options consommées par la boucle d'amélioration (Lot B). */
export interface QualityBudgetLoopOptions {
  readonly maxIterations: number;
  readonly target: number;
  readonly deltaThreshold: number;
}

export function budgetToLoopOptions(budget: QualityBudget): QualityBudgetLoopOptions {
  return {
    maxIterations: budget.maxIterations,
    target: budget.qualityTarget,
    deltaThreshold: budget.minimumImprovementDelta
  };
}

export interface QualityBudgetUsage {
  /** Itérations dont la mesure a réellement démarré. */
  readonly iterationsStarted: number;
  /** Itérations terminées (mesure + plan + tentative de modification). */
  readonly iterationsCompleted: number;
  /** Tokens réellement rapportés par le fournisseur (ou estimés, jamais 0 inventé). */
  readonly tokensUsed: number;
  /** Temps de calcul mural total de l'exécution. */
  readonly computeMs: number;
  /** Modifications candidates produites (bornées par le budget). */
  readonly visualChanges: number;
  /** Fichiers réellement modifiés (0 en mode PLAN). */
  readonly filesChanged: number;
  /** Latence maximale observée sur un appel modèle. */
  readonly maxCallLatencyMs: number;
}

export type QualityBudgetLimitStatus = 'OK' | 'EXHAUSTED';

export interface QualityBudgetLimitCheck {
  readonly id: QualityBudgetField;
  readonly label: string;
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
  readonly unit: 'COUNT' | 'MS' | 'TOKENS' | 'POINTS';
  readonly status: QualityBudgetLimitStatus;
}

export interface QualityBudgetStatus {
  readonly version: typeof QUALITY_BUDGET_VERSION;
  readonly exhausted: boolean;
  readonly exhaustedBy: readonly QualityBudgetField[];
  readonly limits: readonly QualityBudgetLimitCheck[];
  readonly usage: QualityBudgetUsage;
}

export interface QualityBudgetGate {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
  readonly exhaustedBy: readonly QualityBudgetField[];
}

function limitCheck(
  id: QualityBudgetField,
  label: string,
  limit: number,
  used: number,
  unit: QualityBudgetLimitCheck['unit']
): QualityBudgetLimitCheck {
  return {
    id,
    label,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    unit,
    status: used >= limit ? 'EXHAUSTED' : 'OK'
  };
}

export class QualityBudgetTracker {
  private readonly budget: QualityBudget;
  private readonly now: () => number;
  private readonly startedAtMs: number;
  private iterationsStarted = 0;
  private iterationsCompleted = 0;
  private tokensUsed = 0;
  private visualChanges = 0;
  private filesChanged = 0;
  private maxCallLatencyMs = 0;

  constructor(budget: QualityBudget, options: { readonly now?: (() => number) | undefined } = {}) {
    this.budget = budget;
    this.now = options.now ?? (() => Date.now());
    this.startedAtMs = this.now();
  }

  public elapsedMs(): number {
    return Math.max(0, this.now() - this.startedAtMs);
  }

  public remainingTokens(): number {
    return Math.max(0, this.budget.maxTokens - this.tokensUsed);
  }

  public remainingComputeMs(): number {
    return Math.max(0, this.budget.maxComputeMs - this.elapsedMs());
  }

  /** Décide si une NOUVELLE itération peut démarrer, avec les raisons exactes. */
  public canStartIteration(): QualityBudgetGate {
    const reasons: string[] = [];
    const exhaustedBy: QualityBudgetField[] = [];
    if (this.iterationsStarted >= this.budget.maxIterations) {
      reasons.push(`borne d'itérations atteinte (${this.budget.maxIterations})`);
      exhaustedBy.push('maxIterations');
    }
    if (this.visualChanges >= this.budget.maxVisualChanges) {
      reasons.push(`borne de changements visuels atteinte (${this.budget.maxVisualChanges})`);
      exhaustedBy.push('maxVisualChanges');
    }
    const computeMs = this.elapsedMs();
    if (computeMs >= this.budget.maxComputeMs) {
      reasons.push(`budget de calcul épuisé (${computeMs}/${this.budget.maxComputeMs} ms)`);
      exhaustedBy.push('maxComputeMs');
    }
    if (this.remainingTokens() < MIN_USEFUL_TOKENS_PER_CALL) {
      reasons.push(`budget de tokens insuffisant pour un appel (${this.remainingTokens()} restants)`);
      exhaustedBy.push('maxTokens');
    }
    return { allowed: reasons.length === 0, reasons, exhaustedBy };
  }

  public recordIterationStarted(): void {
    this.iterationsStarted += 1;
  }

  public recordIterationCompleted(): void {
    this.iterationsCompleted += 1;
  }

  public recordLlmCall(tokensUsed: number, latencyMs: number): void {
    if (Number.isFinite(tokensUsed) && tokensUsed > 0) {
      this.tokensUsed += Math.round(tokensUsed);
    }
    if (Number.isFinite(latencyMs) && latencyMs > 0) {
      this.maxCallLatencyMs = Math.max(this.maxCallLatencyMs, Math.round(latencyMs));
    }
  }

  public recordVisualChange(filesChanged: number): void {
    this.visualChanges += 1;
    if (Number.isFinite(filesChanged) && filesChanged > 0) {
      this.filesChanged = Math.max(this.filesChanged, Math.round(filesChanged));
    }
  }

  /** Latence maximale autorisée pour le prochain appel (calcul restant inclus). */
  public nextCallTimeoutMs(): number {
    return Math.max(0, Math.min(this.budget.maxLatencyMs, this.remainingComputeMs()));
  }

  /** Tokens maximum à demander au prochain appel, sans dépasser le total. */
  public nextCallMaxTokens(): number {
    return Math.max(0, Math.min(8_192, this.remainingTokens()));
  }

  public usage(): QualityBudgetUsage {
    return {
      iterationsStarted: this.iterationsStarted,
      iterationsCompleted: this.iterationsCompleted,
      tokensUsed: this.tokensUsed,
      computeMs: this.elapsedMs(),
      visualChanges: this.visualChanges,
      filesChanged: this.filesChanged,
      maxCallLatencyMs: this.maxCallLatencyMs
    };
  }

  public status(): QualityBudgetStatus {
    const usage = this.usage();
    const limits: QualityBudgetLimitCheck[] = [
      limitCheck('maxIterations', 'Itérations', this.budget.maxIterations, usage.iterationsStarted, 'COUNT'),
      limitCheck('maxTokens', 'Tokens', this.budget.maxTokens, usage.tokensUsed, 'TOKENS'),
      limitCheck('maxComputeMs', 'Calcul', this.budget.maxComputeMs, usage.computeMs, 'MS'),
      limitCheck('maxVisualChanges', 'Changements visuels', this.budget.maxVisualChanges, usage.visualChanges, 'COUNT'),
      limitCheck('maxFilesChanged', 'Fichiers modifiés', this.budget.maxFilesChanged, usage.filesChanged, 'COUNT'),
      limitCheck('maxLatencyMs', 'Latence appel', this.budget.maxLatencyMs, usage.maxCallLatencyMs, 'MS')
    ];
    const exhaustedBy = limits.filter((limit) => limit.status === 'EXHAUSTED').map((limit) => limit.id);
    return {
      version: QUALITY_BUDGET_VERSION,
      exhausted: exhaustedBy.length > 0,
      exhaustedBy,
      limits,
      usage
    };
  }
}

/** Recalcule un statut à partir d'un usage final (ex. changements acceptés seulement). */
export function evaluateQualityBudgetUsage(
  budget: QualityBudget,
  usage: QualityBudgetUsage
): QualityBudgetStatus {
  const limits: QualityBudgetLimitCheck[] = [
    limitCheck('maxIterations', 'Itérations', budget.maxIterations, usage.iterationsStarted, 'COUNT'),
    limitCheck('maxTokens', 'Tokens', budget.maxTokens, usage.tokensUsed, 'TOKENS'),
    limitCheck('maxComputeMs', 'Calcul', budget.maxComputeMs, usage.computeMs, 'MS'),
    limitCheck('maxVisualChanges', 'Changements visuels', budget.maxVisualChanges, usage.visualChanges, 'COUNT'),
    limitCheck('maxFilesChanged', 'Fichiers modifiés', budget.maxFilesChanged, usage.filesChanged, 'COUNT'),
    limitCheck('maxLatencyMs', 'Latence appel', budget.maxLatencyMs, usage.maxCallLatencyMs, 'MS')
  ];
  const exhaustedBy = limits.filter((limit) => limit.status === 'EXHAUSTED').map((limit) => limit.id);
  return {
    version: QUALITY_BUDGET_VERSION,
    exhausted: exhaustedBy.length > 0,
    exhaustedBy,
    limits,
    usage
  };
}

export interface QualityBudgetExecution {
  readonly executionId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly budget: QualityBudget;
  readonly usage: QualityBudgetUsage;
  readonly status: QualityBudgetStatus;
  readonly stopReason: string;
  readonly applyRequested: boolean;
  readonly modified: boolean;
  readonly approvedBy?: string | undefined;
}
