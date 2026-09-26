/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Application State Builder - Aggregates dimensional state from all AINT sources
 *
 * Strict Invariant: NO EVIDENCE → NO DIMENSION VALUE INVENTION.
 * If a source is absent → dimension value = 50 (neutral), source = 'UNKNOWN'.
 */

import { createHash } from 'node:crypto';
import type {
  EvolutionAnalysisRequest,
  ApplicationEvolutionState,
  StateDimension,
  EvidenceSource,
} from '../types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function neutralDimension(): StateDimension {
  return {
    value: 50,
    source: 'UNKNOWN',
    collectedAt: new Date().toISOString(),
  };
}

function makeDimension(
  value: number,
  source: EvidenceSource,
  collectedAt: string,
): StateDimension {
  return {
    value: Math.min(100, Math.max(0, Math.round(value))),
    source,
    collectedAt,
  };
}

function safeNumber(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return fallback;
}

function safeString(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return fallback;
}

// ---------------------------------------------------------------------------
// Source accessor helpers (typed extraction without 'any')
// ---------------------------------------------------------------------------

function extractAuditScore(sources: Record<string, unknown>): StateDimension | null {
  const report = sources['auditReport'];
  if (report === null || report === undefined || typeof report !== 'object') return null;
  const r = report as Record<string, unknown>;
  const overallScore = safeNumber(r['overallScore'], -1);
  if (overallScore < 0) return null;
  return makeDimension(
    overallScore,
    'AUDIT',
    safeString(r['auditedAt'], new Date().toISOString()),
  );
}

function extractSecurityScore(sources: Record<string, unknown>): StateDimension | null {
  const report = sources['auditReport'];
  if (report === null || report === undefined || typeof report !== 'object') return null;
  const r = report as Record<string, unknown>;
  const scores = r['dimensionScores'];
  if (scores === null || scores === undefined || typeof scores !== 'object') return null;
  const s = scores as Record<string, unknown>;
  const sec = safeNumber(s['security'], -1);
  if (sec < 0) return null;
  return makeDimension(sec, 'AUDIT', safeString(r['auditedAt'], new Date().toISOString()));
}

function extractCodeQualityScore(sources: Record<string, unknown>): StateDimension | null {
  const report = sources['auditReport'];
  if (report === null || report === undefined || typeof report !== 'object') return null;
  const r = report as Record<string, unknown>;
  const scores = r['dimensionScores'];
  if (scores === null || scores === undefined || typeof scores !== 'object') return null;
  const s = scores as Record<string, unknown>;
  const cq = safeNumber(s['codeQuality'], -1);
  if (cq < 0) return null;
  return makeDimension(cq, 'AUDIT', safeString(r['auditedAt'], new Date().toISOString()));
}

function extractPerformanceScore(sources: Record<string, unknown>): StateDimension | null {
  const report = sources['auditReport'];
  if (report === null || report === undefined || typeof report !== 'object') return null;
  const r = report as Record<string, unknown>;
  const scores = r['dimensionScores'];
  if (scores === null || scores === undefined || typeof scores !== 'object') return null;
  const s = scores as Record<string, unknown>;
  const perf = safeNumber(s['performance'], -1);
  if (perf < 0) return null;
  return makeDimension(perf, 'AUDIT', safeString(r['auditedAt'], new Date().toISOString()));
}

function extractUxScore(sources: Record<string, unknown>): StateDimension | null {
  const report = sources['feedbackReport'];
  if (report === null || report === undefined || typeof report !== 'object') return null;
  const r = report as Record<string, unknown>;
  const ux = safeNumber(r['uxScore'], -1);
  if (ux < 0) return null;
  return makeDimension(ux, 'FEEDBACK', safeString(r['reportedAt'], new Date().toISOString()));
}

function extractUserSatisfactionScore(sources: Record<string, unknown>): StateDimension | null {
  const report = sources['feedbackReport'];
  if (report === null || report === undefined || typeof report !== 'object') return null;
  const r = report as Record<string, unknown>;
  const sat = safeNumber(r['satisfactionScore'], -1);
  if (sat < 0) return null;
  return makeDimension(sat, 'FEEDBACK', safeString(r['reportedAt'], new Date().toISOString()));
}

function extractFeatureHealthScore(sources: Record<string, unknown>): StateDimension | null {
  const report = sources['featureReport'];
  if (report === null || report === undefined || typeof report !== 'object') return null;
  const r = report as Record<string, unknown>;
  const fh = safeNumber(r['healthScore'], -1);
  if (fh < 0) return null;
  return makeDimension(fh, 'FEATURE', safeString(r['reportedAt'], new Date().toISOString()));
}

function extractStrategicAlignmentScore(sources: Record<string, unknown>): StateDimension | null {
  const report = sources['strategyReport'];
  if (report === null || report === undefined || typeof report !== 'object') return null;
  const r = report as Record<string, unknown>;
  const sa = safeNumber(r['overallStrategicScore'], -1);
  if (sa < 0) return null;
  return makeDimension(sa, 'STRATEGY', safeString(r['createdAt'], new Date().toISOString()));
}

function extractArchitectureScore(sources: Record<string, unknown>): StateDimension | null {
  const report = sources['auditReport'];
  if (report === null || report === undefined || typeof report !== 'object') return null;
  const r = report as Record<string, unknown>;
  const scores = r['dimensionScores'];
  if (scores === null || scores === undefined || typeof scores !== 'object') return null;
  const s = scores as Record<string, unknown>;
  const arch = safeNumber(s['architecture'], -1);
  if (arch < 0) return null;
  return makeDimension(arch, 'AUDIT', safeString(r['auditedAt'], new Date().toISOString()));
}

// ---------------------------------------------------------------------------
// ApplicationStateBuilder
// ---------------------------------------------------------------------------

/**
 * Builds a deterministic ApplicationEvolutionState from request sources.
 *
 * Each dimension is traced to its origin source. If a source is absent, the
 * dimension is set to 50 (neutral) with source = 'UNKNOWN'. No values are
 * invented.
 */
export class ApplicationStateBuilder {
  /**
   * Builds the ApplicationEvolutionState from available sources.
   * Missing sources yield neutral (50) dimensions — never invented values.
   */
  public build(
    request: EvolutionAnalysisRequest,
    sources: Record<string, unknown>,
  ): ApplicationEvolutionState {
    const now = new Date().toISOString();

    const reliability = extractAuditScore(sources) ?? neutralDimension();
    const security = extractSecurityScore(sources) ?? neutralDimension();
    const ux = extractUxScore(sources) ?? neutralDimension();
    const performance = extractPerformanceScore(sources) ?? neutralDimension();
    const architecture = extractArchitectureScore(sources) ?? neutralDimension();
    const codeQuality = extractCodeQualityScore(sources) ?? neutralDimension();
    const featureHealth = extractFeatureHealthScore(sources) ?? neutralDimension();
    const userSatisfaction = extractUserSatisfactionScore(sources) ?? neutralDimension();
    const strategicAlignment = extractStrategicAlignmentScore(sources) ?? neutralDimension();

    const rawInputs = [
      request.tenantId,
      request.projectId,
      String(reliability.value),
      String(security.value),
      String(ux.value),
      String(performance.value),
      String(architecture.value),
      String(codeQuality.value),
      String(featureHealth.value),
      String(userSatisfaction.value),
      String(strategicAlignment.value),
    ].join('::');

    const stateHash = createHash('sha256')
      .update(rawInputs, 'utf8')
      .digest('hex')
      .substring(0, 16);

    return {
      tenantId: request.tenantId,
      projectId: request.projectId,
      stateHash,
      reliability,
      security,
      ux,
      performance,
      architecture,
      codeQuality,
      featureHealth,
      userSatisfaction,
      strategicAlignment,
      collectedAt: now,
    };
  }
}
