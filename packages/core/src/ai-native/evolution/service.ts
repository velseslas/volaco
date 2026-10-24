/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-017)
 * CDC §31 — Evolution Service : branchement RÉEL du moteur d'évolution.
 *
 * Le moteur `evolution/*` (évidence → état → propositions → santé produit →
 * readiness) était complet et testé, mais ORPHELIN : aucun import hors de
 * ses propres fichiers, aucune route. Ce service est le point d'entrée
 * unique qui l'exécute sur des sources RÉELLES fournies par l'appelant
 * (rapport d'audit applicatif, opportunités produit, feedbacks, stratégie,
 * contraintes DNA, intentions conversationnelles).
 *
 * Invariants repris du moteur :
 *  - NO EVIDENCE → NO CLAIM : sans évidence, zéro proposition ;
 *  - déterministe : mêmes sources → même stateHash / reportHash / id ;
 *  - advisory uniquement : ce service ne mute jamais le code ;
 *  - multi-tenant : clé de cache tenant::project::hash.
 */

import { createHash } from 'node:crypto';
import { deepFreeze } from '../ai-orchestrator/canonical.js';
import { assertPermission, type Role } from '../../identity/permissions.js';
import { ValidationError } from '../../errors.js';
import { EvolutionLruCache, type EvolutionCacheMetrics } from './cache.js';
import { EvolutionEvidenceEngine } from './evidence/evolution-evidence-engine.js';
import { EvidenceRanker } from './evidence/evidence-ranker.js';
import { ConfidenceEngine } from './evidence/confidence-engine.js';
import { ApplicationStateBuilder } from './state/application-state-builder.js';
import { ProductHealthEngine } from './state/product-health-engine.js';
import { EvolutionReadinessEngine } from './state/evolution-readiness-engine.js';
import { EvolutionProposalGenerator } from './proposal/evolution-proposal-generator.js';
import { ProposalNormalizer } from './proposal/proposal-normalizer.js';
import { ProposalValidator } from './proposal/proposal-validator.js';
import type {
  EvolutionAnalysisReport,
  EvolutionAnalysisRequest,
  EvolutionEvidence
} from './types.js';

export interface EvolutionServiceInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly callerRole: Role;
  /**
   * Sources RÉELLES, contrôlées par le moteur — clés reconnues :
   *  - auditReport        → rapport AINT-013 (findings → évidence, scores → état) ;
   *  - featureReport      → rapport AINT-014 (opportunities → évidence) ;
   *  - feedbackReport     → rapport AINT-015 (problems → évidence, scores → état) ;
   *  - strategyReport     → rapport AINT-016 (recommendations → évidence, score → état) ;
   *  - dnaConstraints     → contraintes DNA explicites → évidence FACT ;
   *  - conversationIntents→ intentions conversationnelles → évidence HYPOTHESIS.
   * Une source absente ne fabrique JAMAIS de valeur : dimension neutre (50, UNKNOWN).
   */
  readonly sources: Readonly<Record<string, unknown>>;
  readonly options?: {
    readonly forceRecompute?: boolean | undefined;
    readonly maxProposals?: number | undefined;
  } | undefined;
}

function readArray(source: unknown, key: string): unknown[] | undefined {
  if (source === null || source === undefined || typeof source !== 'object') return undefined;
  const value = (source as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : undefined;
}

export class EvolutionService {
  private readonly evidenceRanker = new EvidenceRanker();
  private readonly confidenceEngine = new ConfidenceEngine();
  private readonly stateBuilder = new ApplicationStateBuilder();
  private readonly healthEngine = new ProductHealthEngine();
  private readonly readinessEngine = new EvolutionReadinessEngine();
  private readonly generator = new EvolutionProposalGenerator();
  private readonly normalizer = new ProposalNormalizer();
  private readonly validator = new ProposalValidator();
  private readonly cache = new EvolutionLruCache();

  /**
   * Analyse l'état d'évolution du projet et retourne le rapport complet.
   * Purement consultatif : aucune mutation, aucun effet de bord hors cache.
   */
  public analyze(
    input: EvolutionServiceInput,
    userRole?: Role,
    requestId?: string
  ): EvolutionAnalysisReport {
    const startedAt = Date.now();
    const effectiveRole = userRole ?? input.callerRole ?? 'VIEWER';
    assertPermission(effectiveRole, 'PROJECT_READ', requestId);

    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new ValidationError('Le tenantId est obligatoire pour l\'analyse d évolution', { field: 'tenantId' }, requestId);
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new ValidationError('Le projectId est obligatoire pour l\'analyse d évolution', { field: 'projectId' }, requestId);
    }

    const tenantId = input.tenantId.trim();
    const projectId = input.projectId.trim();
    const sources = input.sources ?? {};

    const request: EvolutionAnalysisRequest = {
      tenantId,
      projectId,
      callerRole: input.callerRole,
      sources,
      options: input.options
    };

    const evidence = this.collectEvidence(tenantId, projectId, sources);
    const state = this.stateBuilder.build(request, sources);
    const cacheKey = this.computeCacheKey(state.stateHash, evidence);

    if (input.options?.forceRecompute !== true) {
      const cached = this.cache.get(tenantId, projectId, cacheKey);
      if (cached) return cached;
    }

    const generated = this.generator.generate(request, evidence, state);
    const normalized = this.normalizer.normalize(generated);
    const valid = normalized.filter((proposal) => this.validator.validate(proposal).valid);
    const maxProposals = input.options?.maxProposals;
    const proposals = maxProposals !== undefined && maxProposals > 0
      ? valid.slice(0, maxProposals)
      : valid;

    const healthScore = this.healthEngine.compute(state);
    const readinessStatus = this.readinessEngine.assess(state, proposals);

    const reportHash = createHash('sha256')
      .update(`${tenantId}:${projectId}:${state.stateHash}:${proposals.map((p) => p.id).join(',')}`, 'utf8')
      .digest('hex');

    const report: EvolutionAnalysisReport = deepFreeze({
      id: `evr:${reportHash.substring(0, 16)}`,
      tenantId,
      projectId,
      applicationState: state,
      healthScore,
      readinessStatus,
      proposals,
      totalEvidenceEvaluated: evidence.length,
      overallConfidence: this.confidenceEngine.compute(evidence),
      reportHash,
      createdAt: new Date().toISOString(),
      analysisDurationMs: Date.now() - startedAt
    });

    this.cache.set(tenantId, projectId, cacheKey, report);
    return report;
  }

  public getCacheMetrics(): EvolutionCacheMetrics {
    return this.cache.getMetrics();
  }

  public clearCache(): void {
    this.cache.clear();
  }

  // -------------------------------------------------------------------------
  // Interne
  // -------------------------------------------------------------------------

  /**
   * Construit l'évidence à partir des seules sources PRÉSENTES, puis la
   * classe (FACT > CORRELATION > HYPOTHESIS, confiance DESC) et la déduplique
   * par id. Le moteur n'invente jamais : source absente → aucune évidence.
   */
  private collectEvidence(
    tenantId: string,
    projectId: string,
    sources: Readonly<Record<string, unknown>>
  ): EvolutionEvidence[] {
    const engine = new EvolutionEvidenceEngine(tenantId, projectId);
    const collected: EvolutionEvidence[] = [];

    const auditFindings = readArray(sources['auditReport'], 'findings');
    if (auditFindings) collected.push(...engine.buildFromAudit(auditFindings));

    const opportunities = readArray(sources['featureReport'], 'opportunities');
    if (opportunities) collected.push(...engine.buildFromFeatures(opportunities));

    const problems = readArray(sources['feedbackReport'], 'problems');
    if (problems) collected.push(...engine.buildFromFeedback(problems));

    const recommendations = readArray(sources['strategyReport'], 'recommendations')
      ?? readArray(sources['strategyReport'], 'allRecommendations');
    if (recommendations) collected.push(...engine.buildFromStrategy(recommendations));

    const constraints = Array.isArray(sources['dnaConstraints']) ? sources['dnaConstraints'] : undefined;
    if (constraints) collected.push(...engine.buildFromDNA(constraints));

    const intents = Array.isArray(sources['conversationIntents']) ? sources['conversationIntents'] : undefined;
    if (intents) collected.push(...engine.buildFromConversation(intents));

    const ranked = this.evidenceRanker.rank(collected);
    const seen = new Set<string>();
    const deduplicated: EvolutionEvidence[] = [];
    for (const item of ranked) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        deduplicated.push(item);
      }
    }
    return deduplicated;
  }

  private computeCacheKey(stateHash: string, evidence: readonly EvolutionEvidence[]): string {
    const raw = `${stateHash}::${evidence.map((e) => e.id).join(',')}`;
    return 'evc:' + createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 16);
  }
}
