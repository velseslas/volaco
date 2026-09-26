/**
 * VibeCode Studio - Studio Shell Service (CAPP-005)
 */

import type { Role } from '../identity/permissions.js';
import { assertPermission } from '../identity/permissions.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { ProjectStore } from '../identity/project.js';
import { FileExplorerService } from '../file-explorer/service.js';
import { WorkspaceService } from '../workspace/service.js';
import { ProjectStateService } from '../project-state/service.js';
import { renderStudioShellHtml } from './renderer.js';
import type { StudioShellLayout, StudioShellViewModel } from './types.js';

export class StudioShellService {
  constructor(
    private projectStore: ProjectStore,
    private projectStateService: ProjectStateService,
    private fileExplorerService: FileExplorerService,
    private workspaceService: WorkspaceService
  ) {}

  public getShellLayout(): StudioShellLayout {
    return {
      title: 'VibeCode Studio',
      panels: {
        fileTree: { visible: true, widthPercent: 20, title: 'FILE TREE' },
        workspace: { visible: true, widthPercent: 55, title: 'WORKSPACE' },
        projectInfo: { visible: true, widthPercent: 25, title: 'PROJECT INFO' },
        statusEvents: { visible: true, heightPercent: 18, title: 'STATUS / EVENTS' }
      }
    };
  }

  public getShellViewModel(
    tenantId: string,
    projectId: string,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): StudioShellViewModel {
    if (!tenantId) {
      throw new ValidationError('Le tenantId est obligatoire pour charger le Studio Shell', { field: 'tenantId' }, requestId);
    }
    if (!projectId) {
      throw new ValidationError('Le projectId est obligatoire pour charger le Studio Shell', { field: 'projectId' }, requestId);
    }

    assertPermission(userRole, 'PROJECT_READ', requestId);

    const project = this.projectStore.getProject(tenantId, projectId);
    if (!project) {
      throw new NotFoundError(`Projet ${projectId} introuvable pour le tenant ${tenantId}`, requestId);
    }

    const projectState = this.projectStateService.getProjectState(tenantId, projectId, userRole, requestId);
    const files = this.fileExplorerService.getFilesSummary(tenantId, projectId, userRole, requestId);
    const workspace = this.workspaceService.getWorkspace(tenantId, projectId, userRole, requestId);
    const layout = this.getShellLayout();

    return {
      tenantId,
      projectId,
      userRole,
      project: projectState,
      files,
      workspace,
      layout,
      serverTime: new Date()
    };
  }

  public renderShellHtml(
    tenantId: string,
    projectId: string,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): string {
    const viewModel = this.getShellViewModel(tenantId, projectId, userRole, requestId);
    return renderStudioShellHtml(viewModel);
  }
}
