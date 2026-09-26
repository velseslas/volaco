import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import {
  renderProjectPreview,
  writeFilesToTempDir,
  startStaticServer
} from '../../../src/ai-native/visual-intelligence/real-renderer.js';

/**
 * NOTE IMPORTANTE : ce fichier ne peut PAS tester le vrai lancement d'un
 * navigateur (Chromium), faute de navigateur disponible dans l'environnement
 * où ces tests ont été écrits. Il couvre tout ce qui peut l'être sans
 * navigateur : écriture des fichiers, serveur statique local, et validations
 * d'erreurs. Le lancement réel du navigateur DOIT être vérifié manuellement
 * sur une machine qui a Chromium installé (voir CORRECTIONS.md).
 */
describe('AINT-REAL-RENDER : Rendu Visuel Réel (Unit Tests - sans navigateur)', () => {
  const tempDirs: string[] = [];
  const servers: http.Server[] = [];

  after(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    for (const server of servers) {
      server.close();
    }
  });

  it('doit écrire les fichiers du projet dans un dossier temporaire', () => {
    const dir = writeFilesToTempDir({
      'index.html': '<html><body>Hello</body></html>',
      'src/app.js': 'console.log("hi");'
    });
    tempDirs.push(dir);

    assert.ok(existsSync(`${dir}/index.html`));
    assert.ok(existsSync(`${dir}/src/app.js`));
    assert.equal(readFileSync(`${dir}/index.html`, 'utf8'), '<html><body>Hello</body></html>');
  });

  it('doit servir les fichiers via un vrai serveur HTTP local', async () => {
    const dir = writeFilesToTempDir({
      'index.html': '<html><body>Test Serveur</body></html>'
    });
    tempDirs.push(dir);

    const { server, port } = await startStaticServer(dir);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/index.html`);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(text.includes('Test Serveur'));
  });

  it('doit renvoyer 404 pour un fichier inexistant', async () => {
    const dir = writeFilesToTempDir({ 'index.html': '<html></html>' });
    tempDirs.push(dir);

    const { server, port } = await startStaticServer(dir);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/fichier-absent.js`);
    assert.equal(response.status, 404);
  });

  it('doit rejeter une tentative de sortir du dossier servi (path traversal)', async () => {
    const dir = writeFilesToTempDir({ 'index.html': '<html></html>' });
    tempDirs.push(dir);

    const { server, port } = await startStaticServer(dir);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/../../../../etc/passwd`);
    assert.ok(response.status === 403 || response.status === 404);
  });

  it('doit rejeter un projet sans aucun fichier', async () => {
    await assert.rejects(() => renderProjectPreview({}), /Aucun fichier/);
  });

  it('doit rejeter un fichier d entrée introuvable, avant de tenter de lancer un navigateur', async () => {
    await assert.rejects(
      () => renderProjectPreview({ 'style.css': 'body{}' }, { entryFile: 'index.html' }),
      /introuvable/
    );
  });
});
