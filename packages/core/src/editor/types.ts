/**
 * VibeCode Studio - Code Editor Types (CORE-004)
 */

import type { EntityId } from '../types/index.js';

export interface SaveFileInput {
  path: string;
  content: string;
}

export interface SaveFileResult {
  tenantId: EntityId;
  projectId: EntityId;
  path: string;
  sizeBytes: number;
  sha256: string;
  savedAt: Date;
  workspaceSynced: boolean;
}

export interface FileDraftStatus {
  path: string;
  isDirty: boolean;
  lastSavedAt?: Date | undefined;
}
