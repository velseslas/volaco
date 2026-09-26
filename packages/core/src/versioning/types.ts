/**
 * VibeCode Studio - Versioning & Revisions Types (CORE-007)
 */

export type {
  ApplicationRevision,
  FileArtifact,
  TechnicalDecision,
  ModificationProvenance
} from '../model/revision.js';

export interface CreateSnapshotInput {
  message: string;
  author?: string | undefined;
  provenance?: {
    source: 'USER' | 'AI_AGENT' | 'SYSTEM_REPAIR';
    prompt?: string | undefined;
  } | undefined;
}

export interface RollbackResult {
  success: boolean;
  restoredFromRevisionId: string;
  newRevision: import('../model/revision.js').ApplicationRevision;
  filesRestoredCount: number;
}
