/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Candidate Generator - Constructs Fully Qualified Feature Candidates
 */

import type { FeatureCandidate, FeatureOpportunityStatus, FeatureFileEntry } from '../types.js';
import type { RawOpportunityGap } from '../discovery/feature-gap-detector.js';
import type { ApplicationDNA } from '../../dna/types.js';
import { EvidenceEngine } from '../evidence/evidence-engine.js';
import { ConfidenceEngine } from '../evidence/confidence-engine.js';
import { FeatureSpecGenerator } from './feature-spec-generator.js';
import { FeatureImpactAnalyzer } from '../impact/feature-impact-analyzer.js';
import { FeatureValueEngine } from '../scoring/feature-value-engine.js';
import { PriorityEngine } from '../scoring/priority-engine.js';
import { computeFeatureCandidateHash } from '../canonical.js';

export class FeatureCandidateGenerator {
  private readonly evidenceEngine = new EvidenceEngine();
  private readonly confidenceEngine = new ConfidenceEngine();
  private readonly specGenerator = new FeatureSpecGenerator();
  private readonly impactAnalyzer = new FeatureImpactAnalyzer();
  private readonly valueEngine = new FeatureValueEngine();
  private readonly priorityEngine = new PriorityEngine();

  public generateCandidate(params: {
    readonly rawGap: RawOpportunityGap;
    readonly files?: readonly FeatureFileEntry[] | undefined;
    readonly dna?: ApplicationDNA | undefined;
    readonly hasUserRequests?: boolean | undefined;
    readonly initialStatus?: FeatureOpportunityStatus | undefined;
  }): FeatureCandidate | undefined {
    const { rawGap, files, dna, hasUserRequests = false, initialStatus = 'CANDIDATE' } = params;

    // 1. Enforce NO EVIDENCE -> NO CLAIM
    const evidenceValidation = this.evidenceEngine.validateEvidence(rawGap.initialEvidence);
    if (!evidenceValidation.isValid) {
      return undefined;
    }

    // 2. Compute Confidence Score
    const confidenceScore = this.confidenceEngine.computeConfidenceScore(rawGap.initialEvidence);

    // 3. Generate Engineering Specification
    const specification = this.specGenerator.generateSpec({
      title: rawGap.title,
      problem: rawGap.problem,
      proposedSolution: rawGap.proposedSolution,
      affectedModules: rawGap.affectedModules
    });

    // 4. Analyze Impact & Blast Radius
    const impact = this.impactAnalyzer.analyzeImpact({
      affectedModules: rawGap.affectedModules,
      files,
      title: rawGap.title
    });

    // 5. Compute Value Dimensions & Priority Score
    const valueComponents = this.valueEngine.computeValueComponents({
      category: rawGap.category,
      impact,
      evidenceConfidence: confidenceScore,
      hasUserRequests,
      matchesDna: Boolean(dna)
    });

    const scores = this.priorityEngine.computePriorityScore({
      ...valueComponents,
      evidenceConfidence: confidenceScore
    });

    const now = new Date().toISOString();

    const candidateHash = computeFeatureCandidateHash({
      id: rawGap.id,
      title: rawGap.title,
      category: rawGap.category,
      problem: rawGap.problem,
      proposedSolution: rawGap.proposedSolution,
      priorityScore: scores.priorityScore
    });

    return {
      id: rawGap.id,
      title: rawGap.title,
      description: rawGap.description,
      category: rawGap.category,
      status: initialStatus,
      specification,
      evidence: rawGap.initialEvidence,
      impact,
      scores,
      candidateHash,
      createdAt: now,
      updatedAt: now,
      history: [
        {
          fromStatus: 'DETECTED',
          toStatus: initialStatus,
          timestamp: now,
          reason: 'Opportunité qualifiée et validée par le moteur AINT-014'
        }
      ]
    };
  }
}
