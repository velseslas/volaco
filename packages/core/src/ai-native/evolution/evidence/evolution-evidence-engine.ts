/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * Evolution Evidence Engine - Structured evidence construction from AINT sources
 *
 * Strict Invariant: NO EVIDENCE → NO CLAIM.
 * All evidence IDs are deterministic SHA-256 hashes.
 * Empty input → empty output array (no invented evidence).
 */

import { createHash } from 'node:crypto';
import type { EvolutionEvidence, EvidenceType, EvidenceSource } from '../types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeEvidenceId(
  source: EvidenceSource,
  reference: string,
  description: string,
): string {
  const raw = `${source}::${reference}::${description}`;
  const hash = createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 16);
  return `ev:${hash}`;
}

function safeString(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return fallback;
}

function safeNumber(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return fallback;
}

function clamp01(value: number): number {
  return Math.min(1.0, Math.max(0.0, value));
}

function buildEvidence(
  tenantId: string,
  projectId: string,
  type: EvidenceType,
  source: EvidenceSource,
  description: string,
  confidence: number,
  weight: number,
  verifiableReference: string,
  dataPayload?: Record<string, unknown>,
): EvolutionEvidence {
  const id = computeEvidenceId(source, verifiableReference, description);
  return {
    id,
    tenantId,
    projectId,
    type,
    source,
    description,
    confidence: clamp01(confidence),
    weight: clamp01(weight),
    verifiableReference,
    dataPayload,
    collectedAt: new Date().toISOString(),
  };
}

function extractRecord(raw: unknown): Record<string, unknown> {
  if (raw !== null && raw !== undefined && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

// ---------------------------------------------------------------------------
// EvolutionEvidenceEngine
// ---------------------------------------------------------------------------

/**
 * Builds typed EvolutionEvidence arrays from raw source data.
 *
 * Each method follows strict tracing rules:
 * - Empty or invalid input → returns [] (never invents evidence)
 * - IDs are deterministic via SHA-256 of (source, reference, description)
 */
export class EvolutionEvidenceEngine {
  private readonly tenantId: string;
  private readonly projectId: string;

  public constructor(tenantId: string, projectId: string) {
    this.tenantId = tenantId;
    this.projectId = projectId;
  }

  /**
   * Builds evidence from AINT-013 audit findings.
   * Audit findings are direct observations → FACT with high weight.
   */
  public buildFromAudit(findings: unknown[]): EvolutionEvidence[] {
    if (findings.length === 0) return [];

    return findings.map((raw) => {
      const f = extractRecord(raw);
      const description = safeString(f['description'], safeString(f['message'], 'Audit finding'));
      const reference = safeString(f['id'], safeString(f['ruleId'], 'audit-unknown'));
      const severity = safeString(f['severity'], 'MEDIUM');
      const confidence = severity === 'CRITICAL' ? 0.95
        : severity === 'HIGH' ? 0.85
        : severity === 'MEDIUM' ? 0.70
        : 0.55;

      return buildEvidence(
        this.tenantId,
        this.projectId,
        'FACT',
        'AUDIT',
        description,
        confidence,
        0.9,
        reference,
        { severity, rawFinding: f },
      );
    });
  }

  /**
   * Builds evidence from AINT-014 feature opportunities.
   * Feature candidates are correlations (not direct observations).
   */
  public buildFromFeatures(opportunities: unknown[]): EvolutionEvidence[] {
    if (opportunities.length === 0) return [];

    return opportunities.map((raw) => {
      const o = extractRecord(raw);
      const description = safeString(o['title'], safeString(o['description'], 'Feature opportunity'));
      const reference = safeString(o['id'], safeString(o['candidateId'], 'feature-unknown'));
      const demandScore = safeNumber(o['demandScore'], 50);
      const confidence = clamp01(demandScore / 100);

      return buildEvidence(
        this.tenantId,
        this.projectId,
        'CORRELATION',
        'FEATURE',
        description,
        confidence,
        0.7,
        reference,
        { demandScore, rawOpportunity: o },
      );
    });
  }

  /**
   * Builds evidence from AINT-015 user feedback problems.
   * User-reported problems are FACTS when directly observed.
   */
  public buildFromFeedback(problems: unknown[]): EvolutionEvidence[] {
    if (problems.length === 0) return [];

    return problems.map((raw) => {
      const p = extractRecord(raw);
      const description = safeString(p['description'], safeString(p['title'], 'User problem'));
      const reference = safeString(p['id'], safeString(p['problemId'], 'feedback-unknown'));
      const occurrences = safeNumber(p['occurrences'], 1);
      const rawConf = safeNumber(p['confidence'], 0.6);
      const confidence = clamp01(rawConf * Math.min(occurrences / 5.0, 1.0) + 0.1);

      return buildEvidence(
        this.tenantId,
        this.projectId,
        'FACT',
        'FEEDBACK',
        description,
        confidence,
        0.8,
        reference,
        { occurrences, rawProblem: p },
      );
    });
  }

  /**
   * Builds evidence from AINT-016 strategy recommendations.
   * Strategy recommendations are hypotheses (derived, not directly observed).
   */
  public buildFromStrategy(recommendations: unknown[]): EvolutionEvidence[] {
    if (recommendations.length === 0) return [];

    return recommendations.map((raw) => {
      const r = extractRecord(raw);
      const description = safeString(r['title'], safeString(r['description'], 'Strategic recommendation'));
      const reference = safeString(r['id'], 'strategy-unknown');
      const strategicScore = safeNumber(r['strategicScore'], 50);
      const confidence = clamp01(strategicScore / 100);

      return buildEvidence(
        this.tenantId,
        this.projectId,
        'HYPOTHESIS',
        'STRATEGY',
        description,
        confidence,
        0.6,
        reference,
        { strategicScore, rawRecommendation: r },
      );
    });
  }

  /**
   * Builds evidence from DNA constraints.
   * DNA constraints are FACTS — they are explicit product rules.
   */
  public buildFromDNA(constraints: unknown[]): EvolutionEvidence[] {
    if (constraints.length === 0) return [];

    return constraints.map((raw) => {
      const c = extractRecord(raw);
      const description = safeString(c['description'], safeString(c['rule'], 'DNA constraint'));
      const reference = safeString(c['id'], safeString(c['constraintId'], 'dna-unknown'));
      const mandatory = c['mandatory'] === true;

      return buildEvidence(
        this.tenantId,
        this.projectId,
        'FACT',
        'DNA',
        description,
        mandatory ? 0.95 : 0.75,
        mandatory ? 1.0 : 0.7,
        reference,
        { mandatory, rawConstraint: c },
      );
    });
  }

  /**
   * Builds evidence from conversation intents (AINT-011/AINT-012).
   * Conversation signals are hypotheses — intent may not reflect actual state.
   */
  public buildFromConversation(intents: unknown[]): EvolutionEvidence[] {
    if (intents.length === 0) return [];

    return intents.map((raw) => {
      const i = extractRecord(raw);
      const description = safeString(i['intent'], safeString(i['description'], 'Conversation intent'));
      const reference = safeString(i['id'], safeString(i['intentId'], 'conversation-unknown'));
      const rawConf = safeNumber(i['confidence'], 0.4);

      return buildEvidence(
        this.tenantId,
        this.projectId,
        'HYPOTHESIS',
        'CONVERSATION',
        description,
        clamp01(rawConf),
        0.5,
        reference,
        { rawIntent: i },
      );
    });
  }
}
