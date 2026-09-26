/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-002)
 * Application DNA Service
 */

import type { Role } from '../../identity/permissions.js';
import { assertPermission } from '../../identity/permissions.js';
import { ValidationError } from '../../errors.js';
import type { CodeIntelligenceService } from '../understanding/service.js';
import type { ProjectAnalysisSummary } from '../understanding/types.js';
import type {
  ApplicationDNA,
  ApplicationDNAConfig,
  DnaCacheMetrics,
  DNASummary
} from './types.js';
import { DnaLruCache } from './cache.js';
import { computeDnaHash, deepFreeze } from './extractors/base.js';
import { StackDetector } from './extractors/stack-detector.js';
import { ArchitectureDetector } from './extractors/architecture-detector.js';
import { ComponentExtractor } from './extractors/component-extractor.js';
import { ModuleExtractor } from './extractors/module-extractor.js';
import { GraphMetricsExtractor } from './extractors/graph-metrics.js';

export class ApplicationDNAService {
  private readonly config: ApplicationDNAConfig;
  private readonly cache: DnaLruCache;
  private readonly stackDetector: StackDetector;
  private readonly architectureDetector: ArchitectureDetector;
  private readonly componentExtractor: ComponentExtractor;
  private readonly moduleExtractor: ModuleExtractor;
  private readonly graphMetricsExtractor: GraphMetricsExtractor;

  constructor(
    private readonly codeIntelligenceService: CodeIntelligenceService,
    config?: Partial<ApplicationDNAConfig>
  ) {
    this.config = {
      analyzerVersion: config?.analyzerVersion ?? '1.0.0',
      cacheMaxEntries: config?.cacheMaxEntries ?? 200
    };

    this.cache = new DnaLruCache(this.config.cacheMaxEntries);
    this.stackDetector = new StackDetector();
    this.architectureDetector = new ArchitectureDetector();
    this.componentExtractor = new ComponentExtractor();
    this.moduleExtractor = new ModuleExtractor();
    this.graphMetricsExtractor = new GraphMetricsExtractor();
  }

  public extractDNA(
    tenantId: string,
    projectId: string,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): ApplicationDNA {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new ValidationError('Le tenantId est obligatoire pour extraire l Application DNA', { field: 'tenantId' }, requestId);
    }
    if (!projectId || projectId.trim().length === 0) {
      throw new ValidationError('Le projectId est obligatoire pour extraire l Application DNA', { field: 'projectId' }, requestId);
    }

    assertPermission(userRole, 'PROJECT_READ', requestId);

    const summary = this.codeIntelligenceService.analyzeProject(tenantId, projectId, userRole, requestId);
    return this.extractFromSummary(summary, { userRole, requestId });
  }

  public extractFromSummary(
    summary: ProjectAnalysisSummary,
    options?: {
      userRole?: Role | undefined;
      requestId?: string | undefined;
    }
  ): ApplicationDNA {
    if (!summary || typeof summary !== 'object') {
      throw new ValidationError('Le summary du projet est obligatoire', { field: 'summary' }, options?.requestId);
    }
    if (!summary.tenantId) {
      throw new ValidationError('Le tenantId du summary est obligatoire', { field: 'tenantId' }, options?.requestId);
    }
    if (!summary.projectId) {
      throw new ValidationError('Le projectId du summary est obligatoire', { field: 'projectId' }, options?.requestId);
    }

    if (options?.userRole) {
      assertPermission(options.userRole, 'PROJECT_READ', options?.requestId);
    }

    const cacheKey = DnaLruCache.buildKey(
      summary.tenantId,
      summary.projectId,
      summary.treeHash,
      this.config.analyzerVersion
    );

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const startMs = Date.now();

    // 1. Run domain extractors
    const stack = this.stackDetector.detect(summary);
    const architecture = this.architectureDetector.detect(summary);
    const components = this.componentExtractor.extract(summary);
    const modules = this.moduleExtractor.extract(summary);
    const graphMetrics = this.graphMetricsExtractor.extract(summary);

    const durationMs = Date.now() - startMs;

    // 2. Assess overall health
    let overallHealth: DNASummary['overallHealth'] = 'HEALTHY';
    if (summary.totalFiles === 0) {
      overallHealth = 'DEGRADED';
    } else if (summary.diagnosticsCount > 0 || graphMetrics.circularDependencies.length > 0) {
      overallHealth = 'WARNINGS';
    }

    const dnaSummary: DNASummary = {
      totalFiles: summary.totalFiles,
      analyzedFiles: summary.parsedFiles,
      diagnosticsCount: summary.diagnosticsCount,
      overallHealth,
      primaryLanguage: stack.language.name,
      primaryFramework: stack.framework.name
    };

    // 3. Assemble mutable draft for hash calculation
    const rawPayload: Record<string, unknown> = {
      schemaVersion: '1.0.0',
      analyzerVersion: this.config.analyzerVersion,
      tenantId: summary.tenantId,
      projectId: summary.projectId,
      treeHash: summary.treeHash,
      dnaHash: '',
      extractedAt: new Date().toISOString(),
      durationMs,
      stack,
      architecture,
      components,
      modules,
      graphMetrics,
      summary: dnaSummary
    };

    const dnaHash = computeDnaHash(rawPayload);
    rawPayload.dnaHash = dnaHash;

    // 4. Freeze recursively
    const frozenDNA = deepFreeze(rawPayload as unknown as ApplicationDNA);

    // 5. Store in cache
    this.cache.set(cacheKey, frozenDNA);

    return frozenDNA;
  }

  public getCacheMetrics(): DnaCacheMetrics {
    return this.cache.getMetrics();
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
