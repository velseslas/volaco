/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-003)
 * Context Assembly Engine Data Contracts
 */

import type { Role } from '../../identity/permissions.js';

export type ContextRelevanceReason =
  | 'TARGET_FILE'
  | 'ACTIVE_WORKSPACE_FILE'
  | 'DIRTY_WORKSPACE_FILE'
  | 'INTENT_SEMANTIC_MATCH'
  | 'TARGET_SYMBOL'
  | 'TARGET_LAYER'
  | 'DIRECT_DEPENDENCY'
  | 'REVERSE_DEPENDENCY'
  | 'ENTRY_POINT'
  | 'HIGH_CENTRALITY'
  | 'ARCHITECTURE_DEFINITION'
  | 'MODULE_BOUNDARY'
  | 'RECENT_TECHNICAL_DECISION'
  | 'ACTIVE_DIAGNOSTIC_WARNING';

export interface ContextItemProvenance {
  readonly reason: ContextRelevanceReason;
  readonly score: number;
  readonly detail: string;
  readonly matchedTokens?: readonly string[] | undefined;
}

export type FileRepresentation = 'FULL' | 'OUTLINE' | 'TRUNCATED';

export interface ContextFileItem {
  readonly filePath: string;
  readonly content: string;
  readonly lineCount: number;
  readonly estimatedTokens: number;
  readonly provenance: ContextItemProvenance;
  readonly includedSymbols?: readonly string[] | undefined;
  readonly representation: FileRepresentation;
}

export interface ContextSymbolItem {
  readonly name: string;
  readonly filePath: string;
  readonly kind: string;
  readonly lineStart?: number | undefined;
  readonly lineEnd?: number | undefined;
  readonly signature?: string | undefined;
  readonly docstring?: string | undefined;
  readonly estimatedTokens: number;
  readonly provenance: ContextItemProvenance;
}

export interface ContextDecisionItem {
  readonly id: string;
  readonly title: string;
  readonly rationale: string;
  readonly impact: string;
  readonly provenance: ContextItemProvenance;
}

export interface ContextBudgetConfig {
  readonly maxTokens: number;
  readonly maxFiles: number;
  readonly maxSymbols: number;
  readonly maxDecisions: number;
}

export interface ContextBudgetUsage {
  readonly totalTokens: number;
  readonly fileCount: number;
  readonly symbolCount: number;
  readonly decisionCount: number;
  readonly isBudgetExceeded: boolean;
  readonly truncatedItemsCount: number;
}

export interface ContextRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly taskDescription?: string | undefined;
  readonly targetFiles?: readonly string[] | undefined;
  readonly targetSymbols?: readonly string[] | undefined;
  readonly targetLayers?: readonly string[] | undefined;
  readonly budget?: Partial<ContextBudgetConfig> | undefined;
}

export interface ContextPack {
  readonly schemaVersion: '1.0.0';
  readonly assemblerVersion: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly treeHash: string;
  readonly contextHash: string;
  readonly assembledAt: string;
  readonly durationMs: number;

  readonly systemSummary: {
    readonly primaryLanguage: string;
    readonly primaryFramework: string;
    readonly architecturePattern: string;
    readonly overallHealth: string;
  };

  readonly files: readonly ContextFileItem[];
  readonly symbols: readonly ContextSymbolItem[];
  readonly decisions: readonly ContextDecisionItem[];
  readonly diagnostics: readonly string[];

  readonly budgetUsage: ContextBudgetUsage;

  readonly traces: readonly string[];
}

export interface ContextAssemblyConfig {
  readonly assemblerVersion: string;
  readonly cacheMaxEntries: number;
  readonly defaultBudget: ContextBudgetConfig;
}

export interface ContextCacheMetrics {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly entryCount: number;
  readonly maxEntries: number;
}

export interface IWorkspaceProvider {
  getWorkspace?(
    tenantId: string,
    projectId: string,
    userRole?: Role,
    requestId?: string
  ): {
    state?: {
      activeFile?: string | undefined;
      openFiles?: readonly string[] | undefined;
      isDirty?: boolean | undefined;
      dirtyFiles?: readonly string[] | undefined;
    } | undefined;
  } | null | undefined;
}

export interface IRevisionProvider {
  listRevisions(tenantId: string, projectId: string): readonly {
    readonly id: string;
    readonly revisionNumber: number;
    readonly decisions?: readonly {
      readonly id: string;
      readonly title: string;
      readonly rationale: string;
      readonly impact: string;
      readonly timestamp?: Date | string | undefined;
    }[] | undefined;
    readonly createdAt?: Date | string | undefined;
  }[];
}
