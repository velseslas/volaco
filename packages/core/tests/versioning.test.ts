import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectStore,
  AuditStore,
  FileStore,
  RevisionStore,
  WorkspaceService,
  VersioningService,
  ValidationError,
  NotFoundError,
  ForbiddenError
} from '../src/index.js';

describe('CORE-007 : Versioning & Revisions Service Unit Tests', () => {
  let projectStore: ProjectStore;
  let auditStore: AuditStore;
  let fileStore: FileStore;
  let revisionStore: RevisionStore;
  let workspaceService: WorkspaceService;
  let versioningService: VersioningService;
  const tenantId = 'ten_ver_001';
  let project: { id: string; name: string };

  beforeEach(() => {
    projectStore = new ProjectStore();
    auditStore = new AuditStore();
    fileStore = new FileStore();
    revisionStore = new RevisionStore();
    workspaceService = new WorkspaceService(projectStore, auditStore);
    versioningService = new VersioningService(
      projectStore,
      revisionStore,
      fileStore,
      workspaceService,
      auditStore
    );
    project = projectStore.createProject(tenantId, 'Versioned App');
  });

  it('doit créer un snapshot complet des fichiers du projet et incrémenter la révision', () => {
    // 1. État initial (index.html par défaut)
    const rev1 = versioningService.createSnapshotFromProject(
      tenantId,
      project.id,
      { message: 'Initial Commit' },
      'ENGINEER',
      'req_snap_01'
    );

    assert.equal(rev1.revisionNumber, 1);
    assert.equal(rev1.message, 'Initial Commit');
    assert.ok(rev1.files['index.html']);
    assert.equal(rev1.parentRevisionId, undefined);

    // 2. Modifier un fichier et créer un second snapshot
    fileStore.saveFile(tenantId, project.id, 'index.html', '<h1>Version 2</h1>');
    fileStore.saveFile(tenantId, project.id, 'style.css', 'body { margin: 0; }');

    const rev2 = versioningService.createSnapshotFromProject(
      tenantId,
      project.id,
      { message: 'Ajout styles et V2' },
      'ENGINEER',
      'req_snap_02'
    );

    assert.equal(rev2.revisionNumber, 2);
    assert.equal(rev2.parentRevisionId, rev1.id);
    assert.equal(Object.keys(rev2.files).length, 2);

    // Vérifier l'audit
    const audits = auditStore.query(tenantId, { action: 'REVISION_CREATE' });
    assert.equal(audits.length, 2);
  });

  it('doit exécuter un rollback et restaurer physiquement les fichiers dans le FileStore', () => {
    // Étape 1 : V1
    fileStore.saveFile(tenantId, project.id, 'app.js', 'console.log("v1");');
    const rev1 = versioningService.createSnapshotFromProject(tenantId, project.id, { message: 'V1 Stable' });

    // Étape 2 : V2 buggée
    fileStore.saveFile(tenantId, project.id, 'app.js', 'console.log("v2 with fatal bug");');
    const rev2 = versioningService.createSnapshotFromProject(tenantId, project.id, { message: 'V2 Bugged' });

    // Étape 3 : Rollback vers V1
    const rollback = versioningService.rollbackToRevision(
      tenantId,
      project.id,
      rev1.id,
      'ENGINEER',
      'req_roll_01'
    );

    assert.equal(rollback.success, true);
    assert.equal(rollback.restoredFromRevisionId, rev1.id);
    assert.equal(rollback.newRevision.revisionNumber, 3);
    assert.ok(rollback.newRevision.message.includes('Rollback') && rollback.newRevision.message.includes('#1'));

    // Vérifier que le FileStore a RÉELLEMENT été restauré avec le code de la V1 !
    const restoredFile = fileStore.getFile(tenantId, project.id, 'app.js');
    assert.ok(restoredFile);
    assert.equal(restoredFile.content, 'console.log("v1");');

    // Vérifier l'audit
    const audits = auditStore.query(tenantId, { action: 'ROLLBACK_TRIGGERED' });
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.requestId, 'req_roll_01');
  });

  it('doit lister les révisions dans l ordre chronologique', () => {
    versioningService.createSnapshotFromProject(tenantId, project.id, { message: 'Rev A' });
    versioningService.createSnapshotFromProject(tenantId, project.id, { message: 'Rev B' });

    const list = versioningService.listRevisions(tenantId, project.id, 'VIEWER');
    assert.equal(list.length, 2);
    assert.equal(list[0]!.message, 'Rev A');
    assert.equal(list[1]!.message, 'Rev B');
  });

  it('doit faire respecter les règles de permissions RBAC', () => {
    // VIEWER ne peut pas créer de snapshot
    assert.throws(
      () => versioningService.createSnapshotFromProject(tenantId, project.id, { message: 'Hack' }, 'VIEWER'),
      ForbiddenError
    );

    // VIEWER ne peut pas exécuter de rollback
    assert.throws(
      () => versioningService.rollbackToRevision(tenantId, project.id, 'rev_dummy', 'VIEWER'),
      ForbiddenError
    );
  });

  it('doit garantir l étanchéité multi-tenant', () => {
    const rivalTenant = 'ten_rival_007';
    assert.throws(
      () => versioningService.listRevisions(rivalTenant, project.id),
      NotFoundError
    );
  });
});
