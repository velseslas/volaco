/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-006)
 * Mutation Orchestrator Contracts, Types & Error Hierarchy
 */

import { AppError } from '../../errors.js';
import type { SemanticEvidence } from '../semantic-graph/types.js';
import type { ImpactAnalysis, ImpactRiskLevel } from '../impact-intelligence/types.js';

// ============================================================================
// 1. MUTATION & PRECONDITION KINDS
// ============================================================================

export type MutationKind =
  | 'CREATE_FILE'
  | 'UPDATE_FILE'
  | 'DELETE_FILE'
  | 'RENAME_FILE'
  | 'MOVE_FILE'
  | 'UPDATE_SYMBOL'
  | 'UPDATE_IMPORT'
  | 'UPDATE_EXPORT'
  | 'UPDATE_ROUTE'
  | 'UPDATE_COMPONENT';

export type PreconditionKind =
  | 'FILE_EXISTS'
  | 'FILE_NOT_EXISTS'
  | 'SYMBOL_EXISTS'
  | 'SYMBOL_NOT_EXISTS'
  | 'CONTENT_HASH_MATCHES'
  | 'GRAPH_HASH_MATCHES'
  | 'LINE_RANGE_EXISTS'
  | 'IMPORT_EXISTS';

export type MutationValidationStatus =
  | 'PENDING'
  | 'VALIDATED'
  | 'REJECTED';

export type TransactionStatus =
  | 'PLANNED'
  | 'EXECUTING'
  | 'COMMITTED'
  | 'ROLLED_BACK'
  | 'FAILED';

// ============================================================================
// 2. PRECONDITIONS & OPERATIONS
// ============================================================================

export interface MutationPrecondition {
  readonly kind: PreconditionKind;
  readonly target: string;
  readonly expectedValue?: string | undefined;
  readonly description: string;
}

export interface MutationOperation {
  readonly path: string;
  readonly newPath?: string | undefined;
  readonly content?: string | undefined;
  readonly symbolName?: string | undefined;
  readonly importSpecifier?: string | undefined;
  readonly lineStart?: number | undefined;
  readonly lineEnd?: number | undefined;
  readonly replacement?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface SingleMutation {
  readonly mutationId: string;
  readonly kind: MutationKind;
  readonly target: string;
  readonly preconditions: readonly MutationPrecondition[];
  readonly operation: MutationOperation;
  readonly expectedOutcome: string;
  readonly evidence: readonly SemanticEvidence[];
  readonly contentHashBefore?: string | undefined;
  readonly contentHashAfter?: string | undefined;
}

// ============================================================================
// 3. MUTATION PLAN & INVARIANTS
// ============================================================================

export interface MutationPlan {
  readonly schemaVersion: '1.0.0';
  readonly planId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly requestId?: string | undefined;
  readonly createdAt: string;
  readonly baseGraphHash: string;
  readonly baseImpactHash?: string | undefined;
  readonly mutations: readonly SingleMutation[];
  readonly expectedChanges: readonly string[];
  readonly riskLevel: ImpactRiskLevel;
  readonly validationStatus: MutationValidationStatus;
  readonly planHash: string;
}

export type InvariantKind =
  | 'FILE_EXISTS'
  | 'SYMBOL_EXISTS'
  | 'IMPORT_EXISTS'
  | 'NO_UNRELATED_FILE_MODIFIED'
  | 'NO_SECRET_TOUCHED'
  | 'NO_SYNTAX_ERROR'
  // LOT A (É53) — les éléments protégés du document existant (contrat de
  // mutation) restent présents après la mutation. Évalué réellement par
  // engine/verification.ts (présence des empreintes dans le contenu persisté).
  | 'CONTENT_PRESERVED';

export interface PostMutationInvariant {
  readonly kind: InvariantKind;
  readonly target: string;
  readonly description: string;
  readonly expectedValue?: string | undefined;
}

export interface MutationExecutionOptions {
  readonly dryRun?: boolean | undefined;
  readonly allowHighRisk?: boolean | undefined;
  readonly allowBreaking?: boolean | undefined;
  readonly skipImpactCheck?: boolean | undefined;
  readonly invariants?: readonly PostMutationInvariant[] | undefined;
  /**
   * LOT A (É53) — MUTATION CONTRACT : périmètre vérifiable de la mutation.
   * Présent, il est appliqué AVANT toute écriture (refus fail-closed si une
   * perte non autorisée est détectée) et ses `requiredInvariants` sont
   * fusionnés dans la vérification post-mutation. Voir `contract.ts`.
   */
  readonly contract?: MutationContract | undefined;
}

// ============================================================================
// 3.5 MUTATION CONTRACT (LOT A — É53)
// ============================================================================

/** Types d'éléments identifiables de façon déterministe dans un document. */
export type ContractElementKind =
  | 'section'
  | 'form'
  | 'image'
  | 'title'
  | 'heading'
  | 'button'
  | 'nav'
  | 'font';

/** Élément existant que la mutation doit préserver (présence + fidélité). */
export interface ProtectedElement {
  /** Identifiant stable : `section:<id>`, `image:<fingerprint>`, `font:<valeur>`… */
  readonly elementId: string;
  readonly kind: ContractElementKind;
  /** Libellé humain pour les refus et la future autorité de vérité (Lot B). */
  readonly label: string;
  /** `data-section="id"` pour une section, texte brut pour un bouton… */
  readonly presenceFingerprint: string;
  /** Section porteuse de l'élément (bouton, image, titre interne…), sinon undefined. */
  readonly ownerSectionId?: string | undefined;
}

/** Suppression explicitement demandée par l'utilisateur (élément identifié). */
export interface DeletionAuthorization {
  readonly elementId: string;
  readonly kind: ContractElementKind;
  readonly label: string;
  /** Extrait de la demande utilisateur qui autorise la suppression. */
  readonly evidence: string;
}

/** Nature et périmètre de l'opération demandée. */
export interface OperationScope {
  readonly kind: 'targeted-modification' | 'full-rebuild' | 'deletion' | 'creation';
  /** Cibles détectées de façon déterministe (ids de sections, kinds d'éléments). */
  readonly requestedTargets: readonly string[];
  /** Demande utilisateur tronquée (preuve d'autorisation, traçabilité Lot B). */
  readonly requestDigest: string;
  /** true uniquement si une reconstruction complète explicitement demandée. */
  readonly rebuildExplicitlyRequested: boolean;
  /** true si le document existant n'a fourni AUCUN élément identifiable. */
  readonly inventoryReliable: boolean;
}

/** Révision de référence : état initial au moment de la construction du contrat. */
export interface SourceRevisionRef {
  /** SHA-256 du contenu existant au moment de la construction du contrat. */
  readonly contentHash?: string | undefined;
  /** Identifiant de révision, quand l'appelant en dispose. */
  readonly revisionId?: string | undefined;
}

/**
 * LOT A — Contrat de mutation : ce que la mutation PEUT modifier, DOIT
 * préserver et PEUT supprimer. Typé, validable, appliqué avant toute
 * écriture par `contract.ts` (pont `/stream` + Mutation Orchestrator).
 */
export interface MutationContract {
  readonly contractVersion: '1.0.0';
  /** Fichiers autorisés à être modifiés. */
  readonly targetFiles: readonly string[];
  /** Éléments existants à préserver (non ciblés, non autorisés à la suppression). */
  readonly protectedContent: readonly ProtectedElement[];
  /** Suppressions explicitement autorisées (demande utilisateur appariée). */
  readonly allowedDeletions: readonly DeletionAuthorization[];
  /** Invariants obligatoires après mutation — uniquement des kinds réellement évalués. */
  readonly requiredInvariants: readonly PostMutationInvariant[];
  readonly sourceRevision: SourceRevisionRef;
  readonly operationScope: OperationScope;
  /**
   * LOT A — par section : tokens des éléments ciblés ou autorisés à la
   * suppression, exclus du contrôle de fidélité de cette section (l'utilisateur
   * les a autorisés à changer). Absent = aucune exemption.
   */
  readonly coverageExemptions?: Readonly<Record<string, readonly string[]>> | undefined;
}

export type ContractViolationCode =
  | 'PROTECTED_CONTENT_LOST'
  | 'TARGET_OUT_OF_SCOPE'
  | 'DELETION_NOT_AUTHORIZED'
  | 'SOURCE_REVISION_MISMATCH'
  | 'PRESERVATION_UNVERIFIABLE'
  | 'MALFORMED_CONTRACT';

/** Violation détectée : traçable et exploitable par l'autorité de vérité (Lot B). */
export interface ContractViolation {
  readonly code: ContractViolationCode;
  readonly elementId?: string | undefined;
  readonly message: string;
}

/** Verdict par élément protégé (preuve de préservation, traçabilité Lot B). */
export interface ContractElementCheck {
  readonly elementId: string;
  readonly verdict: 'preserved' | 'targeted' | 'authorized-deletion' | 'lost';
  readonly detail?: string | undefined;
}

export interface MutationContractCheck {
  readonly allowed: boolean;
  readonly violations: readonly ContractViolation[];
  readonly checks: readonly ContractElementCheck[];
}

// ============================================================================
// 4. DIFF & SNAPSHOT
// ============================================================================

export interface StructuredDiff {
  readonly filePath: string;
  readonly operation: MutationKind;
  readonly beforeContent: string | null;
  readonly afterContent: string | null;
  readonly addedLines: number;
  readonly removedLines: number;
  readonly patch?: string | undefined;
}

export interface FileSnapshotEntry {
  readonly path: string;
  readonly exists: boolean;
  readonly content?: string | undefined;
  readonly hash?: string | undefined;
}

export interface TransactionSnapshot {
  readonly snapshotId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly createdAt: string;
  readonly files: Readonly<Record<string, FileSnapshotEntry>>;
  readonly originalTreeHash: string;
}

// ============================================================================
// 5. TRANSACTION & RESULTS
// ============================================================================

export interface MutationTransaction {
  readonly transactionId: string;
  readonly planId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly status: TransactionStatus;
  readonly appliedMutations: readonly SingleMutation[];
  readonly diffs: readonly StructuredDiff[];
  readonly snapshot: TransactionSnapshot;
  readonly error?: string | undefined;
  readonly durationMs: number;
  readonly transactionHash: string;
  readonly createdAt: string;
}

export interface PlanValidationResult {
  readonly planId: string;
  readonly valid: boolean;
  readonly riskLevel: ImpactRiskLevel;
  readonly impactAnalysis?: ImpactAnalysis | undefined;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
}

export interface PostMutationRevalidation {
  readonly syntaxValid: boolean;
  readonly brokenImports: readonly string[];
  readonly brokenSymbols: readonly string[];
  readonly newGraphHash?: string | undefined;
  readonly newTreeHash?: string | undefined;
}

export interface MutationExecutionResult {
  readonly success: boolean;
  readonly dryRun: boolean;
  readonly transaction: MutationTransaction;
  readonly diffs: readonly StructuredDiff[];
  readonly resultingTreeHash?: string | undefined;
  readonly resultingGraphHash?: string | undefined;
  readonly revalidation?: PostMutationRevalidation | undefined;
}

export interface MutationRollbackResult {
  readonly transactionId: string;
  readonly success: boolean;
  readonly restoredFiles: readonly string[];
  readonly restoredTreeHash: string;
  readonly durationMs: number;
}

export interface MutationOrchestratorConfig {
  readonly maxMutationsPerPlan: number;
  readonly allowDirectRouteMutation: boolean;
  readonly requireImpactAnalysis: boolean;
  readonly cacheMaxEntries: number;
  /**
   * V7-WIRE-2 — borne LRU du registre de transactions.
   * Le registre servait auparavant de `Map` non bornée : appelé à chaque
   * génération, il fuyait la mémoire. Les transactions les plus anciennes
   * sont évincées ; un rollback explicite d'une transaction évincée échoue
   * honnêtement en NotFoundError (jamais de faux succès).
   */
  readonly transactionsMaxEntries: number;
}

// ============================================================================
// 6. ERROR HIERARCHY
// ============================================================================

export class MutationValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, requestId?: string) {
    super(message, 'VALIDATION_ERROR', 400, context, requestId);
    this.name = 'MutationValidationError';
  }
}

export class MutationPreconditionError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, requestId?: string) {
    super(message, 'BAD_REQUEST', 412, context, requestId);
    this.name = 'MutationPreconditionError';
  }
}

export class MutationConflictError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, requestId?: string) {
    super(message, 'BAD_REQUEST', 409, context, requestId);
    this.name = 'MutationConflictError';
  }
}

export class ConcurrentModificationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, requestId?: string) {
    super(message, 'BAD_REQUEST', 409, context, requestId);
    this.name = 'ConcurrentModificationError';
  }
}

export class StalePlanError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, requestId?: string) {
    super(message, 'BAD_REQUEST', 409, context, requestId);
    this.name = 'StalePlanError';
  }
}

export class StaleImpactError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, requestId?: string) {
    super(message, 'BAD_REQUEST', 409, context, requestId);
    this.name = 'StaleImpactError';
  }
}

export class MutationSecurityError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, requestId?: string) {
    super(message, 'FORBIDDEN', 403, context, requestId);
    this.name = 'MutationSecurityError';
  }
}

export class MutationPermissionError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, requestId?: string) {
    super(message, 'FORBIDDEN', 403, context, requestId);
    this.name = 'MutationPermissionError';
  }
}

export class MutationExecutionError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, requestId?: string) {
    super(message, 'INTERNAL_ERROR', 500, context, requestId);
    this.name = 'MutationExecutionError';
  }
}

export class MutationRollbackError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, requestId?: string) {
    super(message, 'INTERNAL_ERROR', 500, context, requestId);
    this.name = 'MutationRollbackError';
  }
}

export class MutationInvariantError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, requestId?: string) {
    super(message, 'INTERNAL_ERROR', 500, context, requestId);
    this.name = 'MutationInvariantError';
  }
}

// ============================================================================
// 7. LOT A (É53) — CONTRACT VIOLATION
// ============================================================================

/**
 * LOT A — violation du contrat de mutation : le refus précède TOUTE écriture
 * (aucun snapshot à annuler, aucun contenu rejeté persisté). Statut 422 :
 * le contenu généré est syntactiquement recevable mais NON AUTORISÉ.
 */
export class MutationContractViolationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, requestId?: string) {
    super(message, 'CONTRACT_VIOLATION', 422, context, requestId);
    this.name = 'MutationContractViolationError';
  }
}
