/**
 * VibeCode Studio - Project State Service (CAPP-004)
 */

import type { Role } from '../identity/permissions.js';
import { assertPermission } from '../identity/permissions.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { ProjectStore } from '../identity/project.js';
import { RevisionStore } from '../model/revision-store.js';
import { WorkspaceService } from '../workspace/service.js';
import { AuditStore } from '../observability/audit.js';
import { FileStore } from '../file-explorer/store.js';
import type { WorkspaceStatus } from '../workspace/types.js';
import { ProjectStateStore } from './store.js';
import {
  ALLOWED_STATUS_TRANSITIONS,
  type ProjectStateSummary,
  type ProjectStatus,
  type RecentActivityItem,
  type UpdateStatusInput,
  type ValidateProjectInput,
  type ValidationChecks,
  type ValidationReport
} from './types.js';

export class ProjectStateService {
  constructor(
    private projectStore: ProjectStore,
    private stateStore: ProjectStateStore,
    private revisionStore?: RevisionStore,
    private workspaceService?: WorkspaceService,
    private auditStore?: AuditStore,
    private fileStore?: FileStore
  ) {}

  private assertProject(tenantId: string, projectId: string, requestId?: string) {
    if (!tenantId) {
      throw new ValidationError('Le tenantId est obligatoire', { field: 'tenantId' }, requestId);
    }
    if (!projectId) {
      throw new ValidationError('Le projectId est obligatoire', { field: 'projectId' }, requestId);
    }
    const project = this.projectStore.getProject(tenantId, projectId);
    if (!project) {
      throw new NotFoundError(`Projet ${projectId} introuvable pour le tenant ${tenantId}`, requestId);
    }
    return project;
  }

  public getProjectState(
    tenantId: string,
    projectId: string,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): ProjectStateSummary {
    const project = this.assertProject(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const status: ProjectStatus = project.status ?? 'CREATED';

    let currentRevision = {
      id: undefined as string | undefined,
      revisionNumber: 0,
      author: undefined as string | undefined,
      message: undefined as string | undefined,
      treeHash: undefined as string | undefined,
      createdAt: undefined as Date | undefined
    };

    if (this.revisionStore) {
      const revs = this.revisionStore.listRevisions(tenantId, projectId);
      if (revs.length > 0) {
        const latest = revs[revs.length - 1]!;
        currentRevision = {
          id: latest.id,
          revisionNumber: latest.revisionNumber,
          author: latest.author,
          message: latest.message,
          treeHash: latest.parentRevisionId || undefined,
          createdAt: latest.createdAt
        };
      }
    }

    if (this.fileStore) {
      currentRevision.treeHash = this.fileStore.computeTreeHash(tenantId, projectId);
    }

    let workspaceState = {
      status: 'READY' as WorkspaceStatus,
      isDirty: false,
      activeFile: undefined as string | undefined,
      openFilesCount: 0,
      lastSyncedAt: project.updatedAt
    };

    if (this.workspaceService) {
      const session = this.workspaceService.getWorkspace(tenantId, projectId, userRole, requestId);
      workspaceState = {
        status: session.status,
        isDirty: session.state.isDirty,
        activeFile: session.state.activeFile,
        openFilesCount: session.state.openFiles.length,
        lastSyncedAt: session.lastSyncedAt
      };
    }

    const validation = this.stateStore.getValidationReport(tenantId, projectId);
    const recentActivity = this.getRecentActivity(tenantId, projectId, 10, userRole, requestId);

    return {
      tenantId,
      projectId,
      name: project.name,
      description: project.description,
      status,
      currentRevision,
      workspace: workspaceState,
      validation,
      recentActivity,
      updatedAt: project.updatedAt
    };
  }

  public updateProjectStatus(
    tenantId: string,
    projectId: string,
    input: UpdateStatusInput,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): ProjectStateSummary {
    const project = this.assertProject(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    if (!input || !input.status) {
      throw new ValidationError('Le nouveau statut est obligatoire', { field: 'status' }, requestId);
    }

    const currentStatus: ProjectStatus = project.status ?? 'CREATED';
    const targetStatus = input.status;

    if (currentStatus === targetStatus) {
      return this.getProjectState(tenantId, projectId, userRole, requestId);
    }

    const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(targetStatus)) {
      throw new ValidationError(
        `Transition d'état invalide : impossible de passer de "${currentStatus}" à "${targetStatus}"`,
        { currentStatus, targetStatus, allowedTransitions: allowed },
        requestId
      );
    }

    this.projectStore.updateStatus(tenantId, projectId, targetStatus);

    if (this.auditStore && requestId) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'PROJECT_STATUS_UPDATE',
        resourceType: 'project',
        resourceId: projectId,
        status: 'SUCCESS',
        metadata: {
          previousStatus: currentStatus,
          newStatus: targetStatus,
          reason: input.reason
        },
        requestId
      });
    }

    return this.getProjectState(tenantId, projectId, userRole, requestId);
  }

  public runProjectValidation(
    tenantId: string,
    projectId: string,
    input?: ValidateProjectInput,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): ValidationReport {
    this.assertProject(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    const currentProj = this.projectStore.getProject(tenantId, projectId)!;
    const prevStatus = currentProj.status ?? 'CREATED';
    if (['ACTIVE', 'BUILDING', 'READY'].includes(prevStatus)) {
      this.projectStore.updateStatus(tenantId, projectId, 'VALIDATING');
    }

    const defaultChecks: ValidationChecks = {
      build: true,
      typecheck: true,
      lint: true,
      tests: true,
      security: true
    };

    const checks: ValidationChecks = {
      ...defaultChecks,
      ...(input?.checks || {})
    };

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!checks.build) errors.push('Échec de la vérification de compilation (build)');
    if (!checks.typecheck) errors.push('Diagnostics TypeScript stricts en erreur (typecheck)');
    if (!checks.lint) warnings.push('Avertissements de style détectés (lint)');
    if (!checks.tests) errors.push('Tests automatisés en échec (tests)');
    if (!checks.security) errors.push('Vulnérabilités de sécurité ou path traversal détectées (security)');

    const passed = errors.length === 0;
    const finalStatus = passed ? 'VALID' : 'INVALID';

    const report: ValidationReport = {
      status: finalStatus,
      checks,
      errors,
      warnings,
      validatedAt: new Date()
    };

    this.stateStore.saveValidationReport(tenantId, projectId, report);

    const nextProjectStatus: ProjectStatus = passed ? 'READY' : 'ERROR';
    this.projectStore.updateStatus(tenantId, projectId, nextProjectStatus);

    if (this.auditStore && requestId) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'PROJECT_VALIDATION',
        resourceType: 'project',
        resourceId: projectId,
        status: passed ? 'SUCCESS' : 'FAILURE',
        metadata: {
          validationStatus: finalStatus,
          projectStatus: nextProjectStatus,
          checks,
          errorsCount: errors.length
        },
        requestId
      });
    }

    return report;
  }

  public getRecentActivity(
    tenantId: string,
    projectId: string,
    limit: number = 20,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): RecentActivityItem[] {
    this.assertProject(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_READ', requestId);

    if (!this.auditStore) {
      return [];
    }

    const events = this.auditStore.query(tenantId);
    const projectEvents = events.filter(e => {
      if (e.resourceId === projectId || e.resourceId.startsWith(`${projectId}:`)) {
        return true;
      }
      return false;
    });

    projectEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return projectEvents.slice(0, limit).map(e => ({
      id: e.id,
      action: e.action,
      resourceType: e.resourceType,
      resourceId: e.resourceId,
      timestamp: e.timestamp,
      userId: e.userId,
      status: e.status,
      metadata: e.metadata
    }));
  }
}
