/**
 * VibeCode Studio - Project Dashboard Types (CORE-002)
 */

import type { EntityId, Project } from '../types/index.js';

export interface ProjectCard {
  id: EntityId;
  name: string;
  description?: string | undefined;
  createdAt: Date;
  updatedAt: Date;
  revisionsCount?: number | undefined;
  isCurrent?: boolean | undefined;
}

export interface DashboardSummary {
  tenantId: EntityId;
  totalProjects: number;
  activeProjectId?: EntityId | undefined;
  lastActivityAt?: Date | undefined;
  projects: ProjectCard[];
}

export interface CreateProjectInput {
  name: string;
  description?: string | undefined;
}
