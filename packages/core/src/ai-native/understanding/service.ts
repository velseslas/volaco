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
  CodeSearchHit,
  CodeSearchMode,
  CodeSearchOptions,
  CodeSearchResult,
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

  // ==========================================================================
  // RAG — CODE SEARCH (CDC §22). L'index n'existe pas en repos : il est
  // construit À LA DEMANDE depuis analyzeProject (lazy loading) puis jeté.
  // Cinq modes du CDC : exact, lexical, semantic (expansion de symboles),
  // metadata (filtre kind/export) et dependency-aware (boost des fichiers
  // liés via le graphe de dépendances déjà calculé par l'analyse).
  // ==========================================================================

  private static readonly MAX_SEARCH_CONTENT_BYTES = 256 * 1024;

  /** Expansion sémantique légère (sans embeddings) : camelCase + synonymes métier. */
  private static readonly SEMANTIC_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
    auth: ['authentication', 'login', 'session', 'token'],
    login: ['authentication', 'auth', 'session'],
    user: ['account', 'profile', 'customer'],
    search: ['query', 'find', 'lookup'],
    image: ['picture', 'photo', 'asset'],
    payment: ['billing', 'checkout', 'invoice'],
    cart: ['basket', 'order'],
    mail: ['email', 'message'],
    config: ['settings', 'options'],
    error: ['exception', 'failure']
  };

  private static tokenize(text: string): string[] {
    return text
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2);
  }

  private static expandTokens(tokens: readonly string[]): string[] {
    const expanded = new Set<string>();
    for (const t of tokens) {
      expanded.add(t);
      const singular = t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : null;
      if (singular) expanded.add(singular);
      const syn = CodeIntelligenceService.SEMANTIC_SYNONYMS[t];
      if (syn) for (const s of syn) expanded.add(s);
    }
    return Array.from(expanded);
  }

  public searchCode(
    tenantId: string,
    projectId: string,
    query: string,
    options: CodeSearchOptions = {},
    userRole: Role = 'VIEWER',
    requestId?: string
  ): CodeSearchResult {
    if (!tenantId || !projectId) {
      throw new ValidationError('Le tenantId et le projectId sont obligatoires', { field: 'tenantId' }, requestId);
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      throw new ValidationError('La requête de recherche doit contenir au moins 2 caractères', { field: 'query' }, requestId);
    }
    assertPermission(userRole, 'PROJECT_READ', requestId);
    if (!this.fileSource) {
      throw new ValidationError('Aucun fileSource configuré pour CodeIntelligenceService', undefined, requestId);
    }

    const modes = options.modes && options.modes.length > 0 ? options.modes : (['exact', 'lexical', 'semantic', 'metadata', 'dependency'] as const);
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    const queryTokens = CodeIntelligenceService.tokenize(trimmed);
    const semanticTokens = new Set(CodeIntelligenceService.expandTokens(queryTokens));
    const lowerQuery = trimmed.toLowerCase();

    // Lazy : l'index vit le temps de cette recherche uniquement.
    const summary = this.analyzeProject(tenantId, projectId, userRole, requestId);
    const files = this.fileSource.getAllProjectFiles(tenantId, projectId);

    interface Candidate {
      filePath: string;
      symbolName?: string | undefined;
      kind?: string | undefined;
      score: number;
      matchedBy: Set<CodeSearchMode>;
      snippet: string;
    }
    const candidates = new Map<string, Candidate>();

    const bump = (
      key: string,
      filePath: string,
      delta: number,
      mode: CodeSearchMode,
      meta: { symbolName?: string; kind?: string; snippet?: string } = {}
    ): void => {
      const existing = candidates.get(key);
      if (existing) {
        existing.score += delta;
        existing.matchedBy.add(mode);
        if (meta.symbolName && !existing.symbolName) existing.symbolName = meta.symbolName;
        if (meta.kind && !existing.kind) existing.kind = meta.kind;
        if (meta.snippet && !existing.snippet) existing.snippet = meta.snippet;
      } else {
        candidates.set(key, {
          filePath,
          symbolName: meta.symbolName,
          kind: meta.kind,
          score: delta,
          matchedBy: new Set([mode]),
          snippet: meta.snippet ?? ''
        });
      }
    };

    for (const [filePath, analysis] of Object.entries(summary.fileAnalyses)) {
      for (const symbol of analysis.symbols) {
        const lowerName = symbol.name.toLowerCase();
        const nameTokens = new Set(CodeIntelligenceService.tokenize(symbol.name));
        const docTokens = new Set(
          CodeIntelligenceService.tokenize(`${symbol.docstring ?? ''} ${symbol.signature ?? ''}`)
        );

        if (modes.includes('exact') && lowerName === lowerQuery) {
          bump(`${filePath}#${symbol.name}`, filePath, 100, 'exact', {
            symbolName: symbol.name, kind: symbol.kind, snippet: symbol.signature ?? symbol.name
          });
        }
        if (modes.includes('exact') && symbol.kind === 'route' && symbol.route?.path === trimmed) {
          bump(`${filePath}#${symbol.name}:route`, filePath, 90, 'exact', {
            symbolName: symbol.name, kind: symbol.kind, snippet: symbol.route.path
          });
        }
        if (modes.includes('lexical')) {
          let overlap = 0;
          for (const t of queryTokens) if (nameTokens.has(t)) overlap += 3;
          for (const t of queryTokens) if (docTokens.has(t)) overlap += 1;
          if (overlap > 0) {
            bump(`${filePath}#${symbol.name}`, filePath, overlap, 'lexical', {
              symbolName: symbol.name, kind: symbol.kind, snippet: symbol.signature ?? symbol.name
            });
          }
        }
        if (modes.includes('semantic') && lowerName !== lowerQuery) {
          let sem = 0;
          for (const t of semanticTokens) {
            if (nameTokens.has(t)) sem += 3;
            else if (docTokens.has(t)) sem += 1;
          }
          if (sem > 0 && !(queryTokens.length > 0 && queryTokens.every((t) => nameTokens.has(t)))) {
            bump(`${filePath}#${symbol.name}`, filePath, sem, 'semantic', {
              symbolName: symbol.name, kind: symbol.kind, snippet: symbol.docstring ?? symbol.signature ?? symbol.name
            });
          }
        }
        if (modes.includes('metadata')) {
          let meta = 0;
          if (options.kind && symbol.kind === options.kind) meta += 10;
          if (symbol.isExported) meta += 2;
          if (symbol.route) meta += 1;
          if (meta > 0 && (options.kind || queryTokens.every((t) => nameTokens.has(t) || docTokens.has(t)))) {
            bump(`${filePath}#${symbol.name}:meta`, filePath, meta, 'metadata', {
              symbolName: symbol.name, kind: symbol.kind, snippet: symbol.signature ?? symbol.name
            });
          }
        }
      }

      // Recherche lexicale dans le contenu (lazy, borné à MAX_SEARCH_CONTENT_BYTES).
      if (modes.includes('lexical') || modes.includes('semantic')) {
        const content = (files[filePath] ?? '').slice(0, CodeIntelligenceService.MAX_SEARCH_CONTENT_BYTES);
        if (content.length > 0) {
          const lowerContent = content.toLowerCase();
          let contentScore = 0;
          if (modes.includes('lexical')) {
            for (const t of queryTokens) {
              let idx = lowerContent.indexOf(t);
              let count = 0;
              while (idx !== -1 && count < 10) {
                count++;
                idx = lowerContent.indexOf(t, idx + t.length);
              }
              contentScore += Math.min(count, 10) * 0.5;
            }
          }
          if (contentScore > 0) {
            const lineStart = content.split('\n').findIndex((l) => l.toLowerCase().includes(queryTokens[0] ?? ''));
            const snippet = lineStart >= 0
              ? content.split('\n').slice(Math.max(0, lineStart), Math.max(0, lineStart) + 2).join('\n').slice(0, 200)
              : '';
            bump(`${filePath}#content`, filePath, contentScore, 'lexical', { snippet });
          }
        }
      }

      if (modes.includes('exact')) {
        const base = filePath.split('/').pop() ?? filePath;
        if (base.toLowerCase().includes(lowerQuery)) {
          bump(`${filePath}#file`, filePath, 60, 'exact', { snippet: filePath });
        }
      }
    }

    // Dependency-aware : boost des fichiers directement liés aux meilleurs hits.
    if (modes.includes('dependency')) {
      const topFiles = Array.from(candidates.values())
        .filter((c) => c.score >= 10)
        .map((c) => c.filePath);
      const related = new Set<string>();
      for (const f of topFiles) {
        for (const dep of summary.dependencyGraph[f] ?? []) {
          const normalized = dep.replace(/^[./]+/, '').replace(/\.(js|ts|jsx|tsx)$/, '');
          for (const candidatePath of Object.keys(summary.dependencyGraph)) {
            const candidateNorm = candidatePath.replace(/\\/g, '/').replace(/\.(js|ts|jsx|tsx)$/, '');
            if (candidateNorm.endsWith(normalized)) related.add(candidatePath);
          }
        }
      }
      for (const r of related) {
        if (!topFiles.includes(r)) {
          bump(`${r}#dep`, r, 8, 'dependency', { snippet: `lié à un résultat principal (${r})` });
        }
      }
    }

    const filtered = Array.from(candidates.values())
      .filter((c) => (options.kind ? c.kind === options.kind || c.matchedBy.has('dependency') : true))
      .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath));

    const hits: CodeSearchHit[] = filtered.slice(0, limit).map((c) => ({
      filePath: c.filePath,
      symbolName: c.symbolName,
      kind: c.kind,
      score: Math.round(c.score * 100) / 100,
      matchedBy: Array.from(c.matchedBy),
      snippet: c.snippet
    }));

    return {
      query: trimmed,
      modes: Array.from(modes),
      totalHits: filtered.length,
      truncated: filtered.length > hits.length,
      hits
    };
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
