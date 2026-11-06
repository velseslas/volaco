/**
 * MCP-C3.2 — Surface /api/v1/mcp/remote-servers en mode AUTH STRICTE
 * (VOLACO_STRICT_AUTH=1, posé AVANT tout import) :
 *   - « utilisateur non authentifié » → 401 UnauthorizedError (repli dev
 *     x-tenant-id/x-user-role REFUSED dans ce mode — auth.ts l.114-129) ;
 *   - avec Bearer VOLACO_API_KEY valide → context OWNER studio-local :
 *     le tenant est dérivé du contexte authentifié, jamais du client.
 *
 * Le module d'isolation mun-des écritures hors dépôt reste le PREMIER import
 * parmi les modules projet ; les variables d'environnement de sécurité sont
 * posées AVANT celui-ci (aucune évaluation projet ne les devine).
 */

import './_lot-b-secret-env.js';

process.env.VOLACO_STRICT_AUTH = '1';
process.env.VOLACO_API_KEY = 'key-c32-strict-' + 'a'.repeat(16);

// MCP-TEST-ISOLATION-001 — s'exécute DÈS son évaluation (avant les modules
// projet, cf. mémoire du module) : VOLACO_DATA_DIR = mkdtemp hors dépôt.
import { isolatedVolacoDataDir } from './mcp-remote-isolated-env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setMcpRemoteRuntimeForTests } from '../src/routes/mcp-remote.js';
import { RemoteMcpConnectorStore } from '../../../packages/core/src/mcp/remote/store.js';
import { RemoteMcpSecretCipher, createRemoteMcpKeyRing } from '../../../packages/core/src/mcp/remote/crypto.js';

const DATA_DIR = isolatedVolacoDataDir;
const BASE = '/api/v1/mcp/remote-servers';
const STRICT_URL_OK = 'https://strict-c32.example.org/mcp';
const STRICT_SECRET = 'tok_strict_' + randomBytes(10).toString('hex');

let baseUrl = '';
let server: Server | undefined;
let strictStore: RemoteMcpConnectorStore;

async function call(path: string, method: string, headers: Record<string, string>, payload?: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
  });
  const text = await res.text();
  return { status: res.status, text };
}

describe('MCP-C3.2 strict-auth : remote-servers exige une authentification valide', () => {
  before(async () => {
    strictStore = new RemoteMcpConnectorStore(
      new RemoteMcpSecretCipher(createRemoteMcpKeyRing({ active: { keyId: 'c32-strict', key: randomBytes(32) } }))
    );
    setMcpRemoteRuntimeForTests({ connectorStore: () => strictStore });
    const { createApiServer } = await import('../src/server.js');
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server!.listen(0, () => {
        const address = server!.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    setMcpRemoteRuntimeForTests(null);
    await new Promise<void>((resolve) => {
      if (server !== undefined) server.close(() => resolve());
      else resolve();
    });
    try {
      rmSync(DATA_DIR, { recursive: true, force: true });
    } catch {
      // Windows : SQLite ouverte — purge OS du répertoire temporaire.
    }
  });

  it('C32-S1 non authentifié : toutes les routes du contrat → 401 (aucun repli dev)', async () => {
    const noAuth = { 'Content-Type': 'application/json' };
    const list = await call(BASE, 'GET', noAuth);
    assert.equal(list.status, 401);
    const created = await call(BASE, 'POST', noAuth, { name: 's', url: STRICT_URL_OK });
    assert.equal(created.status, 401);
    const one = await call(`${BASE}/id-inexistant`, 'GET', noAuth);
    assert.equal(one.status, 401);
    const patched = await call(`${BASE}/id-inexistant`, 'PATCH', noAuth, { enabled: true });
    assert.equal(patched.status, 401);
    const deleted = await call(`${BASE}/id-inexistant`, 'DELETE', noAuth);
    assert.equal(deleted.status, 401);
    // Le refus ne reflète RIEN de la demande : ni URL cible, ni payload.
    assert.ok(!created.text.includes(STRICT_URL_OK), 'aucune URL cible reflétée');
  });

  it('C32-S2 Bearer API KEY valide → OWNER studio-local tenanced : cycle CRUD minimal', async () => {
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${'key-c32-strict-' + 'a'.repeat(16)}` };
    const created = await call(BASE, 'POST', H, { name: 'Serveur Strict', url: STRICT_URL_OK, secret: STRICT_SECRET });
    assert.equal(created.status, 201);
    assert.ok(!created.text.includes(STRICT_SECRET), 'secret jamais rendu');
    const view = await call(BASE, 'GET', H);
    assert.equal(view.status, 200);
    assert.ok(view.text.includes('Serveur Strict'), 'le serveur existe chez le tenant authentifié');
    const left = await call(BASE, 'GET', { 'x-tenant-id': 'tenant-strict-gratuit', 'x-user-role': 'OWNER' });
    // En mode strict le repli dev est REFUSÉ : même sans Bearer, on reste 401.
    assert.equal(left.status, 401, 'le repli par en-têtes reste interdit');
  });
});
