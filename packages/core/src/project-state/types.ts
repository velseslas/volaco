/**
 * VibeCode Studio - Project State & Application Status Types (CAPP-004)
 */

import type { EntityId, ProjectStatus } from '../types/index.js';
import type { WorkspaceStatus } from '../workspace/types.js';

export { ProjectStatus };

export const ALLOWED_STATUS_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  CREATED: ['ACTIVE', 'BUILDING', 'ARCHIVED'],
  ACTIVE: ['BUILDING', 'VALIDATING', 'READY', 'ERROR', 'ARCHIVED'],
  BUILDING: ['VALIDATING', 'READY', 'ERROR', 'ACTIVE'],
  VALIDATING: ['READY', 'ERROR', 'ACTIVE'],
  READY: ['ACTIVE', 'BUILDING', 'VALIDATING', 'ARCHIVED', 'ERROR'],
  ERROR: ['ACTIVE', 'BUILDING', 'CREATED', 'ARCHIVED'],
  ARCHIVED: ['ACTIVE']
};

export type ValidationStatus = 'PENDING' | 'VALIDATING' | 'VALID' | 'INVALID' | 'ERROR';

export interface ValidationChecks {
  build: boolean;
  typecheck: boolean;
  lint: boolean;
  tests: boolean;
  security: boolean;
}

export interface ValidationReport {
  status: ValidationStatus;
  checks: ValidationChecks;
  errors: string[];
  warnings: string[];
  validatedAt: Date;
}

export interface RecentActivityItem {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  timestamp: Date;
  userId: string;
  status: 'SUCCESS' | 'FAILURE';
  metadata?: Record<string, unknown> | undefined;
}

export interface ProjectStateSummary {
  tenantId: EntityId;
  projectId: EntityId;
  name: string;
  description?: string | undefined;
  status: ProjectStatus;
  currentRevision: {
    id?: string | undefined;
    revisionNumber: number;
    author?: string | undefined;
    message?: string | undefined;
    treeHash?: string | undefined;
    createdAt?: Date | undefined;
  };
  workspace: {
    status: WorkspaceStatus;
    isDirty: boolean;
    activeFile?: string | undefined;
    openFilesCount: number;
    lastSyncedAt: Date;
  };
  validation: ValidationReport;
  recentActivity: RecentActivityItem[];
  updatedAt: Date;
}

export interface UpdateStatusInput {
  status: ProjectStatus;
  reason?: string | undefined;
}

export interface ValidateProjectInput {
  checks?: Partial<ValidationChecks> | undefined;
}
