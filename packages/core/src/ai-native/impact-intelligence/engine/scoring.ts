/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-005)
 * Deterministic Impact Scoring and Confidence Engine
 */

import type {
  ImpactAnalysisMetrics,
  ImpactRiskFactor,
  ImpactRiskLevel,
  ImpactedNode
} from '../types.js';

export interface ScoreComputationInput {
  readonly metrics: Omit<ImpactAnalysisMetrics, 'overallScore'>;
  readonly riskFactors: readonly ImpactRiskFactor[];
  readonly impactedNodes: readonly ImpactedNode[];
}

/**
 * Computes deterministic impact score (0 to 100).
 */
export function computeImpactScore(input: ScoreComputationInput): number {
  let score = 0;

  // 1. Route and Entry Point impact (up to 35 points)
  if (input.metrics.routesAffectedCount > 0) {
    score += Math.min(25, input.metrics.routesAffectedCount * 12.5);
  }

  // 2. Breaking changes (up to 25 points)
  if (input.metrics.breakingCount > 0) {
    score += Math.min(25, input.metrics.breakingCount * 8);
  }

  // 3. Blast radius & node volume (up to 20 points)
  if (input.metrics.totalImpactedNodes > 0) {
    score += Math.min(20, input.metrics.totalImpactedNodes * 2.5);
  }

  // 4. Cross-layer propagation (up to 10 points)
  if (input.metrics.layersCrossedCount >= 2) {
    score += Math.min(10, input.metrics.layersCrossedCount * 3.5);
  }

  // 5. Circular dependencies (up to 10 points)
  if (input.metrics.circularDependenciesDetected > 0) {
    score += 10;
  }

  // Clamp strictly between 0 and 100, rounded to 1 decimal place
  const clamped = Math.max(0, Math.min(100, score));
  return Math.round(clamped * 10) / 10;
}

/**
 * Evaluates overall risk level from score and critical risk factors.
 */
export function evaluateOverallRisk(
  score: number,
  riskFactors: readonly ImpactRiskFactor[]
): ImpactRiskLevel {
  const hasCriticalFactor = riskFactors.some((f) => f.severity === 'CRITICAL');
  if (hasCriticalFactor || score >= 70) {
    return 'CRITICAL';
  }

  const hasHighFactor = riskFactors.some((f) => f.severity === 'HIGH');
  if (hasHighFactor || score >= 40) {
    return 'HIGH';
  }

  if (score >= 15) {
    return 'MEDIUM';
  }

  return 'LOW';
}

/**
 * Computes deterministic confidence (0.50 to 1.00) based on evidence completeness
 * and propagation depth.
 */
export function computeConfidence(
  impactedNodes: readonly ImpactedNode[],
  maxDepthReached: number
): number {
  if (impactedNodes.length === 0) {
    return 1.0;
  }

  // Fraction of impacted nodes that have direct evidence
  const nodesWithEvidence = impactedNodes.filter((n) => n.evidence.length > 0).length;
  const evidenceRatio = nodesWithEvidence / impactedNodes.length;

  // Depth penalty: deeper graphs have slightly higher uncertainty
  const depthFactor = 1.0 / (1.0 + 0.05 * Math.max(0, maxDepthReached - 1));

  const rawConfidence = 0.5 + 0.5 * (evidenceRatio * depthFactor);
  const clamped = Math.max(0.5, Math.min(1.0, rawConfidence));

  return Math.round(clamped * 100) / 100;
}
