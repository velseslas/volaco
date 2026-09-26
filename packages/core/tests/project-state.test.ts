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
  ValidationError,
  NotFoundError,
  ForbiddenError,
  type AuditEvent
} from '../src/index.js';

describe('CAPP-004 : Project State & Application Status Unit Tests', () => {
  let projectStore: ProjectStore;
  let fileStore: FileStore;
  let auditStore: AuditStore;
  let revisionStore: RevisionStore;
  let workspaceService: WorkspaceService;
  let stateStore: ProjectStateStore;
  let service: ProjectStateService;

  const tenantId = 'tenant_capp004';
  let project: { id: string; name: string };

  beforeEach(() => {
    projectStore = new ProjectStore();
    fileStore = new FileStore();
    auditStore = new AuditStore();
    revisionStore = new RevisionStore();
    workspaceService = new WorkspaceService(projectStore, auditStore, fileStore, revisionStore);
    stateStore = new ProjectStateStore();
    service = new ProjectStateService(
      projectStore,
      stateStore,
      revisionStore,
      workspaceService,
      auditStore,
      fileStore
    );

    project = projectStore.createProject(tenantId, 'App CAPP-004', 'Cycle de vie complet');
    fileStore.initializeStandardTree(tenantId, project.id);
  });

  it('1. État initial : le projet doit être initialisé avec le statut CREATED et des valeurs par défaut', () => {
    const state = service.getProjectState(tenantId, project.id, 'VIEWER');

    assert.equal(state.tenantId, tenantId);
    assert.equal(state.projectId, project.id);
    assert.equal(state.name, 'App CAPP-004');
    assert.equal(state.status, 'CREATED');
    assert.equal(state.currentRevision.revisionNumber, 0);
    assert.equal(state.workspace.status, 'READY');
    assert.equal(state.workspace.isDirty, false);
    assert.equal(state.validation.status, 'PENDING');
    assert.ok(typeof state.currentRevision.treeHash === 'string');
  });

  it('2. Machine à états : doit permettre les transitions autorisées dans le cycle de vie', () => {
    // CREATED -> ACTIVE
    let s = service.updateProjectStatus(tenantId, project.id, { status: 'ACTIVE' }, 'ENGINEER');
    assert.equal(s.status, 'ACTIVE');

    // ACTIVE -> BUILDING
    s = service.updateProjectStatus(tenantId, project.id, { status: 'BUILDING' }, 'ENGINEER');
    assert.equal(s.status, 'BUILDING');

    // BUILDING -> VALIDATING
    s = service.updateProjectStatus(tenantId, project.id, { status: 'VALIDATING' }, 'ENGINEER');
    assert.equal(s.status, 'VALIDATING');

    // VALIDATING -> READY
    s = service.updateProjectStatus(tenantId, project.id, { status: 'READY' }, 'ENGINEER');
    assert.equal(s.status, 'READY');

    // READY -> ARCHIVED
    s = service.updateProjectStatus(tenantId, project.id, { status: 'ARCHIVED' }, 'ENGINEER');
    assert.equal(s.status, 'ARCHIVED');

    // ARCHIVED -> ACTIVE (réactivation)
    s = service.updateProjectStatus(tenantId, project.id, { status: 'ACTIVE' }, 'ENGINEER');
    assert.equal(s.status, 'ACTIVE');
  });

  it('3. Machine à états : doit rejeter les transitions illégales (ValidationError)', () => {
    // CREATED -> READY (interdit, doit passer par ACTIVE ou BUILDING)
    assert.throws(
      () => service.updateProjectStatus(tenantId, project.id, { status: 'READY' }, 'ENGINEER'),
      (err: unknown) => err instanceof ValidationError
    );

    // Mettre en ARCHIVED via ACTIVE -> ARCHIVED
    service.updateProjectStatus(tenantId, project.id, { status: 'ACTIVE' }, 'ENGINEER');
    service.updateProjectStatus(tenantId, project.id, { status: 'ARCHIVED' }, 'ENGINEER');

    // ARCHIVED -> BUILDING (interdit, seule la réactivation vers ACTIVE est permise)
    assert.throws(
      () => service.updateProjectStatus(tenantId, project.id, { status: 'BUILDING' }, 'ENGINEER'),
      (err: unknown) => err instanceof ValidationError
    );
  });

  it('4. Révision courante : doit refléter fidèlement les révisions FND-004 créées', () => {
    // Créer une révision avec provenance FND-004
    const rev = revisionStore.createRevision(tenantId, project.id, {
      message: 'Snapshot initial v1',
      author: 'alice',
      files: { 'index.html': '<html><body>v1</body></html>' },
      provenance: { source: 'USER', prompt: 'Snapshot initial v1' }
    });

    const state = service.getProjectState(tenantId, project.id, 'VIEWER');
    assert.equal(state.currentRevision.id, rev.id);
    assert.equal(state.currentRevision.revisionNumber, 1);
    assert.equal(state.currentRevision.author, 'alice');
    assert.equal(state.currentRevision.message, 'Snapshot initial v1');
  });

  it('5. État du Workspace : doit refléter les modifications actives et fichiers ouverts', () => {
    // Modifier l'état du workspace
    workspaceService.updateWorkspaceState(
      tenantId,
      project.id,
      {
        activeFile: 'src/App.js',
        openFiles: ['src/App.js', 'package.json'],
        isDirty: true
      },
      'ENGINEER'
    );

    const state = service.getProjectState(tenantId, project.id, 'VIEWER');
    assert.equal(state.workspace.activeFile, 'src/App.js');
    assert.equal(state.workspace.openFilesCount, 2);
    assert.equal(state.workspace.isDirty, true);
  });

  it('6. Moteur de validation : doit valider le projet et basculer l état vers READY en cas de succès', () => {
    service.updateProjectStatus(tenantId, project.id, { status: 'ACTIVE' }, 'ENGINEER');

    const report = service.runProjectValidation(
      tenantId,
      project.id,
      { checks: { build: true, typecheck: true, lint: true, tests: true, security: true } },
      'ENGINEER',
      'req_val_pass'
    );

    assert.equal(report.status, 'VALID');
    assert.equal(report.errors.length, 0);

    const state = service.getProjectState(tenantId, project.id, 'VIEWER');
    assert.equal(state.status, 'READY');
    assert.equal(state.validation.status, 'VALID');
  });

  it('6b. Moteur de validation : doit rejeter le projet et basculer l état vers ERROR en cas d échec', () => {
    service.updateProjectStatus(tenantId, project.id, { status: 'ACTIVE' }, 'ENGINEER');

    const report = service.runProjectValidation(
      tenantId,
      project.id,
      { checks: { build: false, typecheck: false } },
      'ENGINEER',
      'req_val_fail'
    );

    assert.equal(report.status, 'INVALID');
    assert.ok(report.errors.length >= 2);

    const state = service.getProjectState(tenantId, project.id, 'VIEWER');
    assert.equal(state.status, 'ERROR');
    assert.equal(state.validation.status, 'INVALID');
  });

  it('7. Activité récente : doit agréger les événements d audit associés au projet', () => {
    service.updateProjectStatus(tenantId, project.id, { status: 'ACTIVE' }, 'ENGINEER', 'req_act_1');
    service.runProjectValidation(tenantId, project.id, undefined, 'ENGINEER', 'req_act_2');

    const activity = service.getRecentActivity(tenantId, project.id, 10, 'VIEWER');
    assert.ok(activity.length >= 2);
    const actions = activity.map(a => a.action);
    assert.ok(actions.includes('PROJECT_STATUS_UPDATE'));
    assert.ok(actions.includes('PROJECT_VALIDATION'));
  });

  it('8. Isolation Multi-Tenant : doit interdire toute consultation ou modification inter-locataires (NotFoundError)', () => {
    const rivalTenant = 'tenant_rival';

    assert.throws(
      () => service.getProjectState(rivalTenant, project.id, 'VIEWER'),
      (err: unknown) => err instanceof NotFoundError
    );

    assert.throws(
      () => service.updateProjectStatus(rivalTenant, project.id, { status: 'ACTIVE' }, 'ADMIN'),
      (err: unknown) => err instanceof NotFoundError
    );

    assert.throws(
      () => service.runProjectValidation(rivalTenant, project.id, undefined, 'ADMIN'),
      (err: unknown) => err instanceof NotFoundError
    );
  });

  it('9. RBAC : VIEWER a accès en lecture mais est rejeté sur les mutations (ForbiddenError)', () => {
    // Lecture permise
    const state = service.getProjectState(tenantId, project.id, 'VIEWER');
    assert.ok(state);

    // Mutation de statut interdite
    assert.throws(
      () => service.updateProjectStatus(tenantId, project.id, { status: 'ACTIVE' }, 'VIEWER'),
      (err: unknown) => err instanceof ForbiddenError
    );

    // Lancement de validation interdit
    assert.throws(
      () => service.runProjectValidation(tenantId, project.id, undefined, 'VIEWER'),
      (err: unknown) => err instanceof ForbiddenError
    );
  });

  it('10. Traçabilité Audit : doit enregistrer les événements avec métadonnées et requestId', () => {
    service.updateProjectStatus(tenantId, project.id, { status: 'ACTIVE', reason: 'Démarrage du dev' }, 'ENGINEER', 'req_audit_stat');

    const logs = auditStore.query(tenantId);
    const statusLog = logs.find((l: AuditEvent) => l.requestId === 'req_audit_stat' && l.action === 'PROJECT_STATUS_UPDATE');
    assert.ok(statusLog);
    assert.equal(statusLog.metadata?.['previousStatus'], 'CREATED');
    assert.equal(statusLog.metadata?.['newStatus'], 'ACTIVE');
    assert.equal(statusLog.metadata?.['reason'], 'Démarrage du dev');
  });
});
