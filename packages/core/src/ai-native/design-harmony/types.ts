/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-012)
 * Design Harmony Engine - Data Contracts
 */

import type { VisualSnapshot } from '../visual-intelligence/types.js';

export type HarmonyCategory =
  | 'COLOR'
  | 'TYPOGRAPHY'
  | 'SPACING'
  | 'SHAPE'
  | 'ELEVATION'
  | 'COMPONENT'
  | 'CROSS_PAGE'
  | 'RESPONSIVE'
  | 'ACCESSIBILITY';

export type HarmonySeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface DesignEvidence {
  readonly source: 'DOM_SNAPSHOT' | 'COMPUTED_STYLE' | 'LAYOUT_BOX' | 'WCAG_CALCULATION';
  readonly detail: string;
  readonly pageRoute: string;
  readonly selector?: string | undefined;
  readonly nodeId?: string | undefined;
  readonly occurrences: number;
}

export interface DesignHarmonyFinding {
  readonly id: string;
  readonly category: HarmonyCategory;
  readonly severity: HarmonySeverity;
  readonly confidence: number;
  readonly pageRoute: string;
  readonly selector?: string | undefined;
  readonly property: string;
  readonly observedValue: string | number;
  readonly expectedValue?: string | number | undefined;
  readonly deviation?: string | number | undefined;
  readonly evidence: readonly DesignEvidence[];
  readonly recommendation: string;
  readonly designDrift: boolean;
  readonly relatedComponents?: readonly string[] | undefined;
}

export interface ColorRoleTokens {
  readonly primary?: string | undefined;
  readonly secondary?: string | undefined;
  readonly accent?: string | undefined;
  readonly background?: string | undefined;
  readonly surface?: string | undefined;
  readonly foreground?: string | undefined;
  readonly muted?: string | undefined;
  readonly border?: string | undefined;
  readonly success?: string | undefined;
  readonly warning?: string | undefined;
  readonly error?: string | undefined;
  readonly info?: string | undefined;
}

export interface TypographyTokens {
  readonly primaryFontFamily: string;
  readonly fontFamilies: readonly string[];
  readonly detectedScale: readonly string[];
  readonly dominantLineHeightRatio: number;
  /** CDC V8 §7.2 — rôle typographique dérivé des tailles RÉELLEMENT observées. */
  readonly styleScale?: TypographyStyleScale | undefined;
  readonly fontWeights?: readonly string[] | undefined;
  readonly letterSpacings?: readonly string[] | undefined;
}

export interface TypographyStyleScale {
  readonly display?: string | undefined;
  readonly h1?: string | undefined;
  readonly h2?: string | undefined;
  readonly h3?: string | undefined;
  readonly body?: string | undefined;
  readonly small?: string | undefined;
  readonly caption?: string | undefined;
}

export interface SpacingTokens {
  readonly baseGridStep: number;
  readonly detectedScale: readonly number[];
  readonly regularityRatio: number;
}

export interface ShapeTokens {
  readonly primaryButtonRadius: string;
  readonly primaryCardRadius: string;
  readonly primaryInputRadius: string;
  readonly detectedRadii: readonly string[];
  /** CDC V8 §7.4 — échelle XS→XL dérivée des rayons observés. */
  readonly radiusScale?: RadiusScale | undefined;
}

export interface RadiusScale {
  readonly xs?: string | undefined;
  readonly sm?: string | undefined;
  readonly md?: string | undefined;
  readonly lg?: string | undefined;
  readonly xl?: string | undefined;
}

export interface ElevationTokens {
  readonly detectedLevelsCount: number;
  readonly shadowLevels: readonly string[];
  /** CDC V8 §7.5 — niveaux NONE/SUBTLE/MEDIUM/STRONG réellement observés. */
  readonly levels?: readonly ElevationLevelToken[] | undefined;
}

export interface ElevationLevelToken {
  readonly level: 'NONE' | 'SUBTLE' | 'MEDIUM' | 'STRONG';
  readonly value: string;
}

/**
 * CDC V8 §7.6 — Motion tokens. Toutes les listes sont vides quand aucune
 * preuve n'est observée : jamais de durée/easing inventés.
 */
export interface MotionTokens {
  readonly durations: readonly string[];
  readonly easings: readonly string[];
  readonly transitions: readonly string[];
  readonly hover: readonly string[];
  readonly feedback: readonly string[];
  readonly entrance: readonly string[];
  readonly exit: readonly string[];
  readonly evidenceCount: number;
}

/**
 * CDC V8 §7.7 — Layout tokens. `breakpoints` provient des @media réellement
 * déclarés ; `density` est DÉRIVÉE des espacements observés (jamais devinée).
 */
export interface LayoutTokens {
  readonly containerWidth?: string | undefined;
  readonly gridTemplateColumns: readonly string[];
  readonly gutters: readonly string[];
  readonly breakpoints: readonly string[];
  readonly density?: 'COMPACT' | 'BALANCED' | 'SPACIOUS' | undefined;
  readonly evidenceCount: number;
}

export interface InferredDesignSystem {
  readonly colorTokens: ColorRoleTokens;
  readonly typographyTokens: TypographyTokens;
  readonly spacingTokens: SpacingTokens;
  readonly shapeTokens: ShapeTokens;
  readonly elevationTokens: ElevationTokens;
  /** CDC V8 §7.6 — absent des snapshots historiques, jamais fabriqué. */
  readonly motionTokens?: MotionTokens | undefined;
  /** CDC V8 §7.7 — absent des snapshots historiques, jamais fabriqué. */
  readonly layoutTokens?: LayoutTokens | undefined;
  readonly systemConfidence: number;
  readonly evidenceCount: number;
}

export interface HarmonySubScores {
  readonly colorHarmony: number;
  readonly typographyHarmony: number;
  readonly spacingHarmony: number;
  readonly shapeHarmony: number;
  readonly elevationHarmony: number;
  readonly componentHarmony: number;
  readonly crossPageHarmony: number;
  readonly responsiveA11yHarmony: number;
}

export interface DesignHarmonyReport {
  readonly reportId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly analyzedRoutes: readonly string[];
  readonly overallScore: number;
  readonly subScores: HarmonySubScores;
  readonly inferredDesignSystem: InferredDesignSystem;
  readonly findings: readonly DesignHarmonyFinding[];
  readonly driftSummary: {
    readonly totalDrifts: number;
    readonly criticalDrifts: number;
  };
  readonly reportHash: string;
  readonly generatedAt: string;
  readonly durationMs: number;
  readonly llmSummary?: string | undefined;
}

export interface DesignHarmonyComparison {
  readonly previousReportId: string;
  readonly currentReportId: string;
  readonly scoreDelta: number;
  readonly improvements: readonly string[];
  readonly regressions: readonly string[];
  readonly newDrifts: readonly DesignHarmonyFinding[];
  readonly resolvedDrifts: readonly string[];
}

export interface DesignHarmonyConfig {
  readonly cacheMaxEntries: number;
  readonly minConfidenceThreshold: number;
  readonly customGridBase?: number | undefined;
  readonly enableLLMSynthesis?: boolean | undefined;
}

export interface DesignHarmonyRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly snapshots: readonly VisualSnapshot[];
  readonly config?: Partial<DesignHarmonyConfig> | undefined;
  readonly requestId?: string | undefined;
}

// ============================================================================
// CDC V8 §13 — DESIGN CRITIC ENGINE (hiérarchie / composition / esthétique /
// UX visuelle / qualité perçue). Aucun score fabriqué : une axe sans preuve
// suffisante vaut null (UNKNOWN) avec sa raison.
// ============================================================================

export type CriticAxisId =
  | 'VISUAL_HIERARCHY'
  | 'COMPOSITION'
  | 'AESTHETICS'
  | 'VISUAL_UX'
  | 'PERCEIVED_QUALITY';

export type CriticSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface CriticFinding {
  /** Identifiant DÉTERMINISTE (axe + code + rang), jamais aléatoire. */
  readonly id: string;
  readonly axis: CriticAxisId;
  readonly code: string;
  readonly severity: CriticSeverity;
  readonly message: string;
  readonly evidence: string;
}

export interface CriticAxisScore {
  readonly axis: CriticAxisId;
  /** null = UNKNOWN : preuves insuffisantes pour mesurer cet axe. */
  readonly score: number | null;
  readonly confidence: number;
  readonly evidence: readonly string[];
  readonly unknownReason?: string | undefined;
}

export interface DesignCritique {
  readonly axes: readonly CriticAxisScore[];
  readonly findings: readonly CriticFinding[];
  /** Nombre d'axes réellement mesurés / 5. */
  readonly coverage: number;
  readonly layoutSource: 'RUNTIME' | 'ESTIMATED';
  readonly evaluatedAt: string;
}

// ============================================================================
// CDC V8 §14 — AESTHETIC QUALITY SCORE (AQS) : 12 sous-scores du CDC.
// Chaque sous-score est soit mesuré (0-100 + preuves), soit UNKNOWN (null).
// Aucune valeur de remplissage.
// ============================================================================

export type AqsDimensionId =
  | 'visual_hierarchy'
  | 'composition'
  | 'typography'
  | 'color_harmony'
  | 'spacing_rhythm'
  | 'component_quality'
  | 'visual_balance'
  | 'information_density'
  | 'interaction_design'
  | 'responsive_quality'
  | 'brand_alignment'
  | 'perceived_quality';

export interface AqsSubScore {
  readonly id: AqsDimensionId;
  readonly label: string;
  readonly value: number | null;
  readonly confidence: number;
  readonly evidence: readonly string[];
  readonly unknownReason?: string | undefined;
}

export interface AestheticQualityScore {
  readonly version: '8.0';
  readonly determinism: 'DETERMINISTIC';
  readonly overall: number | null;
  readonly subScores: readonly AqsSubScore[];
  readonly computedCount: number;
  readonly unknownCount: number;
  /** Poids réellement couvert par les sous-scores mesurés (0..1). */
  readonly coverage: number;
}

export interface AestheticQualityInput {
  readonly snapshot: VisualSnapshot;
  readonly critique: DesignCritique;
  readonly tokens: InferredDesignSystem;
  readonly responsiveFindings?: readonly DesignHarmonyFinding[] | undefined;
  readonly mobileSnapshot?: VisualSnapshot | undefined;
  readonly mobileOverflow?: { readonly overflowX: boolean; readonly wideElements: number } | undefined;
}

// ============================================================================
// CDC V8 §17-§21 — BOUCLE D'AMÉLIORATION VISUELLE, PROTECTION ANTI-RÉGRESSION,
// COMPARAISON DE VERSIONS ET CONTRÔLE HUMAIN (Lot B).
//
// Aucune décision n'est inventée : la boucle s'appuie uniquement sur des
// mesures AQS réelles (sous-scores mesurés ou UNKNOWN) et sur les preuves
// runtime (erreurs, findings, overflow mobile, HTML avant/après).
// ============================================================================

/** §18 — critère d'arrêt RÉEL de la boucle d'optimisation itérative. */
export type ImprovementLoopStopReason =
  | 'TARGET_REACHED'        // quality target atteint
  | 'DELTA_BELOW_THRESHOLD' // improvement delta < threshold (y compris <= 0)
  | 'MAX_ITERATIONS'        // borne de sécurité atteinte
  | 'NO_ACTIONABLE_WEAKNESS'// aucune faiblesse mesurée à corriger
  | 'REGRESSION_PROTECTED'  // §19 : garde-fou FAIL -> rollback
  | 'MODIFICATION_FAILED'   // le modifier n'a produit aucun HTML exploitable
  | 'SCORE_UNMEASURABLE';   // AQS global non mesurable : aucune décision possible

/** Ce qu'une passe de mesure a réellement observé. */
export interface AestheticMeasurement {
  readonly aqs: AestheticQualityScore;
  readonly critique: DesignCritique;
  readonly responsiveFindings: readonly DesignHarmonyFinding[];
  readonly runtimeErrors: readonly string[];
  readonly mobileOverflow?: { readonly overflowX: boolean; readonly wideElements: number } | undefined;
}

/** §17 — faiblesse identifiée sur un sous-score RÉELLEMENT mesuré. */
export interface ImprovementWeakness {
  readonly dimension: AqsDimensionId;
  readonly label: string;
  /** Valeur mesurée (0-100). */
  readonly currentValue: number;
  /** Poids AQS de la dimension (documenté, somme = 1). */
  readonly weight: number;
  /** Gain AQS potentiel = poids × (cible − valeur), arrondi à 0,1. */
  readonly potentialGain: number;
  readonly evidence: readonly string[];
}

/** §21 — proposition WHY / WHAT / IMPACT / RISKS pour une faiblesse. */
export interface ImprovementProposal {
  readonly dimension: AqsDimensionId;
  readonly label: string;
  readonly why: string;
  readonly what: string;
  readonly impact: string;
  readonly risks: readonly string[];
}

/** §17 — plan d'amélioration généré à partir des faiblesses mesurées. */
export interface ImprovementPlan {
  /** Id DÉTERMINISTE : itération + dimensions visées. */
  readonly planId: string;
  readonly iteration: number;
  readonly targetOverall: number;
  readonly currentOverall: number;
  readonly weaknesses: readonly ImprovementWeakness[];
  readonly proposals: readonly ImprovementProposal[];
}

/** §19 — ordre du pipeline de garde-fous du CDC. */
export type RegressionGuardId =
  | 'FUNCTIONAL'
  | 'ACCESSIBILITY'
  | 'SECURITY'
  | 'RESPONSIVE'
  | 'REGRESSION';

export type RegressionGuardStatus = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface RegressionGuardResult {
  readonly guard: RegressionGuardId;
  readonly status: RegressionGuardStatus;
  readonly summary: string;
  readonly evidence: readonly string[];
}

export type RegressionVerdict = 'APPROVE' | 'ROLLBACK';

export interface RegressionGuardEvaluation {
  readonly verdict: RegressionVerdict;
  readonly guards: readonly RegressionGuardResult[];
  /** Résumés des garde-fous en échec (vide si APPROVE). */
  readonly reasons: readonly string[];
}

/** Entrée du garde-fou §19 — toutes les preuves avant/après. */
export interface RegressionGuardInput {
  readonly htmlBefore: string;
  readonly htmlAfter: string;
  readonly aqsBefore: AestheticQualityScore;
  readonly aqsAfter: AestheticQualityScore;
  readonly runtimeErrorsBefore: readonly string[];
  readonly runtimeErrorsAfter: readonly string[];
  readonly findingsBefore: readonly DesignHarmonyFinding[];
  readonly findingsAfter: readonly DesignHarmonyFinding[];
  readonly mobileOverflowBefore?: { readonly overflowX: boolean; readonly wideElements: number } | undefined;
  readonly mobileOverflowAfter?: { readonly overflowX: boolean; readonly wideElements: number } | undefined;
  /** Tolérance de régression par dimension/global (points AQS). Défaut : 2. */
  readonly dimensionTolerance?: number | undefined;
}

/** §20 — dimensions de comparaison demandées par le CDC. */
export type VisualVersionDimensionId =
  | 'score'
  | 'hierarchy'
  | 'layout'
  | 'colors'
  | 'spacing'
  | 'components'
  | 'typography'
  | 'responsive';

export interface VisualVersionDimensionDelta {
  readonly id: VisualVersionDimensionId;
  readonly label: string;
  /** Sous-scores AQS réellement utilisés comme sources. */
  readonly sources: readonly AqsDimensionId[];
  /** Moyenne des sources comparables, null si aucune source mesurable. */
  readonly before: number | null;
  readonly after: number | null;
  /** after − before (entier), null si non comparable. */
  readonly delta: number | null;
  /** Sources mesurées des DEUX côtés (seules utilisées pour le delta). */
  readonly comparableSources: readonly AqsDimensionId[];
}

export type VisualVersionRecommendation = 'ACCEPT' | 'REJECT' | 'KEEP';

/** §20 — verdict automatique de comparaison Version A vs Version B. */
export interface VisualVersionComparison {
  readonly beforeOverall: number | null;
  readonly afterOverall: number | null;
  readonly scoreDelta: number | null;
  readonly dimensions: readonly VisualVersionDimensionDelta[];
  /** Ex. : « +8 hierarchy » (format du CDC). */
  readonly improvements: readonly string[];
  /** Ex. : « -3 spacing ». */
  readonly regressions: readonly string[];
  readonly noRegressionDetected: boolean;
  readonly recommendation: VisualVersionRecommendation;
  /** Conclusion lisible, au format du CDC. */
  readonly conclusion: string;
}

/** §21 — rapport de contrôle humain pour une itération. */
export interface ImprovementHumanReport {
  readonly why: readonly string[];
  readonly what: readonly string[];
  readonly impact: string;
  readonly before: number | null;
  readonly after: number | null;
  readonly scoreDelta: number | null;
  readonly risks: readonly string[];
}

/** §17 — une itération réelle de la boucle (mesure → plan → modif → compare). */
export interface ImprovementIteration {
  readonly iteration: number;
  readonly plan: ImprovementPlan;
  readonly aqsBefore: number | null;
  readonly aqsAfter: number | null;
  readonly delta: number | null;
  readonly modified: boolean;
  readonly guardVerdict: RegressionVerdict | null;
  readonly guards: readonly RegressionGuardResult[];
  readonly comparison: VisualVersionComparison | null;
  readonly report: ImprovementHumanReport;
  readonly accepted: boolean;
  readonly stopReason?: ImprovementLoopStopReason | undefined;
}

export interface ImprovementLoopOptions {
  /** Cible AQS (quality target du CDC §18). Défaut : 90. */
  readonly target?: number | undefined;
  /** Delta minimal conservé (défaut : 2 points). */
  readonly deltaThreshold?: number | undefined;
  /** Nombre maximal d'itérations (défaut : 2, borne : 4). */
  readonly maxIterations?: number | undefined;
  /** Tolérance de non-régression par dimension (défaut : 2). */
  readonly dimensionTolerance?: number | undefined;
}

export interface ImprovementLoopOutcome {
  readonly iterations: readonly ImprovementIteration[];
  readonly initialOverall: number | null;
  readonly finalOverall: number | null;
  readonly totalDelta: number | null;
  readonly target: number;
  readonly targetReached: boolean;
  readonly stopReason: ImprovementLoopStopReason;
  /** Vrai si au moins une itération a été acceptée par les garde-fous. */
  readonly applied: boolean;
  /** HTML de l'état accepté final (l'original si rien n'a été accepté). */
  readonly finalHtml: string;
}
