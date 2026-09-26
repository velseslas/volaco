import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectStore,
  AuditStore,
  FileStore,
  RevisionStore,
  WorkspaceService,
  ValidationError,
  NotFoundError,
  ForbiddenError
} from '../src/index.js';

describe('CAPP-001 : Project Workspace & Summary Unit Tests', () => {
  let projectStore: ProjectStore;
  let auditStore: AuditStore;
  let fileStore: FileStore;
  let revisionStore: RevisionStore;
  let workspaceService: WorkspaceService;
  const tenantId = 'ten_test_001';
  let project: { id: string; name: string; description?: string };

  beforeEach(() => {
    projectStore = new ProjectStore();
    auditStore = new AuditStore();
    fileStore = new FileStore();
    revisionStore = new RevisionStore();
    workspaceService = new WorkspaceService(projectStore, auditStore, fileStore, revisionStore);
    project = projectStore.createProject(tenantId, 'Projet Démo Studio', 'Description de test');
  });

  it('doit initialiser un workspace avec un état par défaut valide et intégrer summary, révision et fichiers', () => {
    const session = workspaceService.getWorkspace(tenantId, project.id, 'ENGINEER', 'req_test_01');

    assert.equal(session.projectId, project.id);
    assert.equal(session.tenantId, tenantId);
    assert.equal(session.status, 'READY');
    assert.equal(session.state.activeFile, 'index.html');
    assert.deepEqual(session.state.openFiles, ['index.html']);
    assert.equal(session.state.activeSubTab, 'preview');
    assert.equal(session.state.isDirty, false);
    assert.ok(session.lastSyncedAt instanceof Date);

    // Vérifier l'intégration CAPP-001
    assert.ok(Array.isArray(session.files));
    assert.ok(session.files.includes('index.html'));
    assert.equal(session.revisionNumber, 0);
    assert.ok(session.summary);
    assert.equal(session.summary.name, 'Projet Démo Studio');
    assert.equal(session.summary.status, 'READY');
    assert.equal(session.summary.filesCount, session.files.length);

    // Vérifier l'événement d'audit
    const audits = auditStore.query(tenantId);
    assert.ok(audits.some(a => a.action === 'WORKSPACE_LOAD'));
    assert.ok(audits.some(a => a.action === 'WORKSPACE_SUMMARY'));
  });

  it('doit refléter les révisions FND-004 dans le workspace et le summary', () => {
    // Créer une révision via RevisionStore
    const rev1 = revisionStore.createRevision(tenantId, project.id, {
      message: 'Initial commit de test',
      author: 'developer',
      files: { 'index.html': '<h1>Version 1</h1>' },
      provenance: { source: 'USER', prompt: 'Setup' }
    });

    const session = workspaceService.getWorkspace(tenantId, project.id, 'ENGINEER');
    assert.equal(session.currentRevisionId, rev1.id);
    assert.equal(session.revisionNumber, 1);
    assert.equal(session.summary.currentRevisionId, rev1.id);
    assert.equal(session.summary.revisionNumber, 1);
  });

  it('doit refléter les fichiers FileStore FND-004 dans le workspace et le summary', () => {
    // Ajouter un fichier via FileStore
    fileStore.createNode(tenantId, project.id, 'styles.css', 'file', 'body { color: red; }');
    fileStore.createNode(tenantId, project.id, 'src/app.js', 'file', 'console.log(1);');

    const summary = workspaceService.getProjectSummary(tenantId, project.id, 'ENGINEER');
    assert.ok(summary.files.includes('index.html'));
    assert.ok(summary.files.includes('styles.css'));
    assert.ok(summary.files.includes('src/app.js'));
    assert.equal(summary.filesCount, 3);
  });

  it('doit renvoyer un summary valide et enregistrer un événement d audit dédié', () => {
    const summary = workspaceService.getProjectSummary(tenantId, project.id, 'ENGINEER', 'req_sum_01');

    assert.equal(summary.projectId, project.id);
    assert.equal(summary.tenantId, tenantId);
    assert.equal(summary.name, 'Projet Démo Studio');
    assert.equal(summary.description, 'Description de test');
    assert.equal(summary.status, 'READY');
    assert.ok(summary.lastActivityAt instanceof Date);

    const audits = auditStore.query(tenantId, { action: 'WORKSPACE_SUMMARY' });
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.requestId, 'req_sum_01');
  });

  it('doit rejeter l accès si le projet n existe pas ou appartient à un autre tenant (isolation stricte)', () => {
    assert.throws(
      () => workspaceService.getWorkspace('autre_tenant', project.id, 'ENGINEER'),
      NotFoundError
    );

    assert.throws(
      () => workspaceService.getWorkspace(tenantId, 'proj_inexistant', 'ENGINEER'),
      NotFoundError
    );

    assert.throws(
      () => workspaceService.getProjectSummary('autre_tenant', project.id, 'ENGINEER'),
      NotFoundError
    );
  });

  it('doit respecter les permissions RBAC pour la lecture et la mise à jour', () => {
    // VIEWER peut lire le workspace et le summary
    const session = workspaceService.getWorkspace(tenantId, project.id, 'VIEWER');
    assert.equal(session.status, 'READY');

    const summary = workspaceService.getProjectSummary(tenantId, project.id, 'VIEWER');
    assert.equal(summary.status, 'READY');

    // VIEWER ne peut pas mettre à jour le workspace
    assert.throws(
      () => workspaceService.updateWorkspaceState(tenantId, project.id, { activeFile: 'styles.css' }, 'VIEWER'),
      ForbiddenError
    );

    // ENGINEER peut mettre à jour le workspace
    const updated = workspaceService.updateWorkspaceState(
      tenantId,
      project.id,
      { activeFile: 'styles.css', openFiles: ['index.html', 'styles.css'], isDirty: true },
      'ENGINEER',
      'req_save_01'
    );

    assert.equal(updated.state.activeFile, 'styles.css');
    assert.deepEqual(updated.state.openFiles, ['index.html', 'styles.css']);
    assert.equal(updated.state.isDirty, true);

    // Vérifier l'audit du save
    const audits = auditStore.query(tenantId, { action: 'WORKSPACE_SAVE' });
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.requestId, 'req_save_01');
  });

  it('doit valider la présence obligatoire de tenantId et projectId', () => {
    assert.throws(() => workspaceService.getWorkspace('', project.id), ValidationError);
    assert.throws(() => workspaceService.getWorkspace(tenantId, ''), ValidationError);
    assert.throws(() => workspaceService.getProjectSummary('', project.id), ValidationError);
    assert.throws(() => workspaceService.getProjectSummary(tenantId, ''), ValidationError);
    assert.throws(() => workspaceService.updateWorkspaceState('', project.id, {}), ValidationError);
  });

  it('doit pouvoir fermer une session de workspace', () => {
    workspaceService.getWorkspace(tenantId, project.id);
    const closed = workspaceService.closeWorkspace(project.id);
    assert.equal(closed, true);

    const closedAgain = workspaceService.closeWorkspace(project.id);
    assert.equal(closedAgain, false);
  });
});
