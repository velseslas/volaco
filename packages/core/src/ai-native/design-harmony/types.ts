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
}

export interface ElevationTokens {
  readonly detectedLevelsCount: number;
  readonly shadowLevels: readonly string[];
}

export interface InferredDesignSystem {
  readonly colorTokens: ColorRoleTokens;
  readonly typographyTokens: TypographyTokens;
  readonly spacingTokens: SpacingTokens;
  readonly shapeTokens: ShapeTokens;
  readonly elevationTokens: ElevationTokens;
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
