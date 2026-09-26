/**
 * VibeCode Studio - File Explorer Service (CORE-003)
 */

import type { Role } from '../identity/permissions.js';
import { assertPermission } from '../identity/permissions.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { ProjectStore } from '../identity/project.js';
import { AuditStore } from '../observability/audit.js';
import { FileStore } from './store.js';
import { RevisionStore } from '../model/revision-store.js';
import type { ApplicationRevision, ModificationProvenance } from '../model/revision.js';
import type {
  CreateFileInput,
  FileContent,
  FileNode,
  FileOperation,
  FileOperationResult,
  MoveFileInput,
  ProjectFilesSummary,
  RenameFileInput
} from './types.js';

export class FileExplorerService {
  constructor(
    private projectStore: ProjectStore,
    private fileStore: FileStore,
    private auditStore?: AuditStore,
    private revisionStore?: RevisionStore
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

  public getFilesSummary(
    tenantId: string,
    projectId: string,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): ProjectFilesSummary {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const tree = this.fileStore.getTree(tenantId, projectId);

    let totalFiles = 0;
    let totalDirectories = 0;

    const countNodes = (nodes: FileNode[]) => {
      for (const node of nodes) {
        if (node.type === 'file') {
          totalFiles++;
        } else if (node.type === 'directory') {
          totalDirectories++;
          if (node.children) {
            countNodes(node.children);
          }
        }
      }
    };

    countNodes(tree);

    const treeHash = this.fileStore.computeTreeHash(tenantId, projectId);
    let currentRevisionId: string | undefined;
    let revisionNumber: number | undefined;

    if (this.revisionStore) {
      const revs = this.revisionStore.listRevisions(tenantId, projectId);
      if (revs.length > 0) {
        const latest = revs[revs.length - 1];
        currentRevisionId = latest?.id;
        revisionNumber = latest?.revisionNumber;
      }
    }

    return {
      tenantId,
      projectId,
      totalFiles,
      totalDirectories,
      treeHash,
      currentRevisionId,
      revisionNumber,
      tree
    };
  }

  public getFileContent(
    tenantId: string,
    projectId: string,
    filePath: string,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): FileContent {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const file = this.fileStore.getFile(tenantId, projectId, filePath);
    if (!file) {
      throw new NotFoundError(`Fichier "${filePath}" introuvable dans le projet ${projectId}`, requestId);
    }

    return file;
  }

  public createFile(
    tenantId: string,
    projectId: string,
    input: CreateFileInput,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): FileNode {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    if (!input || !input.path) {
      throw new ValidationError('Le chemin du fichier est obligatoire', { field: 'path' }, requestId);
    }

    const created = this.fileStore.createNode(
      tenantId,
      projectId,
      input.path,
      input.type,
      input.content
    );

    if (this.auditStore && requestId) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'FILE_CREATE',
        resourceType: 'file',
        resourceId: `${projectId}:${created.path}`,
        status: 'SUCCESS',
        metadata: {
          path: created.path,
          type: created.type,
          sizeBytes: created.sizeBytes
        },
        requestId
      });
    }

    return created;
  }

  public deleteFile(
    tenantId: string,
    projectId: string,
    filePath: string,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): boolean {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    if (!filePath) {
      throw new ValidationError('Le chemin du fichier à supprimer est obligatoire', { field: 'filePath' }, requestId);
    }

    const deleted = this.fileStore.deleteNode(tenantId, projectId, filePath);
    if (!deleted) {
      throw new NotFoundError(`Élément "${filePath}" introuvable pour la suppression`, requestId);
    }

    if (this.auditStore && requestId) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'FILE_DELETE',
        resourceType: 'file',
        resourceId: `${projectId}:${filePath}`,
        status: 'SUCCESS',
        metadata: {
          path: filePath
        },
        requestId
      });
    }

    return deleted;
  }

  public renameFile(
    tenantId: string,
    projectId: string,
    input: RenameFileInput,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): FileNode {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    if (!input || !input.oldPath || !input.newPath) {
      throw new ValidationError('Les chemins source et destination sont obligatoires', undefined, requestId);
    }

    const renamed = this.fileStore.renameNode(
      tenantId,
      projectId,
      input.oldPath,
      input.newPath
    );

    if (this.auditStore && requestId) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'FILE_RENAME',
        resourceType: 'file',
        resourceId: `${projectId}:${renamed.path}`,
        status: 'SUCCESS',
        metadata: {
          oldPath: input.oldPath,
          newPath: input.newPath
        },
        requestId
      });
    }

    return renamed;
  }

  public moveFile(
    tenantId: string,
    projectId: string,
    input: MoveFileInput,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): FileNode {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    if (!input || !input.oldPath || !input.newPath) {
      throw new ValidationError('Les chemins source et destination sont obligatoires', undefined, requestId);
    }

    const moved = this.fileStore.moveNode(
      tenantId,
      projectId,
      input.oldPath,
      input.newPath
    );

    if (this.auditStore && requestId) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'FILE_MOVE',
        resourceType: 'file',
        resourceId: `${projectId}:${moved.path}`,
        status: 'SUCCESS',
        metadata: {
          oldPath: input.oldPath,
          newPath: input.newPath
        },
        requestId
      });
    }

    return moved;
  }

  public updateFile(
    tenantId: string,
    projectId: string,
    filePath: string,
    content: string,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): FileContent {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    if (!filePath) {
      throw new ValidationError('Le chemin du fichier est obligatoire', { field: 'filePath' }, requestId);
    }
    if (typeof content !== 'string') {
      throw new ValidationError('Le contenu du fichier est obligatoire et doit être une chaîne', { field: 'content' }, requestId);
    }

    const existing = this.fileStore.getFile(tenantId, projectId, filePath);
    if (!existing) {
      throw new NotFoundError(`Fichier "${filePath}" introuvable pour la mise à jour`, requestId);
    }

    const updated = this.fileStore.saveFile(tenantId, projectId, filePath, content);

    if (this.auditStore && requestId) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'FILE_UPDATE',
        resourceType: 'file',
        resourceId: `${projectId}:${updated.path}`,
        status: 'SUCCESS',
        metadata: {
          path: updated.path,
          sizeBytes: updated.sizeBytes,
          hash: updated.hash
        },
        requestId
      });
    }

    return updated;
  }

  public executeOperation(
    tenantId: string,
    projectId: string,
    op: FileOperation,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): FileOperationResult {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    if (!op || !op.type) {
      throw new ValidationError("Le type d'opération de fichier est obligatoire", undefined, requestId);
    }
    if (!op.path) {
      throw new ValidationError("Le chemin cible de l'opération est obligatoire", undefined, requestId);
    }

    const now = new Date();
    let result: FileOperationResult;

    switch (op.type) {
      case 'CREATE_FILE': {
        const node = this.createFile(
          tenantId,
          projectId,
          { path: op.path, type: 'file', content: op.content },
          userRole,
          requestId
        );
        result = {
          operation: 'CREATE_FILE',
          path: node.path,
          success: true,
          node,
          timestamp: now
        };
        break;
      }

      case 'UPDATE_FILE': {
        if (typeof op.content !== 'string') {
          throw new ValidationError('Le champ content est obligatoire pour UPDATE_FILE', undefined, requestId);
        }
        const file = this.updateFile(
          tenantId,
          projectId,
          op.path,
          op.content,
          userRole,
          requestId
        );
        result = {
          operation: 'UPDATE_FILE',
          path: file.path,
          success: true,
          file,
          timestamp: now
        };
        break;
      }

      case 'DELETE_FILE': {
        this.deleteFile(tenantId, projectId, op.path, userRole, requestId);
        result = {
          operation: 'DELETE_FILE',
          path: op.path,
          success: true,
          deletedPath: op.path,
          timestamp: now
        };
        break;
      }

      case 'CREATE_DIRECTORY': {
        const node = this.createDirectory(tenantId, projectId, op.path, userRole, requestId);
        result = {
          operation: 'CREATE_DIRECTORY',
          path: node.path,
          success: true,
          node,
          timestamp: now
        };
        break;
      }

      case 'DELETE_DIRECTORY': {
        this.deleteDirectory(tenantId, projectId, op.path, userRole, requestId);
        result = {
          operation: 'DELETE_DIRECTORY',
          path: op.path,
          success: true,
          deletedPath: op.path,
          timestamp: now
        };
        break;
      }

      case 'MOVE_FILE': {
        if (!op.newPath) {
          throw new ValidationError('Le champ newPath est obligatoire pour MOVE_FILE', undefined, requestId);
        }
        const node = this.moveFile(
          tenantId,
          projectId,
          { oldPath: op.path, newPath: op.newPath },
          userRole,
          requestId
        );
        result = {
          operation: 'MOVE_FILE',
          path: op.path,
          newPath: node.path,
          success: true,
          node,
          timestamp: now
        };
        break;
      }

      case 'RENAME_FILE': {
        if (!op.newPath) {
          throw new ValidationError('Le champ newPath est obligatoire pour RENAME_FILE', undefined, requestId);
        }
        const node = this.renameFile(
          tenantId,
          projectId,
          { oldPath: op.path, newPath: op.newPath },
          userRole,
          requestId
        );
        result = {
          operation: 'RENAME_FILE',
          path: op.path,
          newPath: node.path,
          success: true,
          node,
          timestamp: now
        };
        break;
      }

      default:
        throw new ValidationError(`Type d'opération inconnu : ${(op as any).type}`, undefined, requestId);
    }

    if (this.auditStore && requestId) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'FILE_OPERATION',
        resourceType: 'file',
        resourceId: `${projectId}:${op.path}`,
        status: 'SUCCESS',
        metadata: {
          operation: op.type,
          path: op.path,
          newPath: op.newPath
        },
        requestId
      });
    }

    return result;
  }

  public commitTreeToRevision(
    tenantId: string,
    projectId: string,
    message: string,
    author: string = 'system',
    provenance?: ModificationProvenance,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): ApplicationRevision {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    if (!this.revisionStore) {
      throw new ValidationError('RevisionStore non configuré pour ce service', undefined, requestId);
    }
    if (!message || message.trim().length === 0) {
      throw new ValidationError('Le message de révision est obligatoire', undefined, requestId);
    }

    const files = this.fileStore.getAllProjectFiles(tenantId, projectId);
    const revision = this.revisionStore.createRevision(tenantId, projectId, {
      message: message.trim(),
      author,
      files,
      provenance: provenance || {
        source: 'USER',
        prompt: message,
        triggerRequestId: requestId
      }
    });

    if (this.auditStore && requestId) {
      this.auditStore.record({
        tenantId,
        userId: author,
        action: 'REVISION_FROM_TREE',
        resourceType: 'revision',
        resourceId: `${projectId}:${revision.id}`,
        status: 'SUCCESS',
        metadata: {
          revisionId: revision.id,
          revisionNumber: revision.revisionNumber,
          filesCount: Object.keys(files).length
        },
        requestId
      });
    }

    return revision;
  }

  public createDirectory(
    tenantId: string,
    projectId: string,
    dirPath: string,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): FileNode {
    return this.createFile(tenantId, projectId, { path: dirPath, type: 'directory' }, userRole, requestId);
  }

  public deleteDirectory(
    tenantId: string,
    projectId: string,
    dirPath: string,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): boolean {
    return this.deleteFile(tenantId, projectId, dirPath, userRole, requestId);
  }

  public initializeStandardTree(
    tenantId: string,
    projectId: string,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): ProjectFilesSummary {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);
    this.fileStore.initializeStandardTree(tenantId, projectId);
    return this.getFilesSummary(tenantId, projectId, userRole, requestId);
  }
}
