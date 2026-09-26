/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-003)
 * Context Assembly Service
 */

import type { Role } from '../../identity/permissions.js';
import { assertPermission } from '../../identity/permissions.js';
import { ValidationError } from '../../errors.js';
import type { CodeIntelligenceService } from '../understanding/service.js';
import type { IReadOnlyFileSource } from '../understanding/types.js';
import type { ApplicationDNAService } from '../dna/service.js';
import type {
  ContextAssemblyConfig,
  ContextBudgetConfig,
  ContextCacheMetrics,
  ContextPack,
  ContextRequest,
  IRevisionProvider,
  IWorkspaceProvider
} from './types.js';
import { ContextLruCache } from './cache.js';
import { computeContextHash, computeRequestHash, deepFreeze } from './engine/base.js';
import { ContextCandidateSelector } from './engine/selectors.js';
import { BudgetTrimmer } from './engine/budget-trimmer.js';

export class ContextAssemblyService {
  private readonly config: ContextAssemblyConfig;
  private readonly cache: ContextLruCache;
  private readonly selector: ContextCandidateSelector;
  private readonly trimmer: BudgetTrimmer;

  constructor(
    private readonly codeIntelligenceService: CodeIntelligenceService,
    private readonly applicationDnaService: ApplicationDNAService,
    private readonly fileSource?: IReadOnlyFileSource,
    private readonly revisionProvider?: IRevisionProvider,
    private readonly workspaceProvider?: IWorkspaceProvider,
    config?: Partial<ContextAssemblyConfig>
  ) {
    this.config = {
      assemblerVersion: config?.assemblerVersion ?? '1.0.0',
      cacheMaxEntries: config?.cacheMaxEntries ?? 150,
      defaultBudget: {
        maxTokens: config?.defaultBudget?.maxTokens ?? 8000,
        maxFiles: config?.defaultBudget?.maxFiles ?? 8,
        maxSymbols: config?.defaultBudget?.maxSymbols ?? 25,
        maxDecisions: config?.defaultBudget?.maxDecisions ?? 5
      }
    };

    this.cache = new ContextLruCache(this.config.cacheMaxEntries);
    this.selector = new ContextCandidateSelector();
    this.trimmer = new BudgetTrimmer();
  }

  public assembleContext(
    request: ContextRequest,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): ContextPack {
    const startMs = Date.now();

    // 1. Validation
    if (!request || typeof request !== 'object') {
      throw new ValidationError('La requête de contexte est obligatoire', { field: 'request' }, requestId);
    }
    if (!request.tenantId || request.tenantId.trim().length === 0) {
      throw new ValidationError('Le tenantId est obligatoire', { field: 'tenantId' }, requestId);
    }
    if (!request.projectId || request.projectId.trim().length === 0) {
      throw new ValidationError('Le projectId est obligatoire', { field: 'projectId' }, requestId);
    }

    // Budget validation
    if (request.budget) {
      const b = request.budget;
      if (b.maxTokens !== undefined && (!Number.isInteger(b.maxTokens) || b.maxTokens <= 0)) {
        throw new ValidationError('maxTokens doit être un entier strictement positif', { field: 'budget.maxTokens' }, requestId);
      }
      if (b.maxFiles !== undefined && (!Number.isInteger(b.maxFiles) || b.maxFiles <= 0)) {
        throw new ValidationError('maxFiles doit être un entier strictement positif', { field: 'budget.maxFiles' }, requestId);
      }
      if (b.maxSymbols !== undefined && (!Number.isInteger(b.maxSymbols) || b.maxSymbols <= 0)) {
        throw new ValidationError('maxSymbols doit être un entier strictement positif', { field: 'budget.maxSymbols' }, requestId);
      }
      if (b.maxDecisions !== undefined && (!Number.isInteger(b.maxDecisions) || b.maxDecisions <= 0)) {
        throw new ValidationError('maxDecisions doit être un entier strictement positif', { field: 'budget.maxDecisions' }, requestId);
      }
    }

    // RBAC check
    assertPermission(userRole, 'PROJECT_READ', requestId);

    // 2. Normalize Request
    const normalizedTargetFiles = request.targetFiles ? Array.from(new Set(request.targetFiles)).sort() : undefined;
    const normalizedTargetSymbols = request.targetSymbols ? Array.from(new Set(request.targetSymbols)).sort() : undefined;
    const normalizedTargetLayers = request.targetLayers ? Array.from(new Set(request.targetLayers)).sort() : undefined;

    const effectiveBudget: ContextBudgetConfig = {
      maxTokens: request.budget?.maxTokens ?? this.config.defaultBudget.maxTokens,
      maxFiles: request.budget?.maxFiles ?? this.config.defaultBudget.maxFiles,
      maxSymbols: request.budget?.maxSymbols ?? this.config.defaultBudget.maxSymbols,
      maxDecisions: request.budget?.maxDecisions ?? this.config.defaultBudget.maxDecisions
    };

    const normalizedRequest: ContextRequest = {
      tenantId: request.tenantId,
      projectId: request.projectId,
      taskDescription: request.taskDescription?.trim() || undefined,
      targetFiles: normalizedTargetFiles,
      targetSymbols: normalizedTargetSymbols,
      targetLayers: normalizedTargetLayers,
      budget: effectiveBudget
    };

    const requestHash = computeRequestHash(normalizedRequest as unknown as Record<string, unknown>);

    // 3. Load AINT-001 Project Analysis Summary
    const summary = this.codeIntelligenceService.analyzeProject(
      request.tenantId,
      request.projectId,
      userRole,
      requestId
    );

    // 4. Check Cache
    const cacheKey = ContextLruCache.buildKey(
      request.tenantId,
      request.projectId,
      summary.treeHash,
      requestHash,
      this.config.assemblerVersion
    );

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 5. Load AINT-002 Application DNA
    const dna = this.applicationDnaService.extractFromSummary(summary, { userRole, requestId });

    // 6. Gather all file contents
    const allFiles: Record<string, string> = {};
    if (this.fileSource) {
      Object.assign(allFiles, this.fileSource.getAllProjectFiles(request.tenantId, request.projectId));
    } else {
      // Fallback: file analyses paths with empty content if fileSource not bound
      for (const p of Object.keys(summary.fileAnalyses)) {
        allFiles[p] = '';
      }
    }

    // 7. Select Candidates
    const selection = this.selector.selectCandidates(
      normalizedRequest,
      summary,
      dna,
      allFiles,
      this.workspaceProvider,
      this.revisionProvider
    );

    // 8. Apply Budget & Representation Trimming
    const trimmed = this.trimmer.applyBudget(
      selection.fileCandidates,
      selection.symbolCandidates,
      selection.decisionCandidates,
      effectiveBudget,
      summary
    );

    const durationMs = Date.now() - startMs;

    // 9. Assemble ContextPack Payload
    const draftPayload: Record<string, unknown> = {
      schemaVersion: '1.0.0',
      assemblerVersion: this.config.assemblerVersion,
      tenantId: request.tenantId,
      projectId: request.projectId,
      treeHash: summary.treeHash,
      contextHash: '',
      assembledAt: new Date().toISOString(),
      durationMs,
      systemSummary: {
        primaryLanguage: dna.summary.primaryLanguage,
        primaryFramework: dna.summary.primaryFramework,
        architecturePattern: dna.architecture.primaryPattern.pattern,
        overallHealth: dna.summary.overallHealth
      },
      files: trimmed.files,
      symbols: trimmed.symbols,
      decisions: trimmed.decisions,
      diagnostics: selection.activeDiagnostics,
      budgetUsage: trimmed.budgetUsage,
      traces: selection.traces
    };

    const contextHash = computeContextHash(draftPayload);
    draftPayload.contextHash = contextHash;

    // 10. Deep Freeze & Cache
    const frozenPack = deepFreeze(draftPayload as unknown as ContextPack);
    this.cache.set(cacheKey, frozenPack);

    return frozenPack;
  }

  public getCacheMetrics(): ContextCacheMetrics {
    return this.cache.getMetrics();
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
