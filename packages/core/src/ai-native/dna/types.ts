/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-002)
 * Application DNA Data Contracts
 */

export type DNAConfidence = 'CONFIRMED' | 'INFERRED' | 'UNKNOWN';

export type DNAEvidenceKind =
  | 'PACKAGE_DEPENDENCY'
  | 'CONFIG_FILE'
  | 'FILE_EXTENSION'
  | 'AST_IMPORT'
  | 'AST_SYMBOL'
  | 'AST_ROUTE'
  | 'AST_COMPONENT'
  | 'DIRECTORY_STRUCTURE';

export interface DNAEvidence {
  readonly kind: DNAEvidenceKind;
  readonly path: string;
  readonly line?: number | undefined;
  readonly detail: string;
  readonly confidence: DNAConfidence;
}

export type TechnologyCategory =
  | 'framework'
  | 'language'
  | 'runtime'
  | 'ui'
  | 'state'
  | 'database'
  | 'orm'
  | 'testing'
  | 'build_tool'
  | 'styling'
  | 'other';

export interface DetectedTechnology {
  readonly name: string;
  readonly category: TechnologyCategory;
  readonly version?: string | undefined;
  readonly confidence: DNAConfidence;
  readonly evidence: readonly DNAEvidence[];
}

export interface ApplicationStack {
  readonly language: DetectedTechnology;
  readonly framework: DetectedTechnology;
  readonly runtime: DetectedTechnology;
  readonly uiLibrary?: DetectedTechnology | undefined;
  readonly stateManagement?: DetectedTechnology | undefined;
  readonly databaseOrOrm?: DetectedTechnology | undefined;
  readonly testFramework?: DetectedTechnology | undefined;
  readonly buildTool?: DetectedTechnology | undefined;
  readonly styling?: DetectedTechnology | undefined;
  readonly additionalTechnologies: readonly DetectedTechnology[];
}

export type ArchitecturalLayerKind =
  | 'frontend'
  | 'backend'
  | 'api_routes'
  | 'data_access'
  | 'domain_models'
  | 'shared_utils'
  | 'config'
  | 'tests'
  | 'assets'
  | 'unknown';

export interface ArchitecturalLayer {
  readonly name: string;
  readonly kind: ArchitecturalLayerKind;
  readonly filePaths: readonly string[];
  readonly dependenciesOnLayers: readonly string[];
  readonly confidence: DNAConfidence;
}

export type PatternKind =
  | 'SPA'
  | 'SSR'
  | 'REST_API'
  | 'GRAPHQL_API'
  | 'MVC'
  | 'LAYERED_ARCHITECTURE'
  | 'MONOLITH'
  | 'MICROSERVICE_COMPONENT'
  | 'JAMSTACK'
  | 'UNKNOWN';

export interface DetectedPattern {
  readonly pattern: PatternKind;
  readonly confidence: DNAConfidence;
  readonly evidence: readonly DNAEvidence[];
}

export type EntryPointRole = 'client_entry' | 'server_entry' | 'worker_entry' | 'config_entry';

export interface EntryPoint {
  readonly path: string;
  readonly role: EntryPointRole;
  readonly confidence: DNAConfidence;
}

export interface ApplicationArchitecture {
  readonly primaryPattern: DetectedPattern;
  readonly entryPoints: readonly EntryPoint[];
  readonly layers: readonly ArchitecturalLayer[];
  readonly routesCount: number;
  readonly componentsCount: number;
}

export interface ComponentProfile {
  readonly name: string;
  readonly filePath: string;
  readonly classification: 'COMPONENT_CONFIRMED' | 'COMPONENT_INFERRED';
  readonly propsCount: number;
  readonly hooksUsed: readonly string[];
  readonly lineStart: number;
  readonly lineEnd: number;
}

export interface ModuleBoundary {
  readonly name: string;
  readonly rootPath: string;
  readonly files: readonly string[];
  readonly publicExports: readonly string[];
  readonly externalDependencies: readonly string[];
}

export interface GraphMetrics {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly directDependencies: Record<string, readonly string[]>;
  readonly reverseDependencies: Record<string, readonly string[]>;
  readonly topologicalOrder: readonly string[];
  readonly circularDependencies: readonly (readonly string[])[];
  readonly isolatedFiles: readonly string[];
  readonly mostDependedOnFiles: readonly { readonly path: string; readonly dependentsCount: number }[];
}

export interface DNASummary {
  readonly totalFiles: number;
  readonly analyzedFiles: number;
  readonly diagnosticsCount: number;
  readonly overallHealth: 'HEALTHY' | 'WARNINGS' | 'DEGRADED';
  readonly primaryLanguage: string;
  readonly primaryFramework: string;
}

export interface ApplicationDNA {
  readonly schemaVersion: '1.0.0';
  readonly analyzerVersion: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly treeHash: string;
  readonly dnaHash: string;
  readonly extractedAt: string;
  readonly durationMs: number;
  readonly stack: ApplicationStack;
  readonly architecture: ApplicationArchitecture;
  readonly components: readonly ComponentProfile[];
  readonly modules: readonly ModuleBoundary[];
  readonly graphMetrics: GraphMetrics;
  readonly summary: DNASummary;
}

export interface ApplicationDNAConfig {
  readonly analyzerVersion: string;
  readonly cacheMaxEntries: number;
}

export interface DnaCacheMetrics {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly entryCount: number;
  readonly maxEntries: number;
}
