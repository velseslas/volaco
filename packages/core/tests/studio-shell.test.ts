import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectStore,
  AuditStore,
  FileStore,
  RevisionStore,
  WorkspaceService,
  ProjectStateStore,
  ProjectStateService,
  FileExplorerService,
  StudioShellService,
  ValidationError,
  NotFoundError
} from '../src/index.js';

describe('CAPP-005 : Studio Shell Unit Tests', () => {
  let projectStore: ProjectStore;
  let fileStore: FileStore;
  let auditStore: AuditStore;
  let revisionStore: RevisionStore;
  let workspaceService: WorkspaceService;
  let stateStore: ProjectStateStore;
  let stateService: ProjectStateService;
  let fileExplorerService: FileExplorerService;
  let shellService: StudioShellService;

  const tenantId = 'tenant_capp005';
  let project: { id: string; name: string };

  beforeEach(() => {
    projectStore = new ProjectStore();
    fileStore = new FileStore();
    auditStore = new AuditStore();
    revisionStore = new RevisionStore();
    workspaceService = new WorkspaceService(projectStore, auditStore, fileStore, revisionStore);
    stateStore = new ProjectStateStore();
    stateService = new ProjectStateService(
      projectStore,
      stateStore,
      revisionStore,
      workspaceService,
      auditStore,
      fileStore
    );
    fileExplorerService = new FileExplorerService(projectStore, fileStore, auditStore, revisionStore);
    shellService = new StudioShellService(
      projectStore,
      stateService,
      fileExplorerService,
      workspaceService
    );

    project = projectStore.createProject(tenantId, 'App Studio Shell', 'Test CAPP-005');
    fileStore.initializeStandardTree(tenantId, project.id);
  });

  it('1. Layout du Studio Shell : doit définir les 4 sections obligatoires (File Tree, Workspace, Project Info, Status/Events)', () => {
    const layout = shellService.getShellLayout();

    assert.equal(layout.title, 'VibeCode Studio');
    assert.ok(layout.panels.fileTree.visible);
    assert.equal(layout.panels.fileTree.title, 'FILE TREE');

    assert.ok(layout.panels.workspace.visible);
    assert.equal(layout.panels.workspace.title, 'WORKSPACE');

    assert.ok(layout.panels.projectInfo.visible);
    assert.equal(layout.panels.projectInfo.title, 'PROJECT INFO');

    assert.ok(layout.panels.statusEvents.visible);
    assert.equal(layout.panels.statusEvents.title, 'STATUS / EVENTS');
  });

  it('2. ViewModel Unifié : doit agréger le projet, les fichiers, le workspace et le layout', () => {
    const model = shellService.getShellViewModel(tenantId, project.id, 'VIEWER', 'req_shell_vm');

    assert.equal(model.tenantId, tenantId);
    assert.equal(model.projectId, project.id);
    assert.equal(model.userRole, 'VIEWER');
    assert.equal(model.project.status, 'CREATED');
    assert.ok(model.files.totalFiles >= 4);
    assert.ok(model.workspace.status);
    assert.ok(model.layout);
    assert.ok(model.serverTime instanceof Date);
  });

  it('3. Rendu HTML : doit produire un document HTML complet contenant le Studio Shell', () => {
    const html = shellService.renderShellHtml(tenantId, project.id, 'VIEWER');

    assert.ok(typeof html === 'string' && html.length > 500);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('VibeCode Studio'));
  });

  it('4. Isolation Multi-Tenant : doit rejeter toute demande de Shell pour un projet d un autre locataire (NotFoundError)', () => {
    const rivalTenant = 'tenant_rival';

    assert.throws(
      () => shellService.getShellViewModel(rivalTenant, project.id, 'VIEWER'),
      (err: unknown) => err instanceof NotFoundError
    );

    assert.throws(
      () => shellService.renderShellHtml(rivalTenant, project.id, 'VIEWER'),
      (err: unknown) => err instanceof NotFoundError
    );
  });

  it('5. Validation des entrées : doit rejeter si tenantId ou projectId manquant', () => {
    assert.throws(
      () => shellService.getShellViewModel('', project.id, 'VIEWER'),
      (err: unknown) => err instanceof ValidationError
    );

    assert.throws(
      () => shellService.getShellViewModel(tenantId, '', 'VIEWER'),
      (err: unknown) => err instanceof ValidationError
    );
  });
});
