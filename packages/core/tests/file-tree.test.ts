import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectStore,
  AuditStore,
  FileStore,
  RevisionStore,
  FileExplorerService,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  computeSha256
} from '../src/index.js';

describe('CAPP-002 : File / Project Tree Unit Tests', () => {
  let projectStore: ProjectStore;
  let fileStore: FileStore;
  let auditStore: AuditStore;
  let revisionStore: RevisionStore;
  let service: FileExplorerService;
  const tenantId = 'ten_capp002';
  let project: { id: string; name: string };

  beforeEach(() => {
    projectStore = new ProjectStore();
    fileStore = new FileStore();
    auditStore = new AuditStore();
    revisionStore = new RevisionStore();
    service = new FileExplorerService(projectStore, fileStore, auditStore, revisionStore);
    project = projectStore.createProject(tenantId, 'Projet Web CAPP-002', 'Structure standard');
    service.initializeStandardTree(tenantId, project.id, 'ENGINEER');
  });

  it('doit initialiser l arborescence standard complète (src/components, src/pages, public, package.json)', () => {
    const summary = service.getFilesSummary(tenantId, project.id, 'VIEWER');

    assert.equal(summary.tenantId, tenantId);
    assert.equal(summary.projectId, project.id);
    assert.ok(summary.totalFiles >= 4);
    assert.ok(summary.totalDirectories >= 3);
    assert.ok(typeof summary.treeHash === 'string' && summary.treeHash.length === 64);

    // Vérifier les nœuds de premier niveau
    const rootNames = summary.tree.map(n => n.name);
    assert.ok(rootNames.includes('src'));
    assert.ok(rootNames.includes('public'));
    assert.ok(rootNames.includes('package.json'));
    assert.ok(rootNames.includes('README.md'));

    // Vérifier les sous-dossiers dans src
    const srcNode = summary.tree.find(n => n.name === 'src');
    assert.ok(srcNode);
    assert.equal(srcNode.type, 'directory');
    const srcChildren = srcNode.children?.map(c => c.name) || [];
    assert.ok(srcChildren.includes('components'));
    assert.ok(srcChildren.includes('pages'));
    assert.ok(srcChildren.includes('App.js'));
  });

  it('doit calculer le SHA-256 déterministe pour chaque fichier et pour l arbre entier (treeHash)', () => {
    const file = service.getFileContent(tenantId, project.id, 'package.json', 'VIEWER');
    assert.ok(file.hash);
    assert.equal(file.hash.length, 64);
    assert.equal(file.hash, computeSha256(file.content));

    const summary = service.getFilesSummary(tenantId, project.id, 'VIEWER');
    const expectedTreeHash = fileStore.computeTreeHash(tenantId, project.id);
    assert.equal(summary.treeHash, expectedTreeHash);
  });

  it('doit créer un fichier et un sous-dossier logique déterministe avec hash valide', () => {
    const newFile = service.createFile(
      tenantId,
      project.id,
      {
        path: 'src/components/Button.tsx',
        type: 'file',
        content: 'export const Button = () => <button>Click</button>;'
      },
      'ENGINEER',
      'req_create_01'
    );

    assert.equal(newFile.path, 'src/components/Button.tsx');
    assert.equal(newFile.type, 'file');
    assert.ok(newFile.hash);
    assert.equal(newFile.hash, computeSha256('export const Button = () => <button>Click</button>;'));

    // Créer un dossier logique
    const newDir = service.createDirectory(tenantId, project.id, 'src/utils', 'ENGINEER');
    assert.equal(newDir.path, 'src/utils');
    assert.equal(newDir.type, 'directory');

    // Vérifier l'audit
    const audits = auditStore.query(tenantId, { action: 'FILE_CREATE' });
    assert.ok(audits.length >= 1);
  });

  it('doit supprimer un dossier et tous ses sous-fichiers en cascade', () => {
    service.createFile(tenantId, project.id, { path: 'temp_dir/sub/file1.txt', type: 'file', content: 'test1' });
    service.createFile(tenantId, project.id, { path: 'temp_dir/sub/file2.txt', type: 'file', content: 'test2' });

    const deleted = service.deleteDirectory(tenantId, project.id, 'temp_dir', 'ENGINEER');
    assert.equal(deleted, true);

    // Vérifier que les sous-fichiers ne sont plus trouvables
    assert.throws(() => service.getFileContent(tenantId, project.id, 'temp_dir/sub/file1.txt'), NotFoundError);
    assert.throws(() => service.getFileContent(tenantId, project.id, 'temp_dir/sub/file2.txt'), NotFoundError);
  });

  it('doit associer les changements à une révision FND-004 via commitTreeToRevision', () => {
    // Modifier un fichier
    fileStore.saveFile(tenantId, project.id, 'src/App.js', 'export default function App() { return <h1>Updated</h1>; }');

    // Commiter l'arbre dans une nouvelle révision
    const rev = service.commitTreeToRevision(
      tenantId,
      project.id,
      'Mise à jour majeure du composant App',
      'lead-dev',
      { source: 'USER', prompt: 'Update App.js' },
      'ENGINEER',
      'req_commit_01'
    );

    assert.ok(rev.id);
    assert.equal(rev.revisionNumber, 1);
    assert.equal(rev.message, 'Mise à jour majeure du composant App');
    assert.equal(rev.author, 'lead-dev');
    assert.ok(rev.files['src/App.js']);
    assert.equal(rev.files['src/App.js'].content, 'export default function App() { return <h1>Updated</h1>; }');
    assert.equal(rev.files['src/App.js'].hash, computeSha256('export default function App() { return <h1>Updated</h1>; }'));

    // Vérifier que le summary du projet reflète la nouvelle révision
    const summary = service.getFilesSummary(tenantId, project.id, 'VIEWER');
    assert.equal(summary.currentRevisionId, rev.id);
    assert.equal(summary.revisionNumber, 1);

    // Vérifier l'audit
    const audits = auditStore.query(tenantId, { action: 'REVISION_FROM_TREE' });
    assert.equal(audits.length, 1);
  });

  it('doit bloquer impitoyablement les tentatives de Path Traversal (..)', () => {
    assert.throws(
      () => service.createFile(tenantId, project.id, { path: '../outside.txt', type: 'file' }, 'ENGINEER'),
      ValidationError
    );
    assert.throws(
      () => service.getFileContent(tenantId, project.id, 'src/../../etc/passwd', 'VIEWER'),
      ValidationError
    );
  });

  it('doit garantir l étanchéité multi-tenant pour toutes les opérations de fichiers', () => {
    assert.throws(
      () => service.getFilesSummary('autre_tenant', project.id, 'VIEWER'),
      NotFoundError
    );
    assert.throws(
      () => service.getFileContent('autre_tenant', project.id, 'package.json', 'VIEWER'),
      NotFoundError
    );
  });

  it('doit respecter strictement les permissions RBAC (VIEWER interdit en écriture)', () => {
    assert.throws(
      () => service.createFile(tenantId, project.id, { path: 'hacked.js', type: 'file' }, 'VIEWER'),
      ForbiddenError
    );
    assert.throws(
      () => service.deleteFile(tenantId, project.id, 'package.json', 'VIEWER'),
      ForbiddenError
    );
    assert.throws(
      () => service.commitTreeToRevision(tenantId, project.id, 'Commit interdit', 'viewer', undefined, 'VIEWER'),
      ForbiddenError
    );
  });
});
