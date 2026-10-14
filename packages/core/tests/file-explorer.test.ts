import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectStore,
  AuditStore,
  FileStore,
  FileExplorerService,
  ValidationError,
  NotFoundError,
  ForbiddenError
} from '../src/index.js';

describe('CORE-003 : File Explorer Service Unit Tests', () => {
  let projectStore: ProjectStore;
  let auditStore: AuditStore;
  let fileStore: FileStore;
  let service: FileExplorerService;
  const tenantId = 'ten_fe_001';
  let project: { id: string; name: string };

  beforeEach(() => {
    projectStore = new ProjectStore();
    auditStore = new AuditStore();
    fileStore = new FileStore();
    service = new FileExplorerService(projectStore, fileStore, auditStore);
    project = projectStore.createProject(tenantId, 'App Test Files');
  });

  it('doit initialiser l arborescence avec un fichier index.html par défaut', () => {
    const summary = service.getFilesSummary(tenantId, project.id, 'VIEWER');
    assert.equal(summary.tenantId, tenantId);
    assert.equal(summary.projectId, project.id);
    assert.equal(summary.totalFiles, 1);
    assert.equal(summary.totalDirectories, 0);
    assert.equal(summary.tree.length, 1);
    assert.equal(summary.tree[0]!.name, 'index.html');
    assert.equal(summary.tree[0]!.type, 'file');
  });

  it('doit lire le contenu d un fichier existant', () => {
    const file = service.getFileContent(tenantId, project.id, 'index.html', 'VIEWER');
    assert.equal(file.path, 'index.html');
    assert.equal(file.name, 'index.html');
    assert.ok(file.content.includes('<!DOCTYPE html>'));
    assert.ok(file.sizeBytes > 0);
  });

  it('doit bloquer les tentatives d injection et directory traversal (..)', () => {
    assert.throws(
      () => service.getFileContent(tenantId, project.id, '../../../etc/passwd'),
      ValidationError
    );
    assert.throws(
      () => service.createFile(tenantId, project.id, { path: '../hack.js', type: 'file' }),
      ValidationError
    );
    assert.throws(
      () => service.createFile(tenantId, project.id, { path: 'src/..\0/hack.js', type: 'file' }),
      ValidationError
    );
  });

  it('doit créer un fichier et un dossier imbriqué avec audit', () => {
    const createdDir = service.createFile(
      tenantId,
      project.id,
      { path: 'src/components', type: 'directory' },
      'ENGINEER',
      'req_fe_dir'
    );
    assert.equal(createdDir.path, 'src/components');
    assert.equal(createdDir.type, 'directory');

    const createdFile = service.createFile(
      tenantId,
      project.id,
      { path: 'src/components/Button.jsx', type: 'file', content: 'export const Button = () => <button>Click</button>;' },
      'ENGINEER',
      'req_fe_file'
    );
    assert.equal(createdFile.path, 'src/components/Button.jsx');
    assert.equal(createdFile.type, 'file');
    assert.ok(createdFile.sizeBytes! > 0);

    // Vérifier l'arborescence
    const summary = service.getFilesSummary(tenantId, project.id);
    assert.equal(summary.totalFiles, 2); // index.html + Button.jsx
    assert.equal(summary.totalDirectories, 2); // src + src/components

    // Vérifier l'audit
    const audits = auditStore.query(tenantId, { action: 'FILE_CREATE' });
    assert.equal(audits.length, 2);
    assert.equal(audits[1]!.resourceId, `${project.id}:src/components/Button.jsx`);
  });

  it('doit renommer un fichier et propager les modifications avec audit', () => {
    service.createFile(tenantId, project.id, { path: 'style.css', type: 'file', content: 'body { color: red; }' });

    const renamed = service.renameFile(
      tenantId,
      project.id,
      { oldPath: 'style.css', newPath: 'theme.css' },
      'ENGINEER',
      'req_fe_ren'
    );
    assert.equal(renamed.path, 'theme.css');
    assert.equal(renamed.name, 'theme.css');

    // L'ancien fichier ne doit plus exister
    assert.throws(
      () => service.getFileContent(tenantId, project.id, 'style.css'),
      NotFoundError
    );

    // Le nouveau fichier doit contenir le contenu
    const content = service.getFileContent(tenantId, project.id, 'theme.css');
    assert.equal(content.content, 'body { color: red; }');

    // Vérifier l'audit
    const audits = auditStore.query(tenantId, { action: 'FILE_RENAME' });
    assert.equal(audits.length, 1);
  });

  it('doit supprimer un fichier avec audit', () => {
    service.createFile(tenantId, project.id, { path: 'temp.txt', type: 'file', content: 'tempo' });
    const deleted = service.deleteFile(tenantId, project.id, 'temp.txt', 'ENGINEER', 'req_fe_del');
    assert.equal(deleted, true);

    assert.throws(
      () => service.getFileContent(tenantId, project.id, 'temp.txt'),
      NotFoundError
    );

    // Vérifier l'audit
    const audits = auditStore.query(tenantId, { action: 'FILE_DELETE' });
    assert.equal(audits.length, 1);
  });

  it('doit supprimer un dossier et tous ses sous-fichiers en cascade', () => {
    service.createFile(tenantId, project.id, { path: 'lib/utils.js', type: 'file', content: '// utils' });
    service.createFile(tenantId, project.id, { path: 'lib/helpers.js', type: 'file', content: '// helpers' });

    assert.equal(service.getFilesSummary(tenantId, project.id).totalFiles, 3); // index.html + utils + helpers

    service.deleteFile(tenantId, project.id, 'lib');

    assert.equal(service.getFilesSummary(tenantId, project.id).totalFiles, 1); // seulement index.html
  });

  it('doit respecter les permissions RBAC', () => {
    // VIEWER ne peut pas créer de fichier
    assert.throws(
      () => service.createFile(tenantId, project.id, { path: 'unauthorized.js', type: 'file' }, 'VIEWER'),
      ForbiddenError
    );

    // VIEWER ne peut pas supprimer de fichier
    assert.throws(
      () => service.deleteFile(tenantId, project.id, 'index.html', 'VIEWER'),
      ForbiddenError
    );

    // VIEWER ne peut pas renommer de fichier
    assert.throws(
      () => service.renameFile(tenantId, project.id, { oldPath: 'index.html', newPath: 'main.html' }, 'VIEWER'),
      ForbiddenError
    );
  });

  it('doit garantir l étanchéité multi-tenant', () => {
    const rivalTenant = 'ten_rival_999';
    assert.throws(
      () => service.getFilesSummary(rivalTenant, project.id),
      NotFoundError
    );
  });
});

describe('QUOTAS : taille max par fichier (anti-DoS mémoire/disque)', () => {
  it('fichier trop gros refusé (saveFile + createNode), rien d’écrit', () => {
    const prev = process.env.VOLACO_FILE_MAX_BYTES;
    process.env.VOLACO_FILE_MAX_BYTES = '100';
    try {
      const store = new FileStore();
      assert.throws(
        () => store.saveFile('t', 'p', 'gros.html', 'A'.repeat(101)),
        ValidationError
      );
      assert.throws(
        () => store.createNode('t', 'p', 'gros2.html', 'file', 'B'.repeat(500)),
        ValidationError
      );
      // Rien d’écrit : le projet par défaut reste seul.
      assert.equal(store.getFile('t', 'p', 'gros.html'), null);
      // À la limite exacte : accepté.
      const ok = store.saveFile('t', 'p', 'ok.html', 'C'.repeat(100));
      assert.equal(ok.sizeBytes, 100);
    } finally {
      if (prev === undefined) delete process.env.VOLACO_FILE_MAX_BYTES;
      else process.env.VOLACO_FILE_MAX_BYTES = prev;
    }
  });
});
