/**
 * VibeCode Studio - Workspace Type Definitions (CORE-001)
 */

import type { EntityId, Project } from '../types/index.js';

export type WorkspaceStatus = 'IDLE' | 'LOADING' | 'READY' | 'SAVING' | 'ERROR';

export type ActiveSubTab = 'preview' | 'code' | 'terminal' | 'settings';

export interface WorkspaceState {
  activeFile: string;
  openFiles: string[];
  activeSubTab: ActiveSubTab;
  cursorPosition?: { line: number; column: number } | undefined;
  previewUrl?: string | undefined;
  isDirty: boolean;
  metadata?: Record<string, unknown> | undefined;
}

export interface ProjectSummary {
  projectId: EntityId;
  tenantId: EntityId;
  name: string;
  description?: string | undefined;
  status: WorkspaceStatus;
  currentRevisionId?: string | undefined;
  revisionNumber: number;
  filesCount: number;
  files: string[];
  lastActivityAt: Date;
}

export interface WorkspaceSession {
  projectId: EntityId;
  tenantId: EntityId;
  project: Project;
  status: WorkspaceStatus;
  state: WorkspaceState;
  currentRevisionId?: string | undefined;
  revisionNumber: number;
  files: string[];
  summary: ProjectSummary;
  lastSyncedAt: Date;
  error?: string | undefined;
}

export interface UpdateWorkspaceStateInput {
  activeFile?: string | undefined;
  openFiles?: string[] | undefined;
  activeSubTab?: ActiveSubTab | undefined;
  cursorPosition?: { line: number; column: number } | undefined;
  previewUrl?: string | undefined;
  isDirty?: boolean | undefined;
  metadata?: Record<string, unknown> | undefined;
}
