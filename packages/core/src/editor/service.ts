/**
 * VibeCode Studio - Code Editor Service (CORE-004)
 */

import { logger } from '../logger.js';
import { createHash } from 'node:crypto';
import type { Role } from '../identity/permissions.js';
import { assertPermission } from '../identity/permissions.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { ProjectStore } from '../identity/project.js';
import { AuditStore } from '../observability/audit.js';
import { FileStore } from '../file-explorer/store.js';
import { WorkspaceService } from '../workspace/service.js';
import type { SaveFileInput, SaveFileResult } from './types.js';

export class EditorService {
  constructor(
    private projectStore: ProjectStore,
    private fileStore: FileStore,
    private workspaceService?: WorkspaceService,
    private auditStore?: AuditStore
  ) {}

  public computeSha256(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  public saveFile(
    tenantId: string,
    projectId: string,
    input: SaveFileInput,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): SaveFileResult {
    if (!tenantId) {
      throw new ValidationError('Le tenantId est obligatoire', { field: 'tenantId' }, requestId);
    }
    if (!projectId) {
      throw new ValidationError('Le projectId est obligatoire', { field: 'projectId' }, requestId);
    }
    if (!input || !input.path) {
      throw new ValidationError('Le chemin du fichier est obligatoire', { field: 'path' }, requestId);
    }
    if (typeof input.content !== 'string') {
      throw new ValidationError('Le contenu du fichier est obligatoire et doit être une chaîne', { field: 'content' }, requestId);
    }

    // 1. Vérification d'accès projet et permissions RBAC
    const project = this.projectStore.getProject(tenantId, projectId);
    if (!project) {
      throw new NotFoundError(`Projet ${projectId} introuvable pour le tenant ${tenantId}`, requestId);
    }
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    // 2. Persistance dans le FileStore
    const saved = this.fileStore.saveFile(tenantId, projectId, input.path, input.content);
    const sha256 = this.computeSha256(input.content);

    // 3. Synchronisation éventuelle avec l'état actif du Workspace
    let workspaceSynced = false;
    if (this.workspaceService) {
      try {
        this.workspaceService.updateWorkspaceState(
          tenantId,
          projectId,
          {
            activeFile: saved.path,
            isDirty: false
          },
          userRole,
          requestId
        );
        workspaceSynced = true;
      } catch (err) {
        logger.warn('Synchronisation workspace échouée — sauvegarde quand même effectuée', {
          component: 'editor-service',
          projectId,
          err: err instanceof Error ? err.message : String(err)
        });
      }
    }

    // 4. Audit de sauvegarde
    if (this.auditStore && requestId) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'FILE_SAVE',
        resourceType: 'file',
        resourceId: `${projectId}:${saved.path}`,
        status: 'SUCCESS',
        metadata: {
          path: saved.path,
          sizeBytes: saved.sizeBytes,
          sha256
        },
        requestId
      });
    }

    return {
      tenantId,
      projectId,
      path: saved.path,
      sizeBytes: saved.sizeBytes,
      sha256,
      savedAt: saved.updatedAt,
      workspaceSynced
    };
  }
}
