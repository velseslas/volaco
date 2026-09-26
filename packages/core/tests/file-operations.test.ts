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
  type FileOperation,
  type AuditEvent
} from '../src/index.js';

describe('CAPP-003 : File Content & Edit Operations Unit Tests', () => {
  let projectStore: ProjectStore;
  let fileStore: FileStore;
  let auditStore: AuditStore;
  let revisionStore: RevisionStore;
  let service: FileExplorerService;
  const tenantId = 'tenant_capp003';
  let project: { id: string; name: string };

  beforeEach(() => {
    projectStore = new ProjectStore();
    fileStore = new FileStore();
    auditStore = new AuditStore();
    revisionStore = new RevisionStore();
    service = new FileExplorerService(projectStore, fileStore, auditStore, revisionStore);
    project = projectStore.createProject(tenantId, 'Project CAPP-003', 'Test operations');
    service.initializeStandardTree(tenantId, project.id, 'ENGINEER');
  });

  // --- Opération 1 : CREATE_FILE ---
  it('1. CREATE_FILE : doit créer un nouveau fichier avec contenu et hash valide', () => {
    const res = service.executeOperation(
      tenantId,
      project.id,
      {
        type: 'CREATE_FILE',
        path: 'src/utils/math.js',
        content: 'export const add = (a, b) => a + b;'
      },
      'ENGINEER',
      'req_op_create'
    );

    assert.equal(res.operation, 'CREATE_FILE');
    assert.equal(res.success, true);
    assert.equal(res.path, 'src/utils/math.js');
    assert.ok(res.node);
    assert.equal(res.node.type, 'file');

    // Vérifier la lecture du fichier
    const file = service.getFileContent(tenantId, project.id, 'src/utils/math.js', 'VIEWER');
    assert.equal(file.content, 'export const add = (a, b) => a + b;');
    assert.ok(file.hash && file.hash.length === 64);
  });

  // --- Opération 2 : UPDATE_FILE ---
  it('2. UPDATE_FILE : doit modifier le contenu d un fichier existant et recalculer le hash', () => {
    const originalFile = service.getFileContent(tenantId, project.id, 'package.json', 'VIEWER');
    const updatedContent = '{\n  "name": "my-updated-app",\n  "version": "1.0.0"\n}\n';

    const res = service.executeOperation(
      tenantId,
      project.id,
      {
        type: 'UPDATE_FILE',
        path: 'package.json',
        content: updatedContent
      },
      'ENGINEER',
      'req_op_update'
    );

    assert.equal(res.operation, 'UPDATE_FILE');
    assert.equal(res.success, true);
    assert.ok(res.file);
    assert.equal(res.file.content, updatedContent);
    assert.notEqual(res.file.hash, originalFile.hash);

    // Vérifier la persistance
    const readAgain = service.getFileContent(tenantId, project.id, 'package.json', 'VIEWER');
    assert.equal(readAgain.content, updatedContent);
  });

  it('2b. UPDATE_FILE : doit échouer avec NotFoundError si le fichier n existe pas', () => {
    assert.throws(
      () => {
        service.executeOperation(
          tenantId,
          project.id,
          {
            type: 'UPDATE_FILE',
            path: 'src/non_existent.js',
            content: 'console.log("ghost");'
          },
          'ENGINEER'
        );
      },
      (err: unknown) => err instanceof NotFoundError
    );
  });

  // --- Opération 3 : DELETE_FILE ---
  it('3. DELETE_FILE : doit supprimer un fichier existant', () => {
    const res = service.executeOperation(
      tenantId,
      project.id,
      {
        type: 'DELETE_FILE',
        path: 'README.md'
      },
      'ENGINEER',
      'req_op_delete'
    );

    assert.equal(res.operation, 'DELETE_FILE');
    assert.equal(res.success, true);
    assert.equal(res.deletedPath, 'README.md');

    // Vérifier que le fichier n'est plus accessible
    assert.throws(
      () => service.getFileContent(tenantId, project.id, 'README.md', 'VIEWER'),
      (err: unknown) => err instanceof NotFoundError
    );
  });

  // --- Opération 4 : CREATE_DIRECTORY ---
  it('4. CREATE_DIRECTORY : doit créer un nouveau dossier', () => {
    const res = service.executeOperation(
      tenantId,
      project.id,
      {
        type: 'CREATE_DIRECTORY',
        path: 'src/services'
      },
      'ENGINEER',
      'req_op_mkdir'
    );

    assert.equal(res.operation, 'CREATE_DIRECTORY');
    assert.equal(res.success, true);
    assert.ok(res.node);
    assert.equal(res.node.type, 'directory');

    // Vérifier présence dans l'arbre
    const summary = service.getFilesSummary(tenantId, project.id, 'VIEWER');
    const srcNode = summary.tree.find(n => n.name === 'src');
    const childNames = srcNode?.children?.map(c => c.name) || [];
    assert.ok(childNames.includes('services'));
  });

  // --- Opération 5 : DELETE_DIRECTORY ---
  it('5. DELETE_DIRECTORY : doit supprimer un dossier et tous ses sous-fichiers en cascade', () => {
    // Créer d'abord un sous-fichier
    service.executeOperation(
      tenantId,
      project.id,
      {
        type: 'CREATE_FILE',
        path: 'src/components/Header.js',
        content: 'export default function Header() { return <header />; }'
      },
      'ENGINEER'
    );

    const res = service.executeOperation(
      tenantId,
      project.id,
      {
        type: 'DELETE_DIRECTORY',
        path: 'src/components'
      },
      'ENGINEER',
      'req_op_rmdir'
    );

    assert.equal(res.operation, 'DELETE_DIRECTORY');
    assert.equal(res.success, true);
    assert.equal(res.deletedPath, 'src/components');

    // Vérifier que ni le dossier ni le sous-fichier n'existent plus
    assert.throws(
      () => service.getFileContent(tenantId, project.id, 'src/components/Header.js', 'VIEWER'),
      (err: unknown) => err instanceof NotFoundError
    );

    const summary = service.getFilesSummary(tenantId, project.id, 'VIEWER');
    const srcNode = summary.tree.find(n => n.name === 'src');
    const childNames = srcNode?.children?.map(c => c.name) || [];
    assert.ok(!childNames.includes('components'));
  });

  // --- Opération 6 : MOVE_FILE ---
  it('6. MOVE_FILE : doit déplacer un fichier vers une nouvelle destination avec création auto des dossiers parents', () => {
    const originalContent = service.getFileContent(tenantId, project.id, 'src/App.js', 'VIEWER').content;

    const res = service.executeOperation(
      tenantId,
      project.id,
      {
        type: 'MOVE_FILE',
        path: 'src/App.js',
        newPath: 'src/views/MainApp.js'
      },
      'ENGINEER',
      'req_op_move'
    );

    assert.equal(res.operation, 'MOVE_FILE');
    assert.equal(res.success, true);
    assert.equal(res.path, 'src/App.js');
    assert.equal(res.newPath, 'src/views/MainApp.js');

    // Ancien chemin supprimé
    assert.throws(
      () => service.getFileContent(tenantId, project.id, 'src/App.js', 'VIEWER'),
      (err: unknown) => err instanceof NotFoundError
    );

    // Nouveau chemin disponible avec contenu intact
    const movedFile = service.getFileContent(tenantId, project.id, 'src/views/MainApp.js', 'VIEWER');
    assert.equal(movedFile.content, originalContent);
  });

  it('6b. MOVE_FILE : doit déplacer un dossier entier et propager récursivement les chemins enfants', () => {
    // Créer des fichiers dans un dossier src/widgets
    service.executeOperation(
      tenantId,
      project.id,
      { type: 'CREATE_FILE', path: 'src/widgets/Button.js', content: 'export const Button = () => null;' },
      'ENGINEER'
    );
    service.executeOperation(
      tenantId,
      project.id,
      { type: 'CREATE_FILE', path: 'src/widgets/Card.js', content: 'export const Card = () => null;' },
      'ENGINEER'
    );

    // Déplacer src/widgets vers src/ui
    const res = service.executeOperation(
      tenantId,
      project.id,
      {
        type: 'MOVE_FILE',
        path: 'src/widgets',
        newPath: 'src/ui'
      },
      'ENGINEER'
    );

    assert.equal(res.operation, 'MOVE_FILE');
    assert.equal(res.success, true);

    // Vérifier que les enfants ont été migrés
    const btn = service.getFileContent(tenantId, project.id, 'src/ui/Button.js', 'VIEWER');
    const card = service.getFileContent(tenantId, project.id, 'src/ui/Card.js', 'VIEWER');
    assert.equal(btn.content, 'export const Button = () => null;');
    assert.equal(card.content, 'export const Card = () => null;');

    // Vérifier que les anciens chemins n'existent plus
    assert.throws(() => service.getFileContent(tenantId, project.id, 'src/widgets/Button.js', 'VIEWER'));
  });

  it('6c. MOVE_FILE : doit interdire de déplacer un dossier dans lui-même', () => {
    assert.throws(
      () => {
        service.executeOperation(
          tenantId,
          project.id,
          {
            type: 'MOVE_FILE',
            path: 'src',
            newPath: 'src/sub_src'
          },
          'ENGINEER'
        );
      },
      (err: unknown) => err instanceof ValidationError
    );
  });

  // --- Opération 7 : RENAME_FILE ---
  it('7. RENAME_FILE : doit renommer un fichier dans le même dossier', () => {
    const res = service.executeOperation(
      tenantId,
      project.id,
      {
        type: 'RENAME_FILE',
        path: 'README.md',
        newPath: 'DOCUMENTATION.md'
      },
      'ENGINEER',
      'req_op_rename'
    );

    assert.equal(res.operation, 'RENAME_FILE');
    assert.equal(res.success, true);
    assert.equal(res.newPath, 'DOCUMENTATION.md');

    // Vérifier l'accès avec le nouveau nom
    const file = service.getFileContent(tenantId, project.id, 'DOCUMENTATION.md', 'VIEWER');
    assert.ok(file.content.includes('# My App'));
  });

  // --- Sécurité : Anti-Path Traversal ---
  it('8. Sécurité : doit bloquer toute tentative de Path Traversal (..) sur toutes les opérations', () => {
    const maliciousPaths = [
      '../secret.env',
      'src/../../etc/passwd',
      '..\\windows\\system32',
      'foo/bar/../../../root.txt',
      'src/\0malicious.js'
    ];

    for (const badPath of maliciousPaths) {
      assert.throws(
        () => {
          service.executeOperation(
            tenantId,
            project.id,
            { type: 'CREATE_FILE', path: badPath, content: 'hack' },
            'ENGINEER'
          );
        },
        (err: unknown) => err instanceof ValidationError,
        `Aurait dû bloquer le chemin traversal: ${badPath}`
      );
    }
  });

  // --- Sécurité : Isolation Multi-Tenant ---
  it('9. Isolation Multi-Tenant : un locataire tiers ne peut ni lire ni manipuler les fichiers d un autre locataire', () => {
    const pirateTenant = 'tenant_pirate';

    // Tentative de lecture
    assert.throws(
      () => service.getFileContent(pirateTenant, project.id, 'package.json', 'VIEWER'),
      (err: unknown) => err instanceof NotFoundError
    );

    // Tentative d'opération
    assert.throws(
      () => {
        service.executeOperation(
          pirateTenant,
          project.id,
          { type: 'DELETE_FILE', path: 'package.json' },
          'ADMIN'
        );
      },
      (err: unknown) => err instanceof NotFoundError
    );
  });

  // --- Sécurité : Permissions RBAC ---
  it('10. RBAC : un VIEWER ne peut exécuter aucune opération modificatrice (ForbiddenError)', () => {
    const ops: FileOperation[] = [
      { type: 'CREATE_FILE', path: 'src/hack.js', content: 'fail' },
      { type: 'UPDATE_FILE', path: 'package.json', content: '{}' },
      { type: 'DELETE_FILE', path: 'package.json' },
      { type: 'CREATE_DIRECTORY', path: 'src/hack_dir' },
      { type: 'DELETE_DIRECTORY', path: 'src' },
      { type: 'MOVE_FILE', path: 'package.json', newPath: 'pkg.json' },
      { type: 'RENAME_FILE', path: 'package.json', newPath: 'pkg.json' }
    ];

    for (const op of ops) {
      assert.throws(
        () => service.executeOperation(tenantId, project.id, op, 'VIEWER'),
        (err: unknown) => err instanceof ForbiddenError,
        `VIEWER ne doit pas pouvoir exécuter l opération ${op.type}`
      );
    }
  });

  // --- Observabilité : Traçabilité Audit ---
  it('11. Observabilité : doit enregistrer les événements d audit pour chaque opération avec requestId', () => {
    service.executeOperation(
      tenantId,
      project.id,
      { type: 'CREATE_FILE', path: 'src/audited.js', content: '// audited' },
      'ENGINEER',
      'req_audit_test_1'
    );

    const logs = auditStore.query(tenantId);
    const opLog = logs.find((l: AuditEvent) => l.requestId === 'req_audit_test_1' && l.action === 'FILE_OPERATION');
    const createLog = logs.find((l: AuditEvent) => l.requestId === 'req_audit_test_1' && l.action === 'FILE_CREATE');

    assert.ok(opLog, 'Un log d audit avec l action FILE_OPERATION doit exister');
    assert.equal(opLog.status, 'SUCCESS');
    assert.equal(opLog.metadata?.['operation'], 'CREATE_FILE');
    assert.equal(opLog.metadata?.['path'], 'src/audited.js');

    assert.ok(createLog, 'Un log d audit avec l action FILE_CREATE doit exister');
    assert.equal(createLog.status, 'SUCCESS');
    assert.equal(createLog.metadata?.['path'], 'src/audited.js');
  });
});
