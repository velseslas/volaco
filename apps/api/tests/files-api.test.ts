import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';
import { fileStore } from '../../../packages/core/src/file-explorer/store.js';

interface FilesSummaryResponse {
  summary: {
    tenantId: string;
    projectId: string;
    totalFiles: number;
    totalDirectories: number;
    tree: Array<{
      path: string;
      name: string;
      type: string;
      sizeBytes?: number;
    }>;
  };
  requestId: string;
}

interface FileContentResponse {
  file: {
    path: string;
    name: string;
    content: string;
    sizeBytes: number;
  };
  requestId: string;
}

describe('CORE-003 : File Explorer API Integration Tests', () => {
  let server: Server;
  let baseUrl: string;
  const tenantId = 'tenant_fe_api_01';
  let projectId: string;

  before(async () => {
    projectStore.clear();
    fileStore.clear();
    const proj = projectStore.createProject(tenantId, 'Project API Files');
    projectId = proj.id;

    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    projectStore.clear();
    fileStore.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('doit renvoyer l arborescence initiale avec index.html', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files`, {
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as FilesSummaryResponse;
    assert.equal(body.summary.tenantId, tenantId);
    assert.equal(body.summary.projectId, projectId);
    assert.equal(body.summary.totalFiles, 1);
    assert.equal(body.summary.tree[0]!.name, 'index.html');
  });

  it('doit renvoyer le contenu d un fichier via son chemin', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=index.html`, {
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as FileContentResponse;
    assert.equal(body.file.path, 'index.html');
    assert.ok(body.file.content.includes('<!DOCTYPE html>'));
  });

  it('doit créer un nouveau fichier dans un sous-dossier', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({
        path: 'src/main.js',
        type: 'file',
        content: 'console.log("Hello from main.js");'
      })
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as { file: { path: string; name: string } };
    assert.equal(body.file.path, 'src/main.js');
    assert.equal(body.file.name, 'main.js');

    // Vérifier la présence dans l'arborescence
    const treeRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files`, {
      headers: { 'x-tenant-id': tenantId, 'x-user-role': 'VIEWER' }
    });
    const treeBody = (await treeRes.json()) as FilesSummaryResponse;
    assert.equal(treeBody.summary.totalFiles, 2);
  });

  it('doit renommer un fichier existant', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/rename`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({
        oldPath: 'src/main.js',
        newPath: 'src/index.js'
      })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { file: { path: string } };
    assert.equal(body.file.path, 'src/index.js');
  });

  it('doit supprimer un fichier', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files?path=src/index.js`, {
      method: 'DELETE',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { success: boolean; deletedPath: string };
    assert.equal(body.success, true);
    assert.equal(body.deletedPath, 'src/index.js');
  });

  it('doit rejeter l accès par un locataire non autorisé', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files`, {
      headers: {
        'x-tenant-id': 'tenant_pirate',
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 404);
  });

  it('doit commiter l arbre de fichiers dans une révision FND-004 via POST /files/commit (CAPP-002)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER'
      },
      body: JSON.stringify({ message: 'Commit API Tree CAPP-002', author: 'lead-dev' })
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.ok(body.revision);
    assert.equal(body.revision.message, 'Commit API Tree CAPP-002');
    assert.equal(body.revision.author, 'lead-dev');
    assert.ok(body.revision.files['index.html']);
  });

  // --- Tests CAPP-003 : File Content & Edit Operations via HTTP API ---
  it('CAPP-003 : doit déplacer un fichier via POST /files/move', async () => {
    // 1. Créer un fichier source
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, 'x-user-role': 'ENGINEER' },
      body: JSON.stringify({ path: 'temp/to_move.txt', type: 'file', content: 'hello move' })
    });

    // 2. Déplacer via POST /files/move
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, 'x-user-role': 'ENGINEER' },
      body: JSON.stringify({ oldPath: 'temp/to_move.txt', newPath: 'final/moved.txt' })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.file.path, 'final/moved.txt');

    // 3. Vérifier le contenu à la nouvelle destination
    const checkRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=final/moved.txt`, {
      headers: { 'x-tenant-id': tenantId, 'x-user-role': 'VIEWER' }
    });
    assert.equal(checkRes.status, 200);
    const checkBody = (await checkRes.json()) as any;
    assert.equal(checkBody.file.content, 'hello move');
  });

  it('CAPP-003 : doit exécuter les 7 opérations de fichiers via POST /files/operation', async () => {
    // 1. CREATE_FILE
    const resCreate = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/operation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, 'x-user-role': 'ENGINEER' },
      body: JSON.stringify({ type: 'CREATE_FILE', path: 'src/op_test.js', content: 'const a = 1;' })
    });
    assert.equal(resCreate.status, 200);
    const createBody = (await resCreate.json()) as any;
    assert.equal(createBody.result.operation, 'CREATE_FILE');
    assert.equal(createBody.result.success, true);

    // 2. UPDATE_FILE
    const resUpdate = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/operation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, 'x-user-role': 'ENGINEER' },
      body: JSON.stringify({ type: 'UPDATE_FILE', path: 'src/op_test.js', content: 'const a = 2;' })
    });
    assert.equal(resUpdate.status, 200);
    const updateBody = (await resUpdate.json()) as any;
    assert.equal(updateBody.result.operation, 'UPDATE_FILE');
    assert.equal(updateBody.result.file.content, 'const a = 2;');

    // 3. RENAME_FILE
    const resRename = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/operation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, 'x-user-role': 'ENGINEER' },
      body: JSON.stringify({ type: 'RENAME_FILE', path: 'src/op_test.js', newPath: 'src/op_renamed.js' })
    });
    assert.equal(resRename.status, 200);
    const renameBody = (await resRename.json()) as any;
    assert.equal(renameBody.result.operation, 'RENAME_FILE');
    assert.equal(renameBody.result.newPath, 'src/op_renamed.js');

    // 4. MOVE_FILE
    const resMove = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/operation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, 'x-user-role': 'ENGINEER' },
      body: JSON.stringify({ type: 'MOVE_FILE', path: 'src/op_renamed.js', newPath: 'dist_test/moved.js' })
    });
    assert.equal(resMove.status, 200);
    const moveBody = (await resMove.json()) as any;
    assert.equal(moveBody.result.operation, 'MOVE_FILE');

    // 5. DELETE_FILE
    const resDelete = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/operation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, 'x-user-role': 'ENGINEER' },
      body: JSON.stringify({ type: 'DELETE_FILE', path: 'dist_test/moved.js' })
    });
    assert.equal(resDelete.status, 200);
    const deleteBody = (await resDelete.json()) as any;
    assert.equal(deleteBody.result.operation, 'DELETE_FILE');

    // 6. CREATE_DIRECTORY
    const resDir = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/operation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, 'x-user-role': 'ENGINEER' },
      body: JSON.stringify({ type: 'CREATE_DIRECTORY', path: 'src/api_dir' })
    });
    assert.equal(resDir.status, 200);
    const dirBody = (await resDir.json()) as any;
    assert.equal(dirBody.result.operation, 'CREATE_DIRECTORY');

    // 7. DELETE_DIRECTORY
    const resRmDir = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/operation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, 'x-user-role': 'ENGINEER' },
      body: JSON.stringify({ type: 'DELETE_DIRECTORY', path: 'src/api_dir' })
    });
    assert.equal(resRmDir.status, 200);
    const rmdirBody = (await resRmDir.json()) as any;
    assert.equal(rmdirBody.result.operation, 'DELETE_DIRECTORY');
  });

  it('CAPP-003 : doit rejeter les opérations modificatrices pour le rôle VIEWER (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/operation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, 'x-user-role': 'VIEWER' },
      body: JSON.stringify({ type: 'CREATE_FILE', path: 'src/forbidden.js', content: 'nope' })
    });

    assert.equal(res.status, 403);
  });

  it('CAPP-003 : doit bloquer les chemins path traversal (400 Bad Request)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/operation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, 'x-user-role': 'ENGINEER' },
      body: JSON.stringify({ type: 'CREATE_FILE', path: '../secret.txt', content: 'bad' })
    });

    assert.equal(res.status, 400);
  });
});

