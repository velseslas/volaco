/**
 * C3.2-B1 — Tests d'intégration des routes /api/v1/mcp-remote/* :
 *   - matrice RBAC réelle (TENANT_MANAGE gestion / PROJECT_READ lecture) ;
 *   - isolation tenant stricte côté serveur (404 indiscernable) ;
 *   - secret jamais exposé ni journalisé ;
 *   - refus SSRF des URLs (création + PATCH, aucune écriture partielle) ;
 *   - décision D3 : PATCH url → révocation atomique de toutes les politiques ;
 *   - test de connexion via client INJECTÉ (stub) : plomberie du bearer,
 *     erreurs transport traitées sans 5xx, connecteur désactivé testable
 *     (D5) mais jamais activé automatiquement ;
 *   - journal : actions whitelistées, aucun secret dans metadata ;
 *   - suppression en cascade (politiques purgées, 404 ensuite).
 *
 * Harnais : serveur HTTP réel (createApiServer port 0) + fetch, identique à
 * mcp-project-validation.test.ts. L'auth utilise le repli dev (en-têtes
 * x-tenant-id/x-user-role) — contexte dev uniquement : les chemins
 * JWT/production gardent leur comportement strict inchangé.
 *
 * ISOLATION DE PERSISTANCE : `server.js` est importé DYNAMIQUEMENT,
 * UNIQUEMENT APRÈS avoir fixé VOLACO_DATA_DIR (répertoire temporaire neuf) :
 * les singletons construits dans la chaîne d'import (audit/users/projets)
 * ne peuvent jamais viser la base réelle du poste. AUCUN appel réseau réel :
 * tout /test passe par l'usine de client injectée (stubs), avant tout usage.
 */

// MCP-TEST-ISOLATION-001 — Doit rester le PREMIER import de la suite : ce
// module fixe VOLACO_DATA_DIR (mkdtemp hors dépôt) dès son évaluation, AVANT
// l'évaluation de la grappe d'imports projet. Sinon les singletons auditStore
// (observability/audit.ts:134) et userStore (identity/user-store.ts:95),
// construits au corps de module, lient volaco.db du CWD (Y:\.volaco-data)
// dès l'import des routes/user-store et les fixtures quittent le répertoire
// isolé. Cf. ./mcp-remote-isolated-env.ts.
import './_lot-b-legacy-env.js';

import { isolatedVolacoDataDir } from './mcp-remote-isolated-env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setMcpRemoteRuntimeForTests } from '../src/routes/mcp-remote.js';
import { RemoteMcpConnectorStore, RemoteMcpStoreError } from '../../../packages/core/src/mcp/remote/store.js';
import type { RemoteMcpClientOptions, RemoteMcpHttpClient } from '../../../packages/core/src/mcp/remote/client.js';
import { RemoteMcpClientError, REMOTE_MCP_MAX_TIMEOUT_MS } from '../../../packages/core/src/mcp/remote/client.js';
import { RemoteMcpSecretCipher, createRemoteMcpKeyRing } from '../../../packages/core/src/mcp/remote/crypto.js';

/** MCP-TEST-ISOLATION-001 : DATA_DIR = répertoire mkdtemp neuf fourni par le
 * module d'isolement (importé en premier) — VOLACO_DATA_DIR y est déjà fixé à
 * ce stade. Le rmSync final (after) reste inchangé. */
const DATA_DIR = isolatedVolacoDataDir;

const T_MANAGER = 'studio-local'; // tenant des opérations de gestion
const T_FOREIGN = 'tenant-etranger-b1'; // autre tenant (isolation)

const H_OWNER = { 'Content-Type': 'application/json', 'x-tenant-id': T_MANAGER, 'x-user-role': 'OWNER' };
const H_ADMIN = { 'Content-Type': 'application/json', 'x-tenant-id': T_MANAGER, 'x-user-role': 'ADMIN' };
const H_ENGINEER = { 'Content-Type': 'application/json', 'x-tenant-id': T_MANAGER, 'x-user-role': 'ENGINEER' };
const H_VIEWER = { 'Content-Type': 'application/json', 'x-tenant-id': T_MANAGER, 'x-user-role': 'VIEWER' };
const H_FOREIGN = { 'Content-Type': 'application/json', 'x-tenant-id': T_FOREIGN, 'x-user-role': 'OWNER' };

const SECRET_PLAINTEXT = 'tok_' + randomBytes(16).toString('hex') + '_b1secret';
const SECRET_PLAINTEXT_2 = SECRET_PLAINTEXT + '_2';
const URL_OK_1 = 'https://api-b1.example.org/mcp';
const URL_OK_2 = 'https://api-b1-alt.example.org/mcp';
const SCHEMA_T = 'c'.repeat(64);

let baseUrl = '';
let server: Server | undefined;
let b1Store: RemoteMcpConnectorStore;
const capturedOptions: RemoteMcpClientOptions[] = [];

interface JsonOut { status: number; text: string; body: unknown }

async function call(
  path: string,
  method: string,
  headers: Record<string, string>,
  payload?: unknown
): Promise<JsonOut> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, text, body };
}

function errorBody(out: JsonOut): { code?: string; message?: string } {
  const record = out.body as { error?: { code?: string; message?: string } } | null;
  return record?.error ?? {};
}

function clientStubFrom(initializeImpl: () => Promise<unknown>): RemoteMcpHttpClient {
  return {
    initialize: async () => await initializeImpl()
  } as unknown as RemoteMcpHttpClient;
}

describe('C3.2-B1 : routes /api/v1/mcp-remote (gestion, test, journal)', () => {
  before(async () => {
    b1Store = new RemoteMcpConnectorStore(
      new RemoteMcpSecretCipher(createRemoteMcpKeyRing({ active: { keyId: 'b1', key: randomBytes(32) } }))
    );
    setMcpRemoteRuntimeForTests({ connectorStore: () => b1Store });
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
      // Windows : fichier SQLite encore ouvert par node:sqlite — répertoire
      // temporaire système, purge OS. Aucun échec de test de nettoyage.
    }
  });

  /* ---- RBAC (matrice réelle) ---- */

  it('B1-1 gestion interdite à ENGINEER/VIEWER (403 sur toutes les routes de gestion)', async () => {
    for (const headers of [H_ENGINEER, H_VIEWER]) {
      const created = await call('/api/v1/mcp-remote/connectors', 'POST', headers, { name: 'x', url: URL_OK_1 });
      assert.equal(created.status, 403);
      const patched = await call('/api/v1/mcp-remote/connectors/id-inconnu-b1', 'PATCH', headers, { enabled: true });
      assert.equal(patched.status, 403);
      const tested = await call('/api/v1/mcp-remote/connectors/id-inconnu-b1/test', 'POST', headers);
      assert.equal(tested.status, 403);
      const secreted = await call('/api/v1/mcp-remote/connectors/id-inconnu-b1/secret', 'PUT', headers, { secret: 'tok' });
      assert.equal(secreted.status, 403);
      const deleted = await call('/api/v1/mcp-remote/connectors/id-inconnu-b1', 'DELETE', headers);
      assert.equal(deleted.status, 403);
    }
  });

  it('B1-2 lecture autorisée VIEWER/ENGINEER (PROJECT_READ) ; ADMIN ne gère PAS (TENANT_MANAGE=OWNER)', async () => {
    const list = await call('/api/v1/mcp-remote/connectors', 'GET', H_VIEWER);
    assert.equal(list.status, 200);
    assert.ok(Array.isArray((list.body as { connectors: unknown[] }).connectors));
    const journal = await call('/api/v1/mcp-remote/journal', 'GET', H_VIEWER);
    assert.equal(journal.status, 200);
    const adminCreate = await call('/api/v1/mcp-remote/connectors', 'POST', H_ADMIN, { name: 'admin-non', url: URL_OK_1 });
    assert.equal(adminCreate.status, 403);
  });

  /* ---- Validation d'entrée / SSRF ---- */

  it('B1-3 création : refus 400 pour nom/URL/secret invalides, aucune écriture', async () => {
    const beforeList = await call('/api/v1/mcp-remote/connectors', 'GET', H_OWNER);
    const beforeCount = (beforeList.body as { connectors: unknown[] }).connectors.length;
    const bad: Array<{ payload: unknown; label: string }> = [
      { payload: { url: URL_OK_1 }, label: 'name manquant' },
      { payload: { name: '', url: URL_OK_1 }, label: 'name vide' },
      { payload: { name: 'a'.repeat(65), url: URL_OK_1 }, label: 'name trop long' },
      { payload: { name: 'ok', url: 'http://127.0.0.1:8080/mcp' }, label: 'URL loopback (SSRF)' },
      { payload: { name: 'ok', url: 'http://api-b1.example.org/mcp' }, label: 'URL non https' },
      { payload: { name: 'ok', url: 'https://169.254.169.254/latest/meta-data' }, label: 'URL métadonnées cloud' },
      { payload: { name: 'ok', url: 42 }, label: 'URL non chaîne' },
      { payload: { name: 'ok', url: URL_OK_1, secret: '' }, label: 'secret vide' },
      { payload: { name: 'ok', url: URL_OK_1, secret: 'tok\nauth' }, label: 'secret avec saut de ligne' }
    ];
    for (const item of bad) {
      const out = await call('/api/v1/mcp-remote/connectors', 'POST', H_OWNER, item.payload);
      assert.equal(out.status, 400, `cas ${item.label} attendu 400`);
      assert.equal(errorBody(out).code, 'VALIDATION_ERROR');
    }
    const afterList = await call('/api/v1/mcp-remote/connectors', 'GET', H_OWNER);
    const afterCount = (afterList.body as { connectors: unknown[] }).connectors.length;
    assert.equal(afterCount, beforeCount, 'aucun connecteur résiduel après refus');
  });

  let connectorId = '';

  it('B1-4 création valide : 201, enabled=false par défaut, secretPresent=false', async () => {
    const created = await call('/api/v1/mcp-remote/connectors', 'POST', H_OWNER, {
      name: 'b1 nominal',
      url: URL_OK_1,
      userId: 'valeur-corp-a-ignorer' // D7 : champ client ignoré, jamais sourcé
    });
    assert.equal(created.status, 201);
    const record = (created.body as { connector: Record<string, unknown> }).connector;
    assert.equal(record.enabled, false);
    assert.equal(record.transport, 'url');
    assert.equal(record.url, URL_OK_1);
    assert.equal(record.secretPresent, false);
    connectorId = String(record.connectorId);
    assert.match(connectorId, /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}$/);
  });

  /* ---- Secrets ---- */

  it('B1-5 secret posé puis JAMAIS révélé (masse : liste, item, journaux)', async () => {
    const put = await call(`/api/v1/mcp-remote/connectors/${connectorId}/secret`, 'PUT', H_OWNER, { secret: SECRET_PLAINTEXT });
    assert.equal(put.status, 200);
    const meta = (put.body as { secretMeta: { keyId: string; encryptedAt: string } }).secretMeta;
    assert.equal(meta.keyId, 'b1');
    assert.equal(put.text.includes(SECRET_PLAINTEXT), false, 'réponse PUT sans plaintext');

    const items = await Promise.all([
      call('/api/v1/mcp-remote/connectors', 'GET', H_OWNER),
      call(`/api/v1/mcp-remote/connectors/${connectorId}`, 'GET', H_OWNER),
      call('/api/v1/mcp-remote/journal', 'GET', H_OWNER)
    ]);
    for (const out of items) {
      assert.equal(out.status, 200);
      assert.equal(out.text.includes(SECRET_PLAINTEXT), false);
      assert.equal(out.text.includes('tok_'), false, 'aucun fragment du token exposé');
    }
    const record = (items[1].body as { connector: Record<string, unknown> }).connector;
    assert.equal(record.secretPresent, true);
    assert.equal(record.secretKeyId, 'b1');
  });

  it('B1-6 secret retiré : removed, second retrait 404, secretPresent=false', async () => {
    const removed = await call(`/api/v1/mcp-remote/connectors/${connectorId}/secret`, 'DELETE', H_OWNER);
    assert.equal(removed.status, 200);
    const again = await call(`/api/v1/mcp-remote/connectors/${connectorId}/secret`, 'DELETE', H_OWNER);
    assert.equal(again.status, 404);
    const record = await call(`/api/v1/mcp-remote/connectors/${connectorId}`, 'GET', H_OWNER);
    assert.equal((record.body as { connector: Record<string, unknown> }).connector.secretPresent, false);
    const unknown = await call('/api/v1/mcp-remote/connectors/id-inconnu-b1/secret', 'DELETE', H_OWNER);
    assert.equal(unknown.status, 404);
  });

  /* ---- PATCH, décision D3 + isolation ---- */

  it('B1-7 PATCH URL valide : revokedToolNames retourné, politiques REVOKED (D3)', async () => {
    b1Store.setConnectorSecret(T_MANAGER, connectorId, SECRET_PLAINTEXT_2);
    b1Store.approveTool({ tenantId: T_MANAGER, connectorId, toolName: 'outil_b1', schemaSha256: SCHEMA_T, approvedBy: 'test-b1' });
    const patched = await call(`/api/v1/mcp-remote/connectors/${connectorId}`, 'PATCH', H_OWNER, { url: URL_OK_2 });
    assert.equal(patched.status, 200);
    const revoked = (patched.body as { revokedToolNames: string[] }).revokedToolNames;
    assert.deepEqual(revoked, ['outil_b1']);
    const view = (patched.body as { connector: { url: string; toolPolicies: Array<{ status: string }> } }).connector;
    assert.equal(view.url, URL_OK_2);
    assert.equal(view.toolPolicies.every((policy) => policy.status === 'REVOKED'), true);
    assert.equal(b1Store.getToolApproval(T_MANAGER, connectorId, 'outil_b1', SCHEMA_T), null);
  });

  it('B1-8 PATCH URL invalide : 400 sans réécriture ni révocation indue', async () => {
    b1Store.approveTool({ tenantId: T_MANAGER, connectorId, toolName: 'outil_avant_url_bad', schemaSha256: SCHEMA_T, approvedBy: 'test-b1' });
    const bad = await call(`/api/v1/mcp-remote/connectors/${connectorId}`, 'PATCH', H_OWNER, { url: 'http://example-b1.invalid/x' });
    assert.equal(bad.status, 400);
    assert.equal(errorBody(bad).code, 'VALIDATION_ERROR');
    const out = (await call(`/api/v1/mcp-remote/connectors/${connectorId}`, 'GET', H_OWNER)).body as {
      connector: { url: string; toolPolicies: Array<{ toolName: string; status: string }> };
    };
    assert.equal(out.connector.url, URL_OK_2, 'URL intacte après refus');
    assert.equal(
      out.connector.toolPolicies.some((policy) => policy.toolName === 'outil_avant_url_bad' && policy.status === 'APPROVED'),
      true,
      'approbation intacte après refus'
    );
  });

  it('B1-9 PATCH sans champ → 400 ; PATCH name+enabled → 200 ; id inconnu → 404', async () => {
    const empty = await call(`/api/v1/mcp-remote/connectors/${connectorId}`, 'PATCH', H_OWNER, {});
    assert.equal(empty.status, 400);
    const both = await call(`/api/v1/mcp-remote/connectors/${connectorId}`, 'PATCH', H_OWNER, { name: 'renommé b1', enabled: true });
    assert.equal(both.status, 200);
    const view = (both.body as { connector: { name: string; enabled: boolean } }).connector;
    assert.equal(view.name, 'renommé b1');
    assert.equal(view.enabled, true);
    const missing = await call('/api/v1/mcp-remote/connectors/id-inconnu-b1', 'PATCH', H_OWNER, { enabled: false });
    assert.equal(missing.status, 404);
  });

  it('B1-10 isolation : connecteur de studio-local invisible/inaltérable depuis un autre tenant', async () => {
    const foreignList = await call('/api/v1/mcp-remote/connectors', 'GET', H_FOREIGN);
    assert.equal(foreignList.status, 200);
    assert.equal((foreignList.body as { connectors: unknown[] }).connectors.length, 0, 'liste étrangère vide');
    const foreignGet = await call(`/api/v1/mcp-remote/connectors/${connectorId}`, 'GET', H_FOREIGN);
    assert.equal(foreignGet.status, 404, '404 indiscernable');
    const foreignPatch = await call(`/api/v1/mcp-remote/connectors/${connectorId}`, 'PATCH', H_FOREIGN, { enabled: false });
    assert.equal(foreignPatch.status, 404);
    const foreignDelete = await call(`/api/v1/mcp-remote/connectors/${connectorId}`, 'DELETE', H_FOREIGN);
    assert.equal(foreignDelete.status, 404);
    const foreignTest = await call(`/api/v1/mcp-remote/connectors/${connectorId}/test`, 'POST', H_FOREIGN);
    assert.equal(foreignTest.status, 404);
  });

  /* ---- Test de connexion (client STUB injecté AVANT tout appel) ---- */

  it('B1-11 test via stub : bearer plombé au client ; D5 (désactivé testable, jamais activé)', async () => {
    // Le stub est en place AVANT toute requête /test : aucun réseau réel possible.
    const { setConnectorSecret } = b1Store;
    setConnectorSecret.call(b1Store, T_MANAGER, connectorId, SECRET_PLAINTEXT_2);
    let plumbBearer: string | null = null;
    capturedOptions.length = 0;
    const stub = clientStubFrom(async () => ({
      protocolVersion: '2025-03-26',
      serverName: 'mcp-stub-b1',
      serverVersion: '1.0.0',
      capabilities: {},
      sessionId: 'sess-b1'
    }));
    setMcpRemoteRuntimeForTests({
      connectorStore: () => b1Store,
      clientFactory: (options) => {
        capturedOptions.push(options);
        plumbBearer = options.bearerToken ?? null;
        return stub;
      }
    });
    // D5 : désactivation EXPLICITE (acte de gestion) — B1-9 a activé le
    // connecteur ; le test doit rester possible sur l'état désactivé.
    const disabled = await call(`/api/v1/mcp-remote/connectors/${connectorId}`, 'PATCH', H_OWNER, { enabled: false });
    assert.equal(disabled.status, 200, 'désactivation préalable (décision D5)');
    const out = await call(`/api/v1/mcp-remote/connectors/${connectorId}/test`, 'POST', H_OWNER, { timeoutMs: 999_999 });
    assert.equal(out.status, 200);
    const body = out.body as { ok: boolean; protocolVersion: string; serverName: string; requestCapturedId?: string };
    assert.equal(body.ok, true);
    assert.equal(body.protocolVersion, '2025-03-26');
    assert.equal(body.serverName, 'mcp-stub-b1');
    assert.equal(capturedOptions.length, 1, 'usine du client appelée exactement une fois');
    const options = capturedOptions[0];
    assert.ok(options, 'options capturées par l usine de test');
    assert.equal(options.url, URL_OK_2, 'URL du connecteur transmise au client');
    assert.equal(options.connectorId, connectorId);
    assert.equal(plumbBearer, SECRET_PLAINTEXT_2, 'bearer déchiffré par le serveur, plombé au client HTTPS');
    assert.equal(options.timeoutMs, REMOTE_MCP_MAX_TIMEOUT_MS, '999 999 borné à 120 000');
    assert.equal(out.text.includes(SECRET_PLAINTEXT), false, 'aucun plaintext dans la réponse');
    // D5 : le test n'active pas le connecteur.
    const view = ((await call(`/api/v1/mcp-remote/connectors/${connectorId}`, 'GET', H_OWNER)).body as { connector: { enabled: boolean } }).connector;
    assert.equal(view.enabled, false, 'le test ne réactive JAMAIS le connecteur');
  });

  it('B1-12 test : erreurs transport → 200 {ok:false} sans 5xx ni fuite', async () => {
    const stubTimeout = clientStubFrom(async () => {
      throw new RemoteMcpClientError('connecteur distant expiré (timeout client borné)', 'TIMEOUT');
    });
    setMcpRemoteRuntimeForTests({ connectorStore: () => b1Store, clientFactory: () => stubTimeout });
    const timeout = await call(`/api/v1/mcp-remote/connectors/${connectorId}/test`, 'POST', H_OWNER);
    assert.equal(timeout.status, 200);
    const timeoutBody = timeout.body as { ok: boolean; error: { code: string; message: string } };
    assert.equal(timeoutBody.ok, false);
    assert.equal(timeoutBody.error.code, 'MCP_REMOTE_TIMEOUT');
    assert.equal(timeout.text.includes(SECRET_PLAINTEXT), false);

    const stubJson = clientStubFrom(async () => {
      throw new RemoteMcpClientError('réponse distante malformée', 'JSONRPC_INVALID');
    });
    setMcpRemoteRuntimeForTests({ connectorStore: () => b1Store, clientFactory: () => stubJson });
    const json = await call(`/api/v1/mcp-remote/connectors/${connectorId}/test`, 'POST', H_OWNER);
    assert.equal(json.status, 200);
    const jsonBody = json.body as { ok: boolean; error: { code: string } };
    assert.equal(jsonBody.ok, false);
    assert.equal(jsonBody.error.code, 'MCP_REMOTE_UNREACHABLE');

    // Journal du test : metadata = {ok, errorCode} uniquement, jamais de message.
    const journal = await call('/api/v1/mcp-remote/journal?limit=10', 'GET', H_OWNER);
    const events = (journal.body as { events: Array<{ action: string; metadata: Record<string, unknown> | null }> }).events
      .filter((event) => event.action === 'MCP_REMOTE_CONNECTION_TESTED');
    assert.equal(events.length >= 3, true, 'tests journalisés');
    assert.equal(
      events.every((event) => Object.keys(event.metadata as object).length <= 2 && !Object.keys(event.metadata as object).includes('message')),
      true,
      'aucun message d erreur ni champ libre dans les metadata de test'
    );
  });

  it('B1-13 test : TENANT_MANAGE requis (403 ENGINEER) ; id inconnu → 404 ; timeoutMs non numérique → 400', async () => {
    setMcpRemoteRuntimeForTests({ connectorStore: () => b1Store });
    const engineer = await call(`/api/v1/mcp-remote/connectors/${connectorId}/test`, 'POST', H_ENGINEER);
    assert.equal(engineer.status, 403);
    const missing = await call('/api/v1/mcp-remote/connectors/id-inconnu-b1/test', 'POST', H_OWNER);
    assert.equal(missing.status, 404);
    const badTimeout = await call(`/api/v1/mcp-remote/connectors/${connectorId}/test`, 'POST', H_OWNER, { timeoutMs: 'lent' });
    assert.equal(badTimeout.status, 400);
  });

  it('B1-13b test sans secret : revealConnectorSecret → null, bearer absent au client, 200 ok:true', async () => {
    // Connecteur SANS secret (serveur MCP public) — création sans champ secret.
    const created = await call('/api/v1/mcp-remote/connectors', 'POST', H_OWNER, { name: 'b1 public sans secret', url: URL_OK_2 });
    assert.equal(created.status, 201);
    const publicId = String((created.body as { connector: { connectorId: string } }).connector.connectorId);
    // Le plaintext du canal unique est null (stockage vérifié directement, test only).
    assert.equal(b1Store.revealConnectorSecret(T_MANAGER, publicId), null);
    // Stub injecté AVANT toute requête /test : aucun réseau réel (A-02).
    capturedOptions.length = 0;
    const stub = clientStubFrom(async () => ({
      protocolVersion: '2025-03-26',
      serverName: 'mcp-public-stub',
      serverVersion: '1.0.0',
      capabilities: {},
      sessionId: 'sess-b1-nosec'
    }));
    let bearerOnWire: string | null | undefined = 'sentinel-non-callee';
    setMcpRemoteRuntimeForTests({
      connectorStore: () => b1Store,
      clientFactory: (options) => {
        capturedOptions.push(options);
        bearerOnWire = options.bearerToken;
        return stub;
      }
    });
    const out = await call(`/api/v1/mcp-remote/connectors/${publicId}/test`, 'POST', H_OWNER);
    assert.equal(out.status, 200);
    const body = out.body as { ok: boolean; protocolVersion: string; serverName: string };
    assert.equal(body.ok, true, 'connecteur public sans secret : le test passe');
    assert.equal(body.protocolVersion, '2025-03-26');
    assert.equal(body.serverName, 'mcp-public-stub');
    assert.equal(capturedOptions.length, 1);
    const options = capturedOptions[0];
    assert.ok(options, 'options capturées');
    assert.equal(options.url, URL_OK_2);
    assert.equal(options.connectorId, publicId);
    assert.equal(bearerOnWire, undefined, 'AUCUN bearer transmis au client (revealConnectorSecret → null)');
    assert.equal(out.text.includes('tok_'), false, 'aucun fragment de secret dans la réponse');
    // Nettoyage du runtime (états suivants reposent sur le store seul).
    setMcpRemoteRuntimeForTests({ connectorStore: () => b1Store });
  });

  /* ---- Défaillance de persistance → 503 explicite ---- */

  it('B1-14 store indisponible → 503 MCP_REMOTE_CONFIG, rétabli ensuite sans redémarrage', async () => {
    setMcpRemoteRuntimeForTests({
      connectorStore: () => {
        throw new RemoteMcpStoreError('backend SQLite indisponible', 'STORAGE_UNAVAILABLE');
      }
    });
    const out = await call('/api/v1/mcp-remote/connectors', 'GET', H_OWNER);
    assert.equal(out.status, 503);
    assert.equal(errorBody(out).code, 'MCP_REMOTE_CONFIG');
    setMcpRemoteRuntimeForTests({ connectorStore: () => b1Store });
    const back = await call('/api/v1/mcp-remote/connectors', 'GET', H_OWNER);
    assert.equal(back.status, 200);
  });

  /* ---- Journal ---- */

  it('B1-15 journal : actions whitelistées, metadata sans secret, filtrage connectorId/limit', async () => {
    const all = await call('/api/v1/mcp-remote/journal', 'GET', H_OWNER);
    assert.equal(all.status, 200);
    const payload = all.body as {
      events: Array<{ action: string; resourceType: string; userId: string; metadata: Record<string, unknown> | null }>;
      total: number;
    };
    assert.equal(payload.events.every((event) => event.resourceType === 'MCP_REMOTE_CONNECTOR'), true);
    const allowed = new Set([
      'MCP_REMOTE_CONNECTOR_CREATED',
      'MCP_REMOTE_CONNECTOR_UPDATED',
      'MCP_REMOTE_CONNECTOR_DELETED',
      'MCP_REMOTE_CONNECTOR_SECRET_SET',
      'MCP_REMOTE_CONNECTOR_SECRET_REMOVED',
      'MCP_REMOTE_CONNECTION_TESTED'
    ]);
    assert.equal(payload.events.every((event) => allowed.has(event.action)), true, 'actions whitelistées uniquement');
    assert.equal(
      payload.events.every((event) => event.userId !== 'valeur-corp-a-ignorer'),
      true,
      'userId jamais sourcé du corps (D7)'
    );
    assert.equal(all.text.includes(SECRET_PLAINTEXT), false);
    const filtered = await call(`/api/v1/mcp-remote/journal?connectorId=${connectorId}&limit=1`, 'GET', H_OWNER);
    assert.equal(filtered.status, 200);
    const fp = filtered.body as { events: unknown[]; total: number };
    assert.equal(fp.events.length, 1);
    assert.ok(fp.total >= 1);
    const badLimit = await call('/api/v1/mcp-remote/journal?limit=abc', 'GET', H_OWNER);
    assert.equal(badLimit.status, 400);
    const badConnector = await call('/api/v1/mcp-remote/journal?connectorId=../etc', 'GET', H_OWNER);
    assert.equal(badConnector.status, 400);
  });

  /* ---- Suppression en cascade ---- */

  it('B1-16 suppression : cascade politiques, 404 ensuite, second 404', async () => {
    const created = await call('/api/v1/mcp-remote/connectors', 'POST', H_OWNER, { name: 'b1 suppression', url: URL_OK_1 });
    const doomed = String((created.body as { connector: { connectorId: string } }).connector.connectorId);
    b1Store.approveTool({ tenantId: T_MANAGER, connectorId: doomed, toolName: 'outil_a_cascade', schemaSha256: SCHEMA_T, approvedBy: 'test-b1' });
    const removed = await call(`/api/v1/mcp-remote/connectors/${doomed}`, 'DELETE', H_OWNER);
    assert.equal(removed.status, 200);
    assert.equal(b1Store.listToolPolicies(T_MANAGER, doomed).length, 0, 'politiques purgées en cascade');
    const gone = await call(`/api/v1/mcp-remote/connectors/${doomed}`, 'GET', H_OWNER);
    assert.equal(gone.status, 404);
    const again = await call(`/api/v1/mcp-remote/connectors/${doomed}`, 'DELETE', H_OWNER);
    assert.equal(again.status, 404);
  });
});
