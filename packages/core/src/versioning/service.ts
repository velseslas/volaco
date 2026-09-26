/**
 * VibeCode Studio - Versioning Service (CORE-007)
 */

import type { Role } from '../identity/permissions.js';
import { assertPermission } from '../identity/permissions.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { ProjectStore } from '../identity/project.js';
import { AuditStore } from '../observability/audit.js';
import { RevisionStore } from '../model/revision-store.js';
import type { ApplicationRevision } from '../model/revision.js';
import { FileStore } from '../file-explorer/store.js';
import type { FileNode } from '../file-explorer/types.js';
import { WorkspaceService } from '../workspace/service.js';
import type { CreateSnapshotInput, RollbackResult } from './types.js';

export class VersioningService {
  constructor(
    private projectStore: ProjectStore,
    private revisionStore: RevisionStore,
    private fileStore: FileStore,
    private workspaceService?: WorkspaceService,
    private auditStore?: AuditStore
  ) {}

  private assertProjectAccess(tenantId: string, projectId: string, requestId?: string): void {
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
  }

  public createSnapshotFromProject(
    tenantId: string,
    projectId: string,
    input: CreateSnapshotInput,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): ApplicationRevision {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    if (!input || !input.message || input.message.trim().length === 0) {
      throw new ValidationError('Le message de révision est obligatoire', { field: 'message' }, requestId);
    }

    // 1. Extraire tous les fichiers actuels du projet depuis le FileStore
    const tree = this.fileStore.getTree(tenantId, projectId);
    const filesMap: Record<string, string> = {};

    const collectFiles = (nodes: FileNode[]) => {
      for (const node of nodes) {
        if (node.type === 'file') {
          const file = this.fileStore.getFile(tenantId, projectId, node.path);
          if (file) {
            filesMap[node.path] = file.content;
          }
        } else if (node.children) {
          collectFiles(node.children);
        }
      }
    };

    collectFiles(tree);

    // 2. Créer la révision dans le RevisionStore
    const revision = this.revisionStore.createRevision(tenantId, projectId, {
      message: input.message.trim(),
      author: input.author || 'engineer',
      files: filesMap,
      provenance: {
        source: input.provenance?.source || 'USER',
        prompt: input.provenance?.prompt,
        triggerRequestId: requestId
      }
    });

    // 3. Audit
    if (this.auditStore) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'REVISION_CREATE',
        resourceType: 'revision',
        resourceId: revision.id,
        status: 'SUCCESS',
        metadata: {
          revisionNumber: revision.revisionNumber,
          filesCount: Object.keys(filesMap).length,
          message: revision.message
        },
        requestId: requestId ?? 'req_rev_auto'
      });
    }

    return revision;
  }

  public listRevisions(
    tenantId: string,
    projectId: string,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): ApplicationRevision[] {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_READ', requestId);

    return this.revisionStore.listRevisions(tenantId, projectId);
  }

  public getRevision(
    tenantId: string,
    projectId: string,
    revisionId: string,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): ApplicationRevision {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const rev = this.revisionStore.getRevision(tenantId, projectId, revisionId);
    if (!rev) {
      throw new NotFoundError(`Révision ${revisionId} introuvable pour le projet ${projectId}`, requestId);
    }
    return rev;
  }

  public rollbackToRevision(
    tenantId: string,
    projectId: string,
    targetRevisionId: string,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): RollbackResult {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    const targetRev = this.revisionStore.getRevision(tenantId, projectId, targetRevisionId);
    if (!targetRev) {
      throw new NotFoundError(`Révision cible ${targetRevisionId} introuvable`, requestId);
    }

    // 1. Exécuter le rollback dans le modèle de révisions
    const newRevision = this.revisionStore.rollbackTo(
      tenantId,
      projectId,
      targetRevisionId,
      'engineer',
      requestId
    );

    // 2. Restaurer physiquement chaque fichier dans le FileStore
    let restoredCount = 0;
    for (const [path, artifact] of Object.entries(targetRev.files)) {
      this.fileStore.saveFile(tenantId, projectId, path, artifact.content);
      restoredCount++;
    }

    // 3. Synchroniser la session active de Workspace si attachée
    if (this.workspaceService) {
      try {
        this.workspaceService.updateWorkspaceState(
          tenantId,
          projectId,
          {
            activeFile: Object.keys(targetRev.files)[0] || 'index.html',
            isDirty: false
          },
          userRole,
          requestId
        );
      } catch {
        // Continue sans bloquer
      }
    }

    // 4. Audit
    if (this.auditStore) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'ROLLBACK_TRIGGERED',
        resourceType: 'revision',
        resourceId: newRevision.id,
        status: 'SUCCESS',
        metadata: {
          restoredFromRevisionId: targetRevisionId,
          newRevisionNumber: newRevision.revisionNumber,
          restoredCount
        },
        requestId: requestId ?? 'req_rollback_auto'
      });
    }

    return {
      success: true,
      restoredFromRevisionId: targetRevisionId,
      newRevision,
      filesRestoredCount: restoredCount
    };
  }
}
