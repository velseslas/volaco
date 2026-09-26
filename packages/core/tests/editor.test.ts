import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectStore,
  AuditStore,
  FileStore,
  WorkspaceService,
  EditorService,
  ValidationError,
  NotFoundError,
  ForbiddenError
} from '../src/index.js';

describe('CORE-004 : Code Editor Service Unit Tests', () => {
  let projectStore: ProjectStore;
  let auditStore: AuditStore;
  let fileStore: FileStore;
  let workspaceService: WorkspaceService;
  let editorService: EditorService;
  const tenantId = 'ten_ed_001';
  let project: { id: string; name: string };

  beforeEach(() => {
    projectStore = new ProjectStore();
    auditStore = new AuditStore();
    fileStore = new FileStore();
    workspaceService = new WorkspaceService(projectStore, auditStore);
    editorService = new EditorService(projectStore, fileStore, workspaceService, auditStore);
    project = projectStore.createProject(tenantId, 'Editor Demo App');
  });

  it('doit sauvegarder le contenu d un fichier et calculer le SHA-256', () => {
    const content = '<!DOCTYPE html><html><body><h1>Updated Version</h1></body></html>';
    const result = editorService.saveFile(
      tenantId,
      project.id,
      { path: 'index.html', content },
      'ENGINEER',
      'req_save_01'
    );

    assert.equal(result.tenantId, tenantId);
    assert.equal(result.projectId, project.id);
    assert.equal(result.path, 'index.html');
    assert.equal(result.sizeBytes, Buffer.byteLength(content, 'utf8'));
    assert.ok(result.sha256.length === 64); // SHA-256 hex length
    assert.ok(result.savedAt instanceof Date);

    // Vérifier que le fichier est réellement mis à jour dans le FileStore
    const saved = fileStore.getFile(tenantId, project.id, 'index.html');
    assert.ok(saved);
    assert.equal(saved.content, content);

    // Vérifier l'événement d'audit
    const audits = auditStore.query(tenantId, { action: 'FILE_SAVE' });
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.resourceId, `${project.id}:index.html`);
    assert.equal(audits[0]!.requestId, 'req_save_01');
  });

  it('doit synchroniser le statut isDirty du workspace lors de la sauvegarde', () => {
    // 1. Initialiser une session de workspace et la marquer comme "dirty"
    workspaceService.getWorkspace(tenantId, project.id, 'ENGINEER');
    workspaceService.updateWorkspaceState(tenantId, project.id, { isDirty: true, activeFile: 'index.html' });
    assert.equal(workspaceService.getWorkspace(tenantId, project.id).state.isDirty, true);

    // 2. Sauvegarder via l'EditorService
    const result = editorService.saveFile(
      tenantId,
      project.id,
      { path: 'index.html', content: 'console.log("clean");' },
      'ENGINEER'
    );

    assert.equal(result.workspaceSynced, true);
    // L'état dirty doit maintenant être false
    assert.equal(workspaceService.getWorkspace(tenantId, project.id).state.isDirty, false);
  });

  it('doit appliquer les règles de permissions RBAC', () => {
    // VIEWER ne peut pas sauvegarder de fichier
    assert.throws(
      () => editorService.saveFile(tenantId, project.id, { path: 'index.html', content: 'hack' }, 'VIEWER'),
      ForbiddenError
    );
  });

  it('doit rejeter les entrées invalides', () => {
    assert.throws(
      () => editorService.saveFile('', project.id, { path: 'index.html', content: '' }),
      ValidationError
    );
    assert.throws(
      () => editorService.saveFile(tenantId, '', { path: 'index.html', content: '' }),
      ValidationError
    );
    assert.throws(
      () => editorService.saveFile(tenantId, project.id, { path: '', content: '' }),
      ValidationError
    );
  });

  it('doit garantir l étanchéité multi-tenant', () => {
    const rivalTenant = 'ten_rival_007';
    assert.throws(
      () => editorService.saveFile(rivalTenant, project.id, { path: 'index.html', content: 'exploit' }),
      NotFoundError
    );
  });
});
