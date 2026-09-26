/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Application Audit & Global Quality Intelligence Engine - Domain Contracts
 */

import type { Role } from '../../identity/permissions.js';
import type { ApplicationDNA } from '../dna/types.js';
import type { VisualSnapshot } from '../visual-intelligence/types.js';
import type { DesignHarmonyReport } from '../design-harmony/types.js';
import type { AgentDomain, AgentTask } from '../ai-orchestrator/types.js';

export type AuditDimension =
  | 'ARCHITECTURE'
  | 'CODE_QUALITY'
  | 'SECURITY'
  | 'PERFORMANCE'
  | 'UX'
  | 'ACCESSIBILITY'
  | 'AI_CONFIG'
  | 'DESIGN_HARMONY';

export type AuditSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AuditFindingLocation {
  readonly filePath?: string;
  readonly line?: number;
  readonly column?: number;
  readonly selector?: string;
  readonly pageRoute?: string;
  readonly symbolName?: string;
  readonly nodeId?: string;
}

export interface AuditFindingEvidence {
  readonly source: 'AST_NODE' | 'SEMANTIC_GRAPH' | 'VISUAL_LAYOUT' | 'DNA_RULE' | 'SECURITY_SCANNER' | 'DESIGN_HARMONY';
  readonly detail: string;
  readonly metricName?: string;
  readonly observedValue?: string | number;
  readonly thresholdValue?: string | number;
  readonly filePath?: string;
  readonly selector?: string;
}

export interface ApplicationAuditFinding {
  readonly id: string;
  readonly dimension: AuditDimension;
  readonly severity: AuditSeverity;
  readonly title: string;
  readonly description: string;
  readonly location: AuditFindingLocation;
  readonly cause: string;
  readonly impact: string;
  readonly blastRadiusScore?: number;
  readonly recommendation: string;
  readonly autoRemediable: boolean;
  readonly suggestedAction?: {
    readonly agentDomain: AgentDomain;
    readonly actionType: string;
    readonly targetPath?: string;
    readonly description: string;
  };
  readonly evidence: readonly AuditFindingEvidence[];
}

export interface AuditDimensionScores {
  readonly architecture: number;      // 15%
  readonly codeQuality: number;       // 15%
  readonly security: number;          // 20%
  readonly performance: number;       // 10%
  readonly ux: number;                // 10%
  readonly accessibility: number;     // 10%
  readonly aiConfig: number;          // 5%
  readonly designHarmony: number;     // 15%
}

export interface AuditSummary {
  readonly totalFindings: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly mediumCount: number;
  readonly lowCount: number;
  readonly infoCount: number;
  readonly autoRemediableCount: number;
}

export interface ApplicationAuditReport {
  readonly reportId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly overallScore: number;      // 0 - 100
  readonly dimensionScores: AuditDimensionScores;
  readonly findings: readonly ApplicationAuditFinding[];
  readonly summary: AuditSummary;
  readonly auditHash: string;         // SHA-256 déterministe
  readonly createdAt: string;
  readonly durationMs: number;
}

export interface ApplicationAuditComparison {
  readonly previousReportId: string;
  readonly currentReportId: string;
  readonly scoreDelta: number;
  readonly dimensionDeltas: Record<AuditDimension, number>;
  readonly resolvedFindingIds: readonly string[];
  readonly newFindingIds: readonly string[];
  readonly improvements: readonly string[];
  readonly regressions: readonly string[];
}

export interface AuditFileEntry {
  readonly path: string;
  readonly content: string;
}

export interface ApplicationAuditRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly files?: readonly AuditFileEntry[];
  readonly snapshots?: readonly VisualSnapshot[];
  readonly dna?: ApplicationDNA;
  readonly designHarmonyReport?: DesignHarmonyReport;
  readonly config?: Partial<ApplicationAuditConfig>;
  readonly callerRole?: Role | undefined;
}

export interface ApplicationAuditConfig {
  readonly maxFindingsPerDimension: number;
  readonly cyclomaticComplexityThreshold: number;
  readonly maxFunctionLinesThreshold: number;
  readonly maxDomElementsThreshold: number;
  readonly enabledDimensions: readonly AuditDimension[];
}

export interface ProposedRemediationTask extends AgentTask {
  readonly findingId: string;
  readonly targetDimension: AuditDimension;
}
