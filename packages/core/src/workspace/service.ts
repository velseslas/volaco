/**
 * VibeCode Studio - Workspace Service (CORE-001)
 */

import type { EntityId } from '../types/index.js';
import type { Role } from '../identity/permissions.js';
import { assertPermission } from '../identity/permissions.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { ProjectStore } from '../identity/project.js';
import { AuditStore } from '../observability/audit.js';
import { FileStore } from '../file-explorer/store.js';
import { RevisionStore } from '../model/revision-store.js';
import type { WorkspaceSession, WorkspaceState, UpdateWorkspaceStateInput, ProjectSummary } from './types.js';

export class WorkspaceService {
  private sessions = new Map<EntityId, WorkspaceSession>();

  constructor(
    private projectStore: ProjectStore,
    private auditStore?: AuditStore,
    private fileStore?: FileStore,
    private revisionStore?: RevisionStore
  ) {}

  private getProjectFiles(tenantId: string, projectId: string): string[] {
    if (!this.fileStore) {
      return ['index.html'];
    }
    const nodes = this.fileStore.getTree(tenantId, projectId);
    const paths: string[] = [];
    const traverse = (list: typeof nodes) => {
      for (const n of list) {
        if (n.type === 'file') paths.push(n.path);
        if (n.children && n.children.length > 0) traverse(n.children);
      }
    };
    traverse(nodes);
    return paths.length > 0 ? paths : ['index.html'];
  }

  private getLatestRevision(tenantId: string, projectId: string) {
    if (!this.revisionStore) return null;
    const revs = this.revisionStore.listRevisions(tenantId, projectId);
    return revs.length > 0 ? (revs[revs.length - 1] ?? null) : null;
  }

  public getProjectSummary(
    tenantId: string,
    projectId: string,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): ProjectSummary {
    if (!tenantId) {
      throw new ValidationError('Le tenantId est obligatoire', { field: 'tenantId' }, requestId);
    }
    if (!projectId) {
      throw new ValidationError('Le projectId est obligatoire', { field: 'projectId' }, requestId);
    }

    assertPermission(userRole, 'PROJECT_READ', requestId);

    const project = this.projectStore.getProject(tenantId, projectId);
    if (!project) {
      throw new NotFoundError(`Projet ${projectId} pour le tenant ${tenantId}`, requestId);
    }

    const session = this.sessions.get(projectId);
    const files = this.getProjectFiles(tenantId, projectId);
    const latestRev = this.getLatestRevision(tenantId, projectId);

    const summary: ProjectSummary = {
      projectId,
      tenantId,
      name: project.name,
      description: project.description,
      status: session?.status || 'READY',
      currentRevisionId: latestRev?.id,
      revisionNumber: latestRev?.revisionNumber ?? 0,
      filesCount: files.length,
      files,
      lastActivityAt: latestRev?.createdAt || project.updatedAt || new Date()
    };

    if (this.auditStore && requestId) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'WORKSPACE_SUMMARY',
        resourceType: 'workspace',
        resourceId: projectId,
        status: 'SUCCESS',
        requestId
      });
    }

    return summary;
  }

  public getWorkspace(
    tenantId: string,
    projectId: string,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): WorkspaceSession {
    if (!tenantId) {
      throw new ValidationError('Le tenantId est obligatoire', { field: 'tenantId' }, requestId);
    }
    if (!projectId) {
      throw new ValidationError('Le projectId est obligatoire', { field: 'projectId' }, requestId);
    }

    assertPermission(userRole, 'PROJECT_READ', requestId);

    const project = this.projectStore.getProject(tenantId, projectId);
    if (!project) {
      throw new NotFoundError(`Projet ${projectId} pour le tenant ${tenantId}`, requestId);
    }

    const summary = this.getProjectSummary(tenantId, projectId, userRole, requestId);

    let session = this.sessions.get(projectId);
    if (!session || session.tenantId !== tenantId) {
      const defaultState: WorkspaceState = {
        activeFile: 'index.html',
        openFiles: ['index.html'],
        activeSubTab: 'preview',
        isDirty: false
      };

      session = {
        projectId,
        tenantId,
        project,
        status: 'READY',
        state: defaultState,
        currentRevisionId: summary.currentRevisionId,
        revisionNumber: summary.revisionNumber,
        files: summary.files,
        summary,
        lastSyncedAt: new Date()
      };
      this.sessions.set(projectId, session);
    } else {
      session.project = project;
      session.status = 'READY';
      session.currentRevisionId = summary.currentRevisionId;
      session.revisionNumber = summary.revisionNumber;
      session.files = summary.files;
      session.summary = summary;
    }

    if (this.auditStore && requestId) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'WORKSPACE_LOAD',
        resourceType: 'workspace',
        resourceId: projectId,
        status: 'SUCCESS',
        requestId
      });
    }

    return session;
  }

  public updateWorkspaceState(
    tenantId: string,
    projectId: string,
    input: UpdateWorkspaceStateInput,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): WorkspaceSession {
    if (!tenantId) {
      throw new ValidationError('Le tenantId est obligatoire', { field: 'tenantId' }, requestId);
    }
    if (!projectId) {
      throw new ValidationError('Le projectId est obligatoire', { field: 'projectId' }, requestId);
    }

    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    const session = this.getWorkspace(tenantId, projectId, userRole, requestId);

    const updatedState: WorkspaceState = {
      activeFile: input.activeFile !== undefined ? input.activeFile : session.state.activeFile,
      openFiles: input.openFiles !== undefined ? input.openFiles : session.state.openFiles,
      activeSubTab: input.activeSubTab !== undefined ? input.activeSubTab : session.state.activeSubTab,
      cursorPosition: input.cursorPosition !== undefined ? input.cursorPosition : session.state.cursorPosition,
      previewUrl: input.previewUrl !== undefined ? input.previewUrl : session.state.previewUrl,
      isDirty: input.isDirty !== undefined ? input.isDirty : session.state.isDirty,
      metadata: input.metadata !== undefined ? input.metadata : session.state.metadata
    };

    session.state = updatedState;
    session.status = 'READY';
    session.lastSyncedAt = new Date();

    if (this.auditStore && requestId) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'WORKSPACE_SAVE',
        resourceType: 'workspace',
        resourceId: projectId,
        status: 'SUCCESS',
        metadata: {
          activeFile: updatedState.activeFile,
          activeSubTab: updatedState.activeSubTab,
          isDirty: updatedState.isDirty
        },
        requestId
      });
    }

    return session;
  }

  public closeWorkspace(projectId: string): boolean {
    return this.sessions.delete(projectId);
  }
}
