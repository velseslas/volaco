/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Strategic Signal Aggregator - Synthesizes opportunities, problems, debts, and architectural signals
 */

import { computeRecommendationHash } from '../canonical.js';
import type { StrategyContext, RecommendationType, StrategyEvidence, EffortLevel } from '../types.js';
import { OpportunityAnalyzer } from './opportunity-analyzer.js';
import { ProblemAnalyzer } from './problem-analyzer.js';
import { TechnicalDebtAnalyzer } from './technical-debt-analyzer.js';
import { StrategyRiskAnalyzer } from './risk-analyzer.js';
import { StrategyValueAnalyzer } from './value-analyzer.js';
import { StrategyDependencyAnalyzer } from './dependency-analyzer.js';

export interface RawStrategicCandidate {
  tempId: string;
  type: RecommendationType;
  title: string;
  description: string;
  evidence: StrategyEvidence[];
  supportingProblems: string[];
  supportingOpportunities: string[];
  supportingFindings: string[];
  isRegression: boolean;
  isBlocker: boolean;
  severityOrGapScore: number;
  urgencyScore: number;
  effortPoints: number;
  effortLevel: EffortLevel;
  valueScore: number;
  riskScore: number;
  riskSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  blastRadius: number;
  mitigation: string;
  expectedValue: string;
  userImpact: string;
  technicalImpact: string;
  businessImpact: string;
  dependencies: string[];
}

export class StrategicSignalAggregator {
  private readonly oppAnalyzer = new OpportunityAnalyzer();
  private readonly prbAnalyzer = new ProblemAnalyzer();
  private readonly debtAnalyzer = new TechnicalDebtAnalyzer();
  private readonly riskAnalyzer = new StrategyRiskAnalyzer();
  private readonly valueAnalyzer = new StrategyValueAnalyzer();
  private readonly depAnalyzer = new StrategyDependencyAnalyzer();

  /**
   * Aggregates all incoming signals from the StrategyContext into candidate recommendations.
   */
  public aggregateCandidates(context: StrategyContext): RawStrategicCandidate[] {
    const rawList: RawStrategicCandidate[] = [];

    // 1. Ingest Problems & Regressions (AINT-015)
    const evaluatedProblems = this.prbAnalyzer.analyze(context);
    for (const p of evaluatedProblems) {
      const val = this.valueAnalyzer.evaluate(p.recommendationType, p.severityScore, p.isRegression, p.isBlocker);
      const risk = this.riskAnalyzer.assessRisk(p.recommendationType, p.effortPoints, 0, context);

      const effortLevel: EffortLevel = p.effortPoints === 1 ? 'XS' : p.effortPoints === 2 ? 'S' : p.effortPoints === 3 ? 'M' : p.effortPoints === 5 ? 'L' : 'XL';

      rawList.push({
        tempId: `cand-${p.problemId}`,
        type: p.recommendationType,
        title: p.title,
        description: p.description,
        evidence: p.evidence,
        supportingProblems: [p.problemId],
        supportingOpportunities: [],
        supportingFindings: [],
        isRegression: p.isRegression,
        isBlocker: p.isBlocker,
        severityOrGapScore: p.severityScore,
        urgencyScore: p.urgencyScore,
        effortPoints: p.effortPoints,
        effortLevel,
        valueScore: val.valueScore,
        riskScore: risk.riskScore,
        riskSeverity: risk.severity,
        blastRadius: risk.blastRadius,
        mitigation: risk.mitigation,
        expectedValue: val.expectedValueDescription,
        userImpact: val.userImpact,
        technicalImpact: val.technicalImpact,
        businessImpact: val.businessImpact,
        dependencies: []
      });
    }

    // 2. Ingest Technical Debt & Audit Findings (AINT-013)
    const { items: evaluatedDebts } = this.debtAnalyzer.analyze(context);
    for (const d of evaluatedDebts) {
      const val = this.valueAnalyzer.evaluate(d.recommendationType, d.debtScore, false, false);
      const risk = this.riskAnalyzer.assessRisk(d.recommendationType, d.effortPoints, 0, context);

      const effortLevel: EffortLevel = d.effortPoints === 1 ? 'XS' : d.effortPoints === 2 ? 'S' : d.effortPoints === 3 ? 'M' : d.effortPoints === 5 ? 'L' : 'XL';

      rawList.push({
        tempId: `cand-audit-${d.findingId}`,
        type: d.recommendationType,
        title: d.title,
        description: d.description,
        evidence: d.evidence,
        supportingProblems: [],
        supportingOpportunities: [],
        supportingFindings: [d.findingId],
        isRegression: false,
        isBlocker: d.debtScore >= 90,
        severityOrGapScore: d.debtScore,
        urgencyScore: Math.min(100, Math.round(d.debtScore * 0.8)),
        effortPoints: d.effortPoints,
        effortLevel,
        valueScore: val.valueScore,
        riskScore: risk.riskScore,
        riskSeverity: risk.severity,
        blastRadius: risk.blastRadius,
        mitigation: risk.mitigation,
        expectedValue: val.expectedValueDescription,
        userImpact: val.userImpact,
        technicalImpact: val.technicalImpact,
        businessImpact: val.businessImpact,
        dependencies: []
      });
    }

    // 3. Ingest Opportunities (AINT-014)
    const evaluatedOpps = this.oppAnalyzer.analyze(context);
    for (const o of evaluatedOpps) {
      const val = this.valueAnalyzer.evaluate(o.recommendationType, o.strategicValue, false, false);
      const risk = this.riskAnalyzer.assessRisk(o.recommendationType, o.effortPoints, o.dependencies.length, context);

      const effortLevel: EffortLevel = o.effortPoints === 1 ? 'XS' : o.effortPoints === 2 ? 'S' : o.effortPoints === 3 ? 'M' : o.effortPoints === 5 ? 'L' : 'XL';

      rawList.push({
        tempId: `cand-feat-${o.candidateId}`,
        type: o.recommendationType,
        title: o.title,
        description: o.description,
        evidence: o.evidence,
        supportingProblems: [],
        supportingOpportunities: [o.candidateId],
        supportingFindings: [],
        isRegression: false,
        isBlocker: false,
        severityOrGapScore: o.strategicValue,
        urgencyScore: o.urgency,
        effortPoints: o.effortPoints,
        effortLevel,
        valueScore: val.valueScore,
        riskScore: risk.riskScore,
        riskSeverity: risk.severity,
        blastRadius: risk.blastRadius,
        mitigation: risk.mitigation,
        expectedValue: val.expectedValueDescription,
        userImpact: val.userImpact,
        technicalImpact: val.technicalImpact,
        businessImpact: val.businessImpact,
        dependencies: o.dependencies
      });
    }

    // 4. Infer Cross-Candidate Dependencies
    const depMap = this.depAnalyzer.inferDependencies(
      rawList.map(r => ({ id: r.tempId, type: r.type, title: r.title }))
    );

    for (const r of rawList) {
      const inferred = depMap.get(r.tempId) || [];
      r.dependencies = Array.from(new Set([...r.dependencies, ...inferred]));
    }

    return rawList;
  }
}
