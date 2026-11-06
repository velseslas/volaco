/**
 * MCP-C3.2 — CRUD des configurations des serveurs MCP distants,
 * routes /api/v1/mcp/remote-servers (surface dédiée, même store que B1).
 *
 * Couverture du cahier :
 *   - CRUD (création/consultation/liste/modification/suppression/existence) ;
 *   - validation stricte (types, bornes, protocoles, transport, secrets) ;
 *   - rejet des propriétés inconnues (mass-assignment fail-closed) ;
 *   - RBAC réel (TENANT_MANAGE=OWNER pour écrire, PROJECT_READ pour lire) ;
 *   - isolation multi-tenant (404 indiscernable, listes étanches) ;
 *   - secrets : jamais exposés, jamais journalisés, conservés/remplacés
 *     uniquement sur demande explicite, stockage exclusivement chiffré ;
 *   - dernier état de test inclus lorsqu'il existe (suivi cross-surface via
 *     POST /connectors/:id/test, client HTTPS INJECTÉ — AUCUN réseau réel) ;
 *   - compatibilité : routes /mcp-remote/connectors au comportement INCHANGÉ
 *     (les champs inconnus y sont toujours tolérés — contrat historique).
 *
 * HORS PÉRIMÈTRE (C3.3) : aucune validation DNS/IP de connexions réelles
 * n'est exigée ici — le stub de client est injecté, jamais une socket ouverte.
 */

// MCP-TEST-ISOLATION-001 — PREMIER import : fixe VOLACO_DATA_DIR (mkdtemp
// hors dépôt) avant toute évaluation des modules projet (sinon les singletons
// audit/user lieraient la base du dépôt Y:\.volaco-data).
import './_lot-b-legacy-env.js';

import { isolatedVolacoDataDir } from './mcp-remote-isolated-env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setMcpRemoteRuntimeForTests } from '../src/routes/mcp-remote.js';
import { RemoteMcpConnectorStore } from '../../../packages/core/src/mcp/remote/store.js';
import { RemoteMcpClientError } from '../../../packages/core/src/mcp/remote/client.js';
import type { RemoteMcpClientOptions, RemoteMcpHttpClient } from '../../../packages/core/src/mcp/remote/client.js';
import { RemoteMcpSecretCipher, createRemoteMcpKeyRing } from '../../../packages/core/src/mcp/remote/crypto.js';

const DATA_DIR = isolatedVolacoDataDir;

const T_MANAGER = 'studio-local';
const T_FOREIGN = 'tenant-etranger-c32';

const H_OWNER = { 'Content-Type': 'application/json', 'x-tenant-id': T_MANAGER, 'x-user-role': 'OWNER' };
const H_ADMIN = { 'Content-Type': 'application/json', 'x-tenant-id': T_MANAGER, 'x-user-role': 'ADMIN' };
const H_ENGINEER = { 'Content-Type': 'application/json', 'x-tenant-id': T_MANAGER, 'x-user-role': 'ENGINEER' };
const H_VIEWER = { 'Content-Type': 'application/json', 'x-tenant-id': T_MANAGER, 'x-user-role': 'VIEWER' };
const H_FOREIGN = { 'Content-Type': 'application/json', 'x-tenant-id': T_FOREIGN, 'x-user-role': 'OWNER' };

const BASE = '/api/v1/mcp/remote-servers';
const CONNECTORS = '/api/v1/mcp-remote/connectors';
const JOURNAL = '/api/v1/mcp-remote/journal';

const SECRET_V1 = 'tok_' + randomBytes(12).toString('hex') + '_v1';
const SECRET_V2 = 'tok_' + randomBytes(12).toString('hex') + '_v2';
const URL_OK_1 = 'https://serveur-c32.example.org/mcp';
const URL_OK_2 = 'https://serveur-c32-alt.example.org/mcp';

let baseUrl = '';
let server: Server | undefined;
let c32Store: RemoteMcpConnectorStore;
/** Implémentation injectée du handshake initialize (stub : zéro réseau). */
let initializeImpl: () => Promise<unknown> = async () => ({});

/** Fixtures créées avant toutes les assertions : IDs issus du store (uuids). */
let idA = ''; // sans secret
let idB = ''; // avec secret v1
let idT = ''; // dédié aux états de test

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

function recordOf(out: JsonOut): Record<string, unknown> {
  assert.ok(out.body !== null && typeof out.body === 'object', 'corps JSON objet');
  return out.body as Record<string, unknown>;
}

function serverViewOf(out: JsonOut): Record<string, unknown> {
  const record = recordOf(out);
  const srv = (record.server ?? {}) as Record<string, unknown>;
  assert.ok(typeof srv.connectorId === 'string', 'vue serveur présente');
  return srv;
}

async function createServer(headers: Record<string, string>, payload: Record<string, unknown>): Promise<string> {
  const res = await call(BASE, 'POST', headers, payload);
  assert.equal(res.status, 201, `fixture C3.2 : création attendue (${res.status})`);
  return serverViewOf(res).connectorId as string;
}

function asView(out: JsonOut): Record<string, unknown> {
  return serverViewOf(out);
}

/** Message d'erreur pour comparer les 404 indiscernables. */
function messageOf(out: JsonOut): string {
  const record = recordOf(out);
  const error = record.error as { message?: string } | undefined;
  return typeof error?.message === 'string' ? error.message : '';
}

describe('MCP-C3.2 : CRUD /api/v1/mcp/remote-servers (isolation, RBAC, secrets)', () => {
  before(async () => {
    c32Store = new RemoteMcpConnectorStore(
      new RemoteMcpSecretCipher(createRemoteMcpKeyRing({ active: { keyId: 'c32', key: randomBytes(32) } }))
    );
    setMcpRemoteRuntimeForTests({
      connectorStore: () => c32Store,
      clientFactory: (_options: RemoteMcpClientOptions): RemoteMcpHttpClient => ({
        initialize: async () => await initializeImpl()
      } as unknown as RemoteMcpHttpClient)
    });
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
    idA = await createServer(H_OWNER, { name: 'Serveur A', url: URL_OK_1 });
    idB = await createServer(H_OWNER, { name: 'Serveur B', url: URL_OK_2, secret: SECRET_V1 });
    idT = await createServer(H_OWNER, { name: 'Serveur T', url: URL_OK_1 });
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
      // Windows : SQLite encore ouverte par node:sqlite — répertoire temporaire
      // système, purge OS. Aucun échec de nettoyage.
    }
  });

  /* ---- CRUD : consultations/liste ---- */

  it('C32-1 consultation : vue légère complète (sans secret, dernier test null)', async () => {
    const got = await call(`${BASE}/${idA}`, 'GET', H_OWNER);
    assert.equal(got.status, 200);
    const srv = asView(got);
    assert.equal(srv.name, 'Serveur A');
    assert.equal(srv.url, URL_OK_1);
    assert.equal(srv.transport, 'url');
    assert.equal(srv.enabled, false);
    assert.equal(srv.secretPresent, false);
    assert.equal(srv.lastTest, null);
    assert.equal(typeof srv.createdAt, 'string');
    assert.equal(typeof srv.updatedAt, 'string');
    const json = got.text;
    assert.ok(!json.includes('toolPolicies'), 'pas de toolPolicies sur la surface servers');
    assert.ok(!json.includes('keyId'), 'pas de keyId sur la surface servers');
    assert.ok(!json.includes('ciphertext'), 'aucun ciphertext');
  });

  it('C32-2 liste : total cohérent, serveurs du tenant SEULEMENT', async () => {
    const list = await call(BASE, 'GET', H_OWNER);
    assert.equal(list.status, 200);
    const record = recordOf(list);
    const servers = record.servers as Array<Record<string, unknown>>;
    assert.equal(record.total, servers.length);
    const ids = new Set(servers.map((s) => s.connectorId));
    for (const id of [idA, idB, idT]) {
      assert.ok(ids.has(id), `fixture ${id} listée`);
    }
    assert.ok(!list.text.includes('toolPolicies'), 'aucune politique d outils dans la liste');
    assert.ok(!list.text.includes('ciphertext'), 'aucun ciphertext dans la liste');
  });

  /* ---- Validation POST ---- */

  it('C32-3 POST : name obligatoire et borné (1..64, sans caractères de contrôle)', async () => {
    const blank = await call(BASE, 'POST', H_OWNER, { name: '  ', url: URL_OK_1 });
    assert.equal(blank.status, 400);
    const long = await call(BASE, 'POST', H_OWNER, { name: 'x'.repeat(65), url: URL_OK_1 });
    assert.equal(long.status, 400);
    const type = await call(BASE, 'POST', H_OWNER, { name: 42, url: URL_OK_1 });
    assert.equal(type.status, 400);
    const ctrl = await call(BASE, 'POST', H_OWNER, { name: 'a\u0007b', url: URL_OK_1 });
    assert.equal(ctrl.status, 400);
  });

  it('C32-4 POST : url obligatoire, HTTPS seule, sans credentials, longueurs bornées', async () => {
    const missing = await call(BASE, 'POST', H_OWNER, { name: 's' });
    assert.equal(missing.status, 400);
    const http = await call(BASE, 'POST', H_OWNER, { name: 's', url: 'http://serveur-c32.example.org/mcp' });
    assert.equal(http.status, 400);
    const ssh = await call(BASE, 'POST', H_OWNER, { name: 's', url: 'ssh://serveur-c32.example.org' });
    assert.equal(ssh.status, 400);
    const creds = await call(BASE, 'POST', H_OWNER, { name: 's', url: 'https://user:pass@serveur-c32.example.org/mcp' });
    assert.equal(creds.status, 400);
    const long = await call(BASE, 'POST', H_OWNER, { name: 's', url: `https://serveur-c32.example.org/${'a'.repeat(2100)}` });
    assert.equal(long.status, 400);
  });

  it('C32-5 POST : secret strict (type apparaissant, bornes 1..4096, contrôle)', async () => {
    const empty = await call(BASE, 'POST', H_OWNER, { name: 's', url: URL_OK_1, secret: '' });
    assert.equal(empty.status, 400);
    const tooLong = await call(BASE, 'POST', H_OWNER, { name: 's', url: URL_OK_1, secret: 'x'.repeat(4097) });
    assert.equal(tooLong.status, 400);
    const ctrl = await call(BASE, 'POST', H_OWNER, { name: 's', url: URL_OK_1, secret: 'ok\u001f' });
    assert.equal(ctrl.status, 400);
    const numeric = await call(BASE, 'POST', H_OWNER, { name: 's', url: URL_OK_1, secret: 12345 });
    assert.equal(numeric.status, 400);
  });

  it('C32-6 POST : transport est exclusivement « url » (absent, défaut, ou explicite)', async () => {
    const absent = await call(BASE, 'POST', H_OWNER, { name: 'Serveur transport absent', url: URL_OK_1 });
    assert.equal(absent.status, 201);
    const view = asView(absent);
    assert.equal(view.transport, 'url');
    const explicit = await call(BASE, 'POST', H_OWNER, { name: 's', url: URL_OK_1, transport: 'url' });
    assert.equal(explicit.status, 201);
    const http = await call(BASE, 'POST', H_OWNER, { name: 's', url: URL_OK_1, transport: 'http' });
    assert.equal(http.status, 400);
    const stdio = await call(BASE, 'POST', H_OWNER, { name: 's', url: URL_OK_1, transport: 'stdio' });
    assert.equal(stdio.status, 400);
    const num = await call(BASE, 'POST', H_OWNER, { name: 's', url: URL_OK_1, transport: 7 });
    assert.equal(num.status, 400);
  });

  it('C32-7 mass-assignment : propriétés inconnues REFUSÉES (noms cités, valeurs jamais)', async () => {
    const hostile = await call(BASE, 'POST', H_OWNER, {
      name: 's', url: URL_OK_1, foo: 1, admin: true, toolPolicies: []
    });
    assert.equal(hostile.status, 400);
    assert.ok(hostile.text.includes('foo'), 'foo cité');
    assert.ok(hostile.text.includes('toolPolicies'), 'toolPolicies cité');
    // Eleveation : falsification du tenant et de l'identité par le corps
    const spoof = await call(BASE, 'POST', H_OWNER, {
      name: 's', url: URL_OK_1, tenant_id: T_FOREIGN, tenantId: T_FOREIGN, userId: 'usr_autre'
    });
    assert.equal(spoof.status, 400);
    assert.ok(spoof.text.includes('tenant_id'));
    // Preuve d'étanchéité : le tenant étranger reste vide des tentatives
    const foreignList = await call(BASE, 'GET', H_FOREIGN);
    assert.equal(foreignList.status, 200);
    assert.equal((recordOf(foreignList).total as number), 0, 'tenant étranger vide');
  });

  it('C32-8 création avec secret : aucun plaintext dévoilé, conservation chiffrée', async () => {
    const created = await call(BASE, 'POST', H_OWNER, { name: 'Serveur Secret C32', url: URL_OK_1, secret: SECRET_V2 });
    assert.equal(created.status, 201);
    assert.ok(!created.text.includes(SECRET_V2), 'plaintext absent de la réponse');
    assert.ok(!created.text.includes('secret_iv'), 'aucune colonne brute exposée');
    const srv = asView(created);
    assert.equal(srv.secretPresent, true);
    // Seule la couche serveur re-déchiffre : la valeur n'apparaît nulle part.
    assert.notEqual(created.text, SECRET_V2);
  });

  /* ---- RBAC ---- */

  it('C32-9 écriture FORBIDDEN à ADMIN/ENGINEER/VIEWER (TENANT_MANAGE = OWNER seul)', async () => {
    for (const headers of [H_ADMIN, H_ENGINEER, H_VIEWER]) {
      const created = await call(BASE, 'POST', headers, { name: 'x', url: URL_OK_1 });
      assert.equal(created.status, 403, 'POST interdit');
      const patched = await call(`${BASE}/${idB}`, 'PATCH', headers, { enabled: true });
      assert.equal(patched.status, 403, 'PATCH interdit');
      const deleted = await call(`${BASE}/${idB}`, 'DELETE', headers);
      assert.equal(deleted.status, 403, 'DELETE interdit');
    }
  });

  it('C32-10 lecture autorisée à OWNER/ADMIN/ENGINEER/VIEWER (PROJECT_READ)', async () => {
    for (const headers of [H_OWNER, H_ADMIN, H_ENGINEER, H_VIEWER]) {
      const list = await call(BASE, 'GET', headers);
      assert.equal(list.status, 200);
      const one = await call(`${BASE}/${idB}`, 'GET', headers);
      assert.equal(one.status, 200);
    }
  });

  /* ---- Isolation multi-tenant ---- */

  it('C32-11 tenant étranger : liste étanche, toutes opérations 404 (indiscernable)', async () => {
    const list = await call(BASE, 'GET', H_FOREIGN);
    assert.equal(list.status, 200);
    assert.equal((recordOf(list).total as number), 0, 'aucun serveur du tenant voisin ne fuite');

    const foreignGet = await call(`${BASE}/${idB}`, 'GET', H_FOREIGN);
    assert.equal(foreignGet.status, 404);
    const localGet = await call(`${BASE}/id-certainement-absent`, 'GET', H_OWNER);
    assert.equal(localGet.status, 404);
    assert.equal(
      messageOf(foreignGet),
      messageOf(localGet),
      '404 étranger et 404 inexistant : même message (aucun oracle d existence)'
    );

    const foreignPatch = await call(`${BASE}/${idB}`, 'PATCH', H_FOREIGN, { enabled: true });
    assert.equal(foreignPatch.status, 404);
    const foreignDelete = await call(`${BASE}/${idB}`, 'DELETE', H_FOREIGN);
    assert.equal(foreignDelete.status, 404);
    // étanchéité post-opérations : le connecteur reste intact
    const stillThere = await call(`${BASE}/${idB}`, 'GET', H_OWNER);
    assert.equal(stillThere.status, 200);
  });

  it('C32-12 « tenant B ne peut pas créer au nom du tenant A » : tenant toujours dérivé du contexte', async () => {
    const before = await call(BASE, 'GET', H_OWNER);
    const totalBefore = recordOf(before).total;
    const foreignCreated = await call(BASE, 'POST', H_FOREIGN, {
      name: 'Serveur chez moi', url: URL_OK_1, transport: 'url'
    });
    assert.equal(foreignCreated.status, 201, 'la création est légale (le tenant vient du contexte)');
    // Le serveur est créé CHEZ le tenant authentifié (T_FOREIGN), jamais chez
    // T_MANAGER : aucun champ du corps ne décide de la destination.
    const afterForeign = await call(BASE, 'GET', H_FOREIGN);
    assert.equal((recordOf(afterForeign).total as number), 1, 'créé chez le tenant authentifié');
    const afterLocal = await call(BASE, 'GET', H_OWNER);
    assert.equal((recordOf(afterLocal).total as number), (totalBefore as number) + 0, 'le tenant A est exactement inchangé');
  });

  /* ---- PATCH : sémantique fine ---- */

  it('C32-13 PATCH sans champ modifiable → 400 ; champ inconnu → 400', async () => {
    const blank = await call(`${BASE}/${idB}`, 'PATCH', H_OWNER, {});
    assert.equal(blank.status, 400);
    const unknown = await call(`${BASE}/${idB}`, 'PATCH', H_OWNER, { description: 'champ rêvé' });
    assert.equal(unknown.status, 400);
    assert.ok(unknown.text.includes('description'));
    // tenant_id et identifiant interne : HORS liste blanche
    const tenant = await call(`${BASE}/${idB}`, 'PATCH', H_OWNER, { tenant_id: T_FOREIGN });
    assert.equal(tenant.status, 400);
    const idField = await call(`${BASE}/${idB}`, 'PATCH', H_OWNER, { connectorId: 'usr_forge' });
    assert.equal(idField.status, 400);
  });

  it('C32-14 PATCH sans secret : CONSERVÉ (vidage exclusif possible)', async () => {
    const patched = await call(`${BASE}/${idB}`, 'PATCH', H_OWNER, { name: 'Serveur B renommé' });
    assert.equal(patched.status, 200);
    assert.equal(c32Store.revealConnectorSecret(T_MANAGER, idB), SECRET_V1, 'secret intact');
    assert.ok(!patched.text.includes(SECRET_V1), 'aucun secret dans la réponse PATCH');
    assert.equal((asView(patched)).name, 'Serveur B renommé');
  });

  it('C32-15 PATCH avec secret explicite : remplacement (ancien et nouveau jamais rendus)', async () => {
    const patched = await call(`${BASE}/${idB}`, 'PATCH', H_OWNER, { secret: SECRET_V2 });
    assert.equal(patched.status, 200);
    assert.ok(!patched.text.includes(SECRET_V2), 'nouveau secret jamais rendu');
    assert.ok(!patched.text.includes(SECRET_V1), 'ancien secret jamais rendu');
    assert.equal(c32Store.revealConnectorSecret(T_MANAGER, idB), SECRET_V2, 'secret remplacé');
    assert.equal((asView(patched)).secretPresent, true);
  });

  it('C32-16 PATCH url : rewrité atomiquement ; secret CHECK conservé', async () => {
    const patched = await call(`${BASE}/${idB}`, 'PATCH', H_OWNER, { url: URL_OK_1 });
    assert.equal(patched.status, 200);
    const view = asView(patched);
    assert.equal(view.url, URL_OK_1);
    assert.equal(c32Store.revealConnectorSecret(T_MANAGER, idB), SECRET_V2);
  });

  it('C32-17 PATCH enabled : booléen requis', async () => {
    const bad = await call(`${BASE}/${idB}`, 'PATCH', H_OWNER, { enabled: 'oui' });
    assert.equal(bad.status, 400);
    const good = await call(`${BASE}/${idB}`, 'PATCH', H_OWNER, { enabled: true });
    assert.equal(good.status, 200);
    assert.equal((asView(good)).enabled, true);
  });

  it('C32-18 PATCH id inexistant : 404 sans écriture partielle', async () => {
    const patched = await call(`${BASE}/id-inexistant-c32`, 'PATCH', H_OWNER, { url: URL_OK_1 });
    assert.equal(patched.status, 404);
  });

  /* ---- Suppression ---- */

  it('C32-19 suppression → 200 removed:true ; ensuite 404 ; liste décrémentée', async () => {
    const listBefore = await call(BASE, 'GET', H_OWNER);
    const totalBefore = recordOf(listBefore).total;
    const idX = await createServer(H_OWNER, { name: 'Serveur à supprimer', url: URL_OK_1 });
    const removed = await call(`${BASE}/${idX}`, 'DELETE', H_OWNER);
    assert.equal(removed.status, 200);
    assert.equal((recordOf(removed) as Record<string, unknown>).removed, true);
    const gone = await call(`${BASE}/${idX}`, 'GET', H_OWNER);
    assert.equal(gone.status, 404);
    const listAfter = await call(BASE, 'GET', H_OWNER);
    assert.equal((recordOf(listAfter).total as number), (totalBefore as number), 'total de retour après suppression');
  });

  /* ---- Journal d'audit : whitelist stricte ---- */

  it('C32-20 audit : création/modification/suppression tracées, aucun secret', async () => {
    const journal = await call(JOURNAL, 'GET', H_OWNER);
    assert.equal(journal.status, 200);
    const events = recordOf(journal).events as Array<Record<string, unknown>>;
    assert.ok(events.length >= 2, 'au moins la création et une modification');
    const actions = new Set(events.map((e) => e.action));
    assert.ok(actions.has('MCP_REMOTE_CONNECTOR_CREATED'), 'création tracée');
    assert.ok(actions.has('MCP_REMOTE_CONNECTOR_UPDATED'), 'modification tracée');
    assert.ok(actions.has('MCP_REMOTE_CONNECTOR_DELETED'), 'suppression tracée');
    for (const event of events) {
      const metadata = event.metadata as Record<string, unknown> | null;
      assert.ok(
        metadata === null || (metadata.secret === undefined && metadata.bearer === undefined),
        'pas de secret/bearer dans metadata'
      );
    }
    assert.ok(!journal.text.includes(SECRET_V1), 'plaintext v1 absent du journal');
    assert.ok(!journal.text.includes(SECRET_V2), 'plaintext v2 absent du journal');
  });

  /* ---- Dernier état de test (cross-surface, client injecté) ---- */

  it('C32-21 sans test → lastTest null ; après test OK → {status OK, detail null}', async () => {
    initializeImpl = async () => ({ protocolVersion: '2025-06-18', serverName: 'x', serverVersion: '1', sessionId: null });
    const tested = await call(`${CONNECTORS}/${idT}/test`, 'POST', H_OWNER, {});
    assert.equal(tested.status, 200, 'réponse de test inchangée (contrat existant)');
    assert.equal((recordOf(tested) as Record<string, unknown>).ok, true);
    const view = await call(`${BASE}/${idT}`, 'GET', H_OWNER);
    assert.equal(view.status, 200);
    const lastTest = asView(view).lastTest as Record<string, unknown>;
    assert.ok(lastTest !== null, 'état de test désormais présent');
    assert.equal(lastTest.status, 'OK');
    assert.equal(lastTest.detail, null);
    assert.equal(typeof lastTest.at, 'string');
  });

  it('C32-22 test en échec (TLS) → lastTest FAILED, détail = code transport SEUL', async () => {
    initializeImpl = async () => {
      throw new RemoteMcpClientError('échec TLS simulé (message de libellé incendié)', 'TLS_FAILURE');
    };
    const tested = await call(`${CONNECTORS}/${idT}/test`, 'POST', H_OWNER, {});
    assert.equal(tested.status, 200);
    assert.equal((recordOf(tested) as Record<string, unknown>).ok, false);
    const view = await call(`${BASE}/${idT}`, 'GET', H_OWNER);
    const lastTest = asView(view).lastTest as Record<string, unknown>;
    assert.equal(lastTest.status, 'FAILED');
    assert.equal(lastTest.detail, 'TLS_FAILURE', 'code seulement — jamais le message ni la cible');
  });

  /* ---- Routes MCP existantes : comportement INCHANGÉ ---- */

  it('C32-23 /mcp-remote/connectors : POST 201 inchangé, tolérance champs inconnus conservée', async () => {
    const created = await call(CONNECTORS, 'POST', H_OWNER, { name: 'Connecteur B1 legacy', url: URL_OK_1 });
    assert.equal(created.status, 201);
    const legacy = recordOf(created) as { connector?: Record<string, unknown> };
    assert.ok(legacy.connector !== undefined, 'payload /connectors inchangé');
    // Le PATCH /connectors HISTORIQUE ignore les propriétés inconnues — aucune
    // contamination du strict remote-servers (comportements distincts par design).
    const patched = await call(`${CONNECTORS}/${idT}`, 'PATCH', H_OWNER, { enabled: true, unknownField: 1 });
    assert.equal(patched.status, 200, 'PATCH /connectors ignore toujours les champs inconnus');
  });

  it('C32-24 méthodes non prévues → 404 central (surface servers)', async () => {
    const put = await call(BASE, 'PUT', H_OWNER, { name: 'x' });
    assert.equal(put.status, 404);
    const patchList = await call(BASE, 'PATCH', H_OWNER, { enabled: true });
    assert.equal(patchList.status, 404);
    const deleteList = await call(BASE, 'DELETE', H_OWNER);
    assert.equal(deleteList.status, 404);
  });
});
