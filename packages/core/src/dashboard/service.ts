/**
 * VibeCode Studio - Project Dashboard Service (CORE-002)
 */

import type { EntityId, Project } from '../types/index.js';
import type { Role } from '../identity/permissions.js';
import { assertPermission } from '../identity/permissions.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { ProjectStore } from '../identity/project.js';
import { AuditStore } from '../observability/audit.js';
import type { DashboardSummary, ProjectCard, CreateProjectInput } from './types.js';

export class DashboardService {
  constructor(
    private projectStore: ProjectStore,
    private auditStore?: AuditStore
  ) {}

  public getDashboardSummary(
    tenantId: string,
    activeProjectId?: string,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): DashboardSummary {
    if (!tenantId) {
      throw new ValidationError('Le tenantId est obligatoire', { field: 'tenantId' }, requestId);
    }

    assertPermission(userRole, 'PROJECT_READ', requestId);

    const rawProjects = this.projectStore.listProjects(tenantId);

    // Trier par date de mise à jour descendante
    const sortedProjects = [...rawProjects].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    const projectCards: ProjectCard[] = sortedProjects.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      isCurrent: p.id === activeProjectId
    }));

    const firstProject = sortedProjects[0];
    const lastActivityAt = firstProject ? firstProject.updatedAt : undefined;

    return {
      tenantId,
      totalProjects: projectCards.length,
      activeProjectId,
      lastActivityAt,
      projects: projectCards
    };
  }

  public createProject(
    tenantId: string,
    input: CreateProjectInput,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): Project {
    if (!tenantId) {
      throw new ValidationError('Le tenantId est obligatoire', { field: 'tenantId' }, requestId);
    }
    if (!input || !input.name || input.name.trim().length === 0) {
      throw new ValidationError('Le nom du projet est obligatoire', { field: 'name' }, requestId);
    }

    assertPermission(userRole, 'PROJECT_CREATE', requestId);

    const project = this.projectStore.createProject(tenantId, input.name.trim(), input.description?.trim());

    if (this.auditStore && requestId) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'PROJECT_CREATE',
        resourceType: 'project',
        resourceId: project.id,
        status: 'SUCCESS',
        metadata: {
          name: project.name,
          description: project.description
        },
        requestId
      });
    }

    return project;
  }

  public deleteProject(
    tenantId: string,
    projectId: string,
    userRole: Role = 'ADMIN',
    requestId?: string
  ): boolean {
    if (!tenantId) {
      throw new ValidationError('Le tenantId est obligatoire', { field: 'tenantId' }, requestId);
    }
    if (!projectId) {
      throw new ValidationError('Le projectId est obligatoire', { field: 'projectId' }, requestId);
    }

    assertPermission(userRole, 'PROJECT_DELETE', requestId);

    const existing = this.projectStore.getProject(tenantId, projectId);
    if (!existing) {
      throw new NotFoundError(`Projet ${projectId} introuvable pour le tenant ${tenantId}`, requestId);
    }

    const deleted = this.projectStore.deleteProject(tenantId, projectId);

    if (deleted && this.auditStore && requestId) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'PROJECT_DELETE',
        resourceType: 'project',
        resourceId: projectId,
        status: 'SUCCESS',
        metadata: {
          deletedProjectName: existing.name
        },
        requestId
      });
    }

    return deleted;
  }
}
