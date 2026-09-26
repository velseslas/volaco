/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-001)
 * Code Intelligence & AST Engine Service
 */

import { createHash } from 'node:crypto';
import type { Role } from '../../identity/permissions.js';
import { assertPermission } from '../../identity/permissions.js';
import { NotFoundError, ValidationError } from '../../errors.js';
import type {
  CacheMetrics,
  CodeDiagnostic,
  CodeIntelligenceConfig,
  FileAnalysis,
  IReadOnlyFileSource,
  ProjectAnalysisSummary
} from './types.js';
import { AnalysisLruCache } from './cache.js';
import { LanguageAnalyzerRegistry } from './registry.js';
import { computeSemanticHash } from './analyzers/base.js';

export class CodeIntelligenceService {
  private readonly config: CodeIntelligenceConfig;
  private readonly cache: AnalysisLruCache;
  private readonly registry: LanguageAnalyzerRegistry;

  constructor(
    private readonly fileSource?: IReadOnlyFileSource,
    config?: Partial<CodeIntelligenceConfig>
  ) {
    this.config = {
      maxFileSizeBytes: config?.maxFileSizeBytes ?? 512 * 1024, // 512 KiB default limit
      cacheMaxEntries: config?.cacheMaxEntries ?? 500,
      analyzerVersion: config?.analyzerVersion ?? '1.0.0'
    };

    this.cache = new AnalysisLruCache(this.config.cacheMaxEntries);
    this.registry = new LanguageAnalyzerRegistry();
  }

  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  public analyzeSource(
    content: string,
    filePath: string,
    options?: {
      tenantId?: string | undefined;
      projectId?: string | undefined;
      fileHash?: string | undefined;
    }
  ): FileAnalysis {
    const tenantId = options?.tenantId ?? 'default-tenant';
    const projectId = options?.projectId ?? 'default-project';
    const fileHash = options?.fileHash ?? this.computeHash(content);

    const cacheKey = AnalysisLruCache.buildKey(
      tenantId,
      projectId,
      filePath,
      fileHash,
      this.config.analyzerVersion
    );

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const sizeBytes = Buffer.byteLength(content, 'utf8');
    const lineCount = content.split('\n').length;

    // Check size limit before parsing
    if (sizeBytes > this.config.maxFileSizeBytes) {
      const diag: CodeDiagnostic = {
        severity: 'warning',
        message: `File size (${sizeBytes} bytes) exceeds limit of ${this.config.maxFileSizeBytes} bytes. Treated as OPAQUE_BLOB.`,
        code: 'FILE_TOO_LARGE',
        line: 1,
        column: 1
      };

      const semanticHash = computeSemanticHash({
        filePath,
        fileHash,
        language: 'unknown',
        analysisStatus: 'OPAQUE_BLOB',
        symbols: [],
        imports: [],
        exports: [],
        dependencies: [],
        diagnostics: [diag]
      });

      const opaqueResult: FileAnalysis = {
        tenantId,
        projectId,
        filePath,
        fileHash,
        language: 'unknown',
        parser: 'OpaqueBlobFallback',
        analysisStatus: 'OPAQUE_BLOB',
        semanticHash,
        diagnostics: [diag],
        symbols: [],
        imports: [],
        exports: [],
        dependencies: [],
        lineCount,
        sizeBytes,
        executionMeta: {
          analyzedAt: new Date().toISOString(),
          durationMs: 0,
          analyzerVersion: this.config.analyzerVersion
        }
      };

      this.cache.set(cacheKey, opaqueResult);
      return opaqueResult;
    }

    const analyzer = this.registry.resolve(filePath);

    let result: FileAnalysis;
    if (!analyzer) {
      // Unsupported extension -> OPAQUE_BLOB
      const diag: CodeDiagnostic = {
        severity: 'info',
        message: `File extension is not supported for AST parsing. Treated as OPAQUE_BLOB.`,
        code: 'UNSUPPORTED_LANGUAGE',
        line: 1,
        column: 1
      };

      const semanticHash = computeSemanticHash({
        filePath,
        fileHash,
        language: 'unknown',
        analysisStatus: 'OPAQUE_BLOB',
        symbols: [],
        imports: [],
        exports: [],
        dependencies: [],
        diagnostics: [diag]
      });

      result = {
        tenantId,
        projectId,
        filePath,
        fileHash,
        language: 'unknown',
        parser: 'OpaqueBlobFallback',
        analysisStatus: 'OPAQUE_BLOB',
        semanticHash,
        diagnostics: [diag],
        symbols: [],
        imports: [],
        exports: [],
        dependencies: [],
        lineCount,
        sizeBytes,
        executionMeta: {
          analyzedAt: new Date().toISOString(),
          durationMs: 0,
          analyzerVersion: this.config.analyzerVersion
        }
      };
    } else {
      result = analyzer.analyze(content, filePath, {
        tenantId,
        projectId,
        fileHash,
        analyzerVersion: this.config.analyzerVersion
      });
    }

    this.cache.set(cacheKey, result);
    return result;
  }

  public analyzeFile(
    tenantId: string,
    projectId: string,
    filePath: string,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): FileAnalysis {
    if (!tenantId) {
      throw new ValidationError('Le tenantId est obligatoire', { field: 'tenantId' }, requestId);
    }
    if (!projectId) {
      throw new ValidationError('Le projectId est obligatoire', { field: 'projectId' }, requestId);
    }
    if (!filePath) {
      throw new ValidationError('Le filePath est obligatoire', { field: 'filePath' }, requestId);
    }

    assertPermission(userRole, 'PROJECT_READ', requestId);

    if (!this.fileSource) {
      throw new ValidationError('Aucun fileSource configuré pour CodeIntelligenceService', undefined, requestId);
    }

    const file = this.fileSource.getFile(tenantId, projectId, filePath);
    if (!file) {
      throw new NotFoundError(`Fichier "${filePath}" introuvable pour le projet ${projectId}`, requestId);
    }

    return this.analyzeSource(file.content, file.path, {
      tenantId,
      projectId,
      fileHash: file.hash ?? undefined
    });
  }

  public analyzeProject(
    tenantId: string,
    projectId: string,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): ProjectAnalysisSummary {
    if (!tenantId) {
      throw new ValidationError('Le tenantId est obligatoire', { field: 'tenantId' }, requestId);
    }
    if (!projectId) {
      throw new ValidationError('Le projectId est obligatoire', { field: 'projectId' }, requestId);
    }

    assertPermission(userRole, 'PROJECT_READ', requestId);

    if (!this.fileSource) {
      throw new ValidationError('Aucun fileSource configuré pour CodeIntelligenceService', undefined, requestId);
    }

    const files = this.fileSource.getAllProjectFiles(tenantId, projectId);
    const sortedPaths = Object.keys(files).sort();

    const fileAnalyses: Record<string, FileAnalysis> = {};
    const globalExports: Record<string, { filePath: string; symbol: FileAnalysis['symbols'][number] }> = {};
    const dependencyGraph: Record<string, string[]> = {};

    let totalFiles = 0;
    let parsedFiles = 0;
    let diagnosticsCount = 0;
    let opaqueFiles = 0;
    let emptyFiles = 0;

    for (const p of sortedPaths) {
      totalFiles++;
      const content = files[p] ?? '';

      try {
        const analysis = this.analyzeSource(content, p, {
          tenantId,
          projectId
        });

        fileAnalyses[p] = analysis;
        diagnosticsCount += analysis.diagnostics.length;

        if (analysis.analysisStatus === 'PARSED') {
          parsedFiles++;
        } else if (analysis.analysisStatus === 'PARSED_WITH_DIAGNOSTICS') {
          parsedFiles++;
        } else if (analysis.analysisStatus === 'OPAQUE_BLOB') {
          opaqueFiles++;
        } else if (analysis.analysisStatus === 'EMPTY') {
          emptyFiles++;
        }

        // Map global exports
        for (const exp of analysis.exports) {
          const matchedSymbol = analysis.symbols.find(s => s.name === exp.name);
          if (matchedSymbol) {
            globalExports[`${p}#${exp.name}`] = {
              filePath: p,
              symbol: matchedSymbol
            };
          }
        }

        // Map dependencies
        dependencyGraph[p] = [...analysis.dependencies];
      } catch (err: unknown) {
        // Isolate error per file: an unexpected file-level issue does not crash project analysis
        opaqueFiles++;
        diagnosticsCount++;
        const msg = err instanceof Error ? err.message : 'Unexpected file analysis error';
        const fileHash = this.computeHash(content);

        const fallbackAnalysis: FileAnalysis = {
          tenantId,
          projectId,
          filePath: p,
          fileHash,
          language: 'unknown',
          parser: 'SafeFallback',
          analysisStatus: 'OPAQUE_BLOB',
          semanticHash: this.computeHash(p + fileHash),
          diagnostics: [{
            severity: 'error',
            message: msg,
            line: 1,
            column: 1
          }],
          symbols: [],
          imports: [],
          exports: [],
          dependencies: [],
          lineCount: content.split('\n').length,
          sizeBytes: Buffer.byteLength(content, 'utf8'),
          executionMeta: {
            analyzedAt: new Date().toISOString(),
            durationMs: 0,
            analyzerVersion: this.config.analyzerVersion
          }
        };

        fileAnalyses[p] = fallbackAnalysis;
        dependencyGraph[p] = [];
      }
    }

    const treeHash = this.fileSource.computeTreeHash
      ? this.fileSource.computeTreeHash(tenantId, projectId)
      : this.computeHash(JSON.stringify(sortedPaths.map(p => ({ path: p, hash: fileAnalyses[p]?.fileHash }))));

    return {
      tenantId,
      projectId,
      treeHash,
      totalFiles,
      parsedFiles,
      diagnosticsCount,
      opaqueFiles,
      emptyFiles,
      fileAnalyses,
      globalExports,
      dependencyGraph
    };
  }

  public getCacheMetrics(): CacheMetrics {
    return this.cache.getMetrics();
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
