/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Opportunity Detector - Master Discovery Coordinator
 */

import type { FeatureCandidate, FeatureDiscoveryRequest } from '../types.js';
import { SignalCollector } from './signal-collector.js';
import { FeatureGapDetector, type RawOpportunityGap } from './feature-gap-detector.js';
import { FeatureRedundancyDetector } from './feature-redundancy-detector.js';
import { FeatureConflictDetector } from './feature-conflict-detector.js';
import { FeatureAuditBridge } from '../bridge/audit-bridge.js';
import { FeatureConversationBridge } from '../bridge/conversation-bridge.js';
import { FeatureCandidateGenerator } from '../generation/feature-candidate-generator.js';
import { OpportunityRanking } from '../scoring/opportunity-ranking.js';

export class OpportunityDetector {
  private readonly signalCollector = new SignalCollector();
  private readonly gapDetector = new FeatureGapDetector();
  private readonly redundancyDetector = new FeatureRedundancyDetector();
  private readonly conflictDetector = new FeatureConflictDetector();
  private readonly auditBridge = new FeatureAuditBridge();
  private readonly conversationBridge = new FeatureConversationBridge();
  private readonly candidateGenerator = new FeatureCandidateGenerator();
  private readonly ranking = new OpportunityRanking();

  public detectOpportunities(request: FeatureDiscoveryRequest): readonly FeatureCandidate[] {
    // 1. Collect Signals
    const signals = this.signalCollector.collectSignals({
      files: request.files,
      dna: request.dna,
      auditReport: request.auditReport,
      conversationHistory: request.conversationHistory,
      existingDecisions: request.existingDecisions
    });

    const rawPool: RawOpportunityGap[] = [];

    // 2. Gap Detection (if enabled)
    const enableGap = request.config?.enableGapDetection ?? true;
    if (enableGap) {
      rawPool.push(...this.gapDetector.detectGaps(signals));
    }

    // 3. Audit Bridge (if enabled and report provided)
    const enableAudit = request.config?.enableAuditBridge ?? true;
    if (enableAudit && request.auditReport) {
      rawPool.push(...this.auditBridge.extractOpportunitiesFromAudit(request.auditReport));
    }

    // 4. Conversation Bridge (if enabled and conversation turns provided)
    const enableConv = request.config?.enableConversationBridge ?? true;
    if (enableConv && request.conversationHistory) {
      rawPool.push(...this.conversationBridge.extractOpportunitiesFromConversation(request.conversationHistory));
    }

    // 5. Filter Redundancy, Conflicts & Enforce NO EVIDENCE -> NO CLAIM
    const validCandidates: FeatureCandidate[] = [];

    for (const raw of rawPool) {
      // Redundancy Check
      const redundancy = this.redundancyDetector.checkRedundancy(raw.title, raw.description, signals);
      if (redundancy.isRedundant) {
        continue; // Éliminé sans hésitation
      }

      // Conflict Check
      const conflict = this.conflictDetector.checkConflict({
        title: raw.title,
        description: raw.description,
        proposedSolution: raw.proposedSolution,
        dna: request.dna,
        decisions: request.existingDecisions
      });
      if (conflict.hasConflict) {
        continue; // Éliminé car incompatible avec le DNA ou la sécurité
      }

      // Generate Candidate
      const candidate = this.candidateGenerator.generateCandidate({
        rawGap: raw,
        files: request.files,
        dna: request.dna,
        hasUserRequests: signals.userRequests.length > 0
      });

      if (candidate) {
        // Check confidence threshold
        const minConf = (request.config?.minConfidenceThreshold ?? 0.4) * 100;
        if (candidate.scores.evidenceConfidence >= minConf) {
          validCandidates.push(candidate);
        }
      }
    }

    // 6. Deduplicate by Title/ID and Rank
    const uniqueMap = new Map<string, FeatureCandidate>();
    for (const c of validCandidates) {
      if (!uniqueMap.has(c.id)) {
        uniqueMap.set(c.id, c);
      }
    }

    const maxCandidates = request.config?.maxCandidates ?? 20;
    const ranked = this.ranking.rankOpportunities(Array.from(uniqueMap.values()));
    return ranked.slice(0, maxCandidates);
  }
}
