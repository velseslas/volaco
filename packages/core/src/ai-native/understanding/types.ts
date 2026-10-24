/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-001)
 * Code Intelligence & AST Engine Data Contracts
 */

export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'tsx'
  | 'jsx'
  | 'json'
  | 'html'
  | 'css'
  | 'unknown';

export type SymbolKind =
  | 'function'
  | 'arrow_function'
  | 'method'
  | 'getter'
  | 'setter'
  | 'constructor'
  | 'class'
  | 'interface'
  | 'type_alias'
  | 'enum'
  | 'variable'
  | 'constant'
  | 'component'
  | 'route';

export type ComponentClassification =
  | 'COMPONENT_CONFIRMED'
  | 'COMPONENT_INFERRED'
  | 'NOT_COMPONENT';

export type RouteConfidence =
  | 'CONFIRMED'
  | 'INFERRED';

export type AnalysisStatus =
  | 'PARSED'
  | 'PARSED_WITH_DIAGNOSTICS'
  | 'OPAQUE_BLOB'
  | 'EMPTY';

export interface CodeDiagnostic {
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly code?: string;
}

export interface RouteEndpoint {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL' | 'USE';
  readonly path: string;
  readonly confidence: RouteConfidence;
  readonly line: number;
}

export interface CodeSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly isExported: boolean;
  readonly isDefaultExport: boolean;
  readonly signature?: string | undefined;
  readonly docstring?: string | undefined;
  readonly componentClassification?: ComponentClassification | undefined;
  readonly props?: readonly string[] | undefined;
  readonly hooksUsed?: readonly string[] | undefined;
  readonly route?: RouteEndpoint | undefined;
  readonly decorators?: readonly string[] | undefined;
  readonly typeParameters?: readonly string[] | undefined;
}

export interface CodeImport {
  readonly moduleSpecifier: string;
  readonly isRelative: boolean;
  readonly defaultImport?: string | undefined;
  readonly namedImports: readonly string[];
  readonly namespaceImport?: string | undefined;
  readonly isTypeOnly: boolean;
  readonly line: number;
}

export interface CodeExport {
  readonly name: string;
  readonly isDefault: boolean;
  readonly isTypeOnly: boolean;
  readonly sourceModule?: string | undefined;
  readonly line: number;
}

export interface FileAnalysis {
  readonly tenantId: string;
  readonly projectId: string;
  readonly filePath: string;
  readonly fileHash: string;
  readonly language: SupportedLanguage;
  readonly parser: string;
  readonly analysisStatus: AnalysisStatus;
  readonly semanticHash: string;
  readonly diagnostics: readonly CodeDiagnostic[];
  readonly symbols: readonly CodeSymbol[];
  readonly imports: readonly CodeImport[];
  readonly exports: readonly CodeExport[];
  readonly dependencies: readonly string[];
  readonly lineCount: number;
  readonly sizeBytes: number;
  readonly executionMeta: {
    readonly analyzedAt: string;
    readonly durationMs: number;
    readonly analyzerVersion: string;
  };
}

export interface ProjectAnalysisSummary {
  readonly tenantId: string;
  readonly projectId: string;
  readonly treeHash: string;
  readonly totalFiles: number;
  readonly parsedFiles: number;
  readonly diagnosticsCount: number;
  readonly opaqueFiles: number;
  readonly emptyFiles: number;
  readonly fileAnalyses: Record<string, FileAnalysis>;
  readonly globalExports: Record<string, { readonly filePath: string; readonly symbol: CodeSymbol }>;
  readonly dependencyGraph: Record<string, readonly string[]>;
}

export interface CacheMetrics {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly entryCount: number;
  readonly maxEntries: number;
}

export interface CodeIntelligenceConfig {
  readonly maxFileSizeBytes: number;
  readonly cacheMaxEntries: number;
  readonly analyzerVersion: string;
}

// ============================================================================
// RAG — CODE SEARCH (CDC §22 : lexical, semantic, metadata, dependency-aware,
// exact search ; contexte chargé de manière lazy)
// ============================================================================

export type CodeSearchMode =
  | 'exact'
  | 'lexical'
  | 'semantic'
  | 'metadata'
  | 'dependency';

export interface CodeSearchHit {
  readonly filePath: string;
  readonly symbolName?: string | undefined;
  readonly kind?: string | undefined;
  readonly score: number;
  readonly matchedBy: readonly CodeSearchMode[];
  readonly snippet: string;
}

export interface CodeSearchOptions {
  readonly kind?: string | undefined;
  readonly limit?: number | undefined;
  readonly modes?: readonly CodeSearchMode[] | undefined;
}

export interface CodeSearchResult {
  readonly query: string;
  readonly modes: readonly CodeSearchMode[];
  readonly totalHits: number;
  readonly truncated: boolean;
  readonly hits: readonly CodeSearchHit[];
}

export interface IReadOnlyFileSource {
  getFile(tenantId: string, projectId: string, filePath: string): {
    path: string;
    name: string;
    content: string;
    sizeBytes: number;
    hash?: string;
    updatedAt: Date;
  } | null;
  getAllProjectFiles(tenantId: string, projectId: string): Record<string, string>;
  computeTreeHash?(tenantId: string, projectId: string): string;
}
