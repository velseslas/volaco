/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Strategy Context Builder - Aggregates and correlates signals from AINT-001 through AINT-015
 * 
 * Strict Invariant: NO EVIDENCE → NO CLAIM.
 * Clear distinction between FACT, CORRELATION, HYPOTHESIS, and UNKNOWN.
 */

import { createHash } from 'node:crypto';
import type { StrategyContext, StrategyOptimizationRequest, StrategyEvidence, ProvenanceClassification } from '../types.js';

export class StrategyContextBuilder {
  /**
   * Builds an aggregated, deterministic StrategyContext from a request.
   */
  public buildContext(request: StrategyOptimizationRequest): StrategyContext {
    const rawInputs = [
      request.tenantId,
      request.projectId,
      request.dna ? JSON.stringify(request.dna.dnaHash) : 'no-dna',
      request.auditReport ? request.auditReport.auditHash : 'no-audit',
      request.featureReport ? request.featureReport.reportHash : 'no-features',
      request.feedbackReport ? request.feedbackReport.reportHash : 'no-feedback',
      request.semanticGraph ? String(request.semanticGraph.nodes?.length || 0) : 'no-graph',
      request.impactReport ? JSON.stringify(request.impactReport.impactedNodes?.length || 0) : 'no-impact'
    ].join('::');

    const inputHash = createHash('sha256').update(rawInputs, 'utf8').digest('hex').substring(0, 16);

    const context: StrategyContext = {
      tenantId: request.tenantId,
      projectId: request.projectId,
      inputHash,
      collectedAt: new Date().toISOString()
    };

    if (request.dna) context.dna = request.dna;
    if (request.auditReport) context.auditReport = request.auditReport;
    if (request.featureReport) context.featureReport = request.featureReport;
    if (request.feedbackReport) context.feedbackReport = request.feedbackReport;
    if (request.semanticGraph) context.semanticGraph = request.semanticGraph;
    if (request.impactReport) context.impactReport = request.impactReport;
    if (request.priorDecisions) context.priorDecisions = request.priorDecisions;

    return context;
  }

  /**
   * Classifies provenance for a given piece of evidence.
   */
  public classifyProvenance(
    source: StrategyEvidence['source'],
    hasVerifiableRef: boolean,
    isDirectObservation: boolean
  ): ProvenanceClassification {
    if (!hasVerifiableRef) {
      return 'UNKNOWN';
    }
    if (isDirectObservation && (source === 'AUDIT' || source === 'DNA' || source === 'FEEDBACK')) {
      return 'FACT';
    }
    if (source === 'SEMANTIC_GRAPH' || source === 'IMPACT' || source === 'FEATURE') {
      return 'CORRELATION';
    }
    return 'HYPOTHESIS';
  }
}
