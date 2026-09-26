/**
 * VibeCode Studio - Project Settings Types (CORE-006)
 */

import type { EntityId } from '../types/index.js';

export interface ProjectStack {
  framework: string;
  buildTool: string;
  nodeVersion: string;
}

export interface ProjectSettings {
  projectId: EntityId;
  tenantId: EntityId;
  stack: ProjectStack;
  envVars: Record<string, string>;
  tags: string[];
  updatedAt: Date;
}

export interface UpdateProjectSettingsInput {
  stack?: Partial<ProjectStack> | undefined;
  envVars?: Record<string, string> | undefined;
  tags?: string[] | undefined;
}
