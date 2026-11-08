/**
 * LOT UI-MCP — Tests UTILISATEUR du catalogue MCP (page User / MCP Hub).
 *
 * Couverture (mission §7 « Tests utilisateur ») :
 *   - accès au catalogue (PROJECT_READ, JWT pour l'état d'activation) ;
 *   - liste = uniquement PUBLIE + public (brouillons/privés invisibles) ;
 *   - activation RÉELLE (instance scope 'catalog' enabled=1, idempotente) ;
 *   - désactivation (enabled=0, instance conservée) ;
 *   - refus sans JWT (401) et sans MCP_REMOTE_INVOKE (403) ;
 *   - import personnel : création/lecture/modification/test/suppression,
 *     secret jamais renvoyé, absent de la liste tenant et du catalogue ;
 *   - 404 indiscernable pour une entrée non publiée.
 *
 * Harnais identique à mcp-remote-b1 : isolation SQLite au premier import,
 * serveur réel port 0, JWT signés, usine de client injectée (zéro réseau).
 */

// MCP-TEST-ISOLATION-001 — PREMIER import : VOLACO_DATA_DIR = mkdtemp neuf
// AVANT toute évaluation des modules projet (jamais Y:\.volaco-data).
import './_lot-b-legacy-env.js';

import { isolatedVolacoDataDir } from './mcp-remote-isolated-env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setMcpRemoteRuntimeForTests } from '../src/routes/mcp-remote.js';
import { setMcpCatalogRuntimeForTests } from '../src/routes/mcp-catalog.js';
import { RemoteMcpConnectorStore } from '../../../packages/core/src/mcp/remote/store.js';
import type { RemoteMcpHttpClient } from '../../../packages/core/src/mcp/remote/client.js';
import { RemoteMcpSecretCipher, createRemoteMcpKeyRing } from '../../../packages/core/src/mcp/remote/crypto.js';
import { signToken } from '../../../packages/core/src/identity/user-store.js';

const DATA_DIR = isolatedVolacoDataDir;

const T_USER = 'studio-local';

function bearerFor(id: string, role: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${signToken(
      { id, tenantId: T_USER, role: role as 'OWNER', email: `${id}@uimcp.test` },
      3600
    )}`
  };
}

/** OWNER : droits MCP complets (activation + imports). */
const H_OWNER = bearerFor('usr_ui_owner', 'OWNER');
/** ENGINEER : aucun droit MCP (DENY par défaut). */
const H_ENGINEER = bearerFor('usr_ui_engineer', 'ENGINEER');
/** Autre propriétaire : ne doit voir AUCUN import d'autrui. */
const H_OTHER = bearerFor('usr_ui_other', 'OWNER');

const URL_PUBLIE = 'https://api-user.example.org/mcp';
const URL_BROUILLON = 'https://api-brouillon.example.org/mcp';
const URL_PERSO = 'https://api-perso.example.org/mcp';

let baseUrl = '';
let server: Server | undefined;

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

interface UserEntry {
  catalogId: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  transport: string;
  url: string;
  version: number;
  updatedAt: string;
  lastTestStatus: string | null;
  activated: boolean;
  instanceConnectorId: string | null;
}

function stubOk(): RemoteMcpHttpClient {
  return {
    initialize: async () => ({
      protocolVersion: '2024-11-05',
      serverName: 'stub-user',
      serverVersion: '1.0.0',
      sessionId: null
    })
  } as unknown as RemoteMcpHttpClient;
}

describe('LOT UI-MCP user : catalogue, activation, imports personnels', () => {
  let publishedId = '';
  let draftId = '';
  let instanceConnectorId = '';

  before(async () => {
    const connectorStore = new RemoteMcpConnectorStore(
      new RemoteMcpSecretCipher(createRemoteMcpKeyRing({ active: { keyId: 'uimcp', key: randomBytes(32) } }))
    );
    setMcpRemoteRuntimeForTests({ connectorStore: () => connectorStore, clientFactory: () => stubOk() });
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

    // Fixtures : une entrée publiée + une en brouillon (créées par l'admin).
    const pub = await call('/api/v1/mcp/admin/catalog', 'POST', H_OWNER, {
      name: 'Service publié',
      description: 'Connecteur disponible pour tous',
      category: 'productivité',
      icon: '📚',
      url: URL_PUBLIE
    });
    assert.equal(pub.status, 201, pub.text.slice(0, 200));
    const pubBody = pub.body as { entry: { catalogId: string } };
    publishedId = pubBody.entry.catalogId;
    await call(`/api/v1/mcp/admin/catalog/${publishedId}/status`, 'POST', H_OWNER, { status: 'VALIDATION' });
    const goPublic = await call(`/api/v1/mcp/admin/catalog/${publishedId}/status`, 'POST', H_OWNER, { status: 'PUBLIE' });
    assert.equal(goPublic.status, 200, goPublic.text.slice(0, 200));

    const draft = await call('/api/v1/mcp/admin/catalog', 'POST', H_OWNER, {
      name: 'Service brouillon',
      description: 'Pas encore publié',
      category: 'divers',
      url: URL_BROUILLON
    });
    assert.equal(draft.status, 201, draft.text.slice(0, 200));
    draftId = (draft.body as { entry: { catalogId: string } }).entry.catalogId;
  });

  after(async () => {
    setMcpRemoteRuntimeForTests(null);
    setMcpCatalogRuntimeForTests(null);
    await new Promise<void>((resolve) => {
      if (server !== undefined) server.close(() => resolve());
      else resolve();
    });
    try {
      rmSync(DATA_DIR, { recursive: true, force: true });
    } catch {
      // Windows : SQLite encore ouvert — purge OS du répertoire temporaire.
    }
  });

  /* ---- Accès au catalogue ---- */

  it('USR-1 : catalogue visible (PROJECT_READ) = uniquement PUBLIE+public', async () => {
    const out = await call('/api/v1/mcp/catalog', 'GET', H_ENGINEER);
    assert.equal(out.status, 200, out.text.slice(0, 200));
    const body = out.body as { entries: UserEntry[]; categories: Array<{ category: string; count: number }> };
    const published = body.entries.find((one) => one.catalogId === publishedId);
    assert.ok(published, 'l\'entrée publiée doit figurer au catalogue');
    assert.equal(published.activated, false, 'aucune activation au départ');
    assert.equal(published.instanceConnectorId, null);
    // Champs de bibliothèque présents (pas de panneau technique).
    assert.equal(typeof published.description, 'string');
    assert.equal(published.icon, '📚');
    // Catégorie normalisée côté serveur (accents → ASCII, cf. store).
    assert.equal(published.category, 'productivite');
    assert.equal(published.transport, 'url');
    // Aucun brouillon.
    assert.equal(
      body.entries.some((one) => one.catalogId === draftId),
      false,
      'un brouillon ne doit jamais apparaître au catalogue user'
    );
    // Catégories avec compteurs réels (clé normalisée « productivite »).
    const prod = body.categories.find((one) => one.category === 'productivite');
    assert.ok(prod && prod.count >= 1, `catégories : ${JSON.stringify(body.categories)}`);
  });

  it('USR-2 : entrée non publiée → 404 indiscernable (aucun brouillon lisible)', async () => {
    const draft = await call(`/api/v1/mcp/catalog/${draftId}`, 'GET', H_OWNER);
    assert.equal(draft.status, 404);
    assert.equal(errorBody(draft).code, 'NOT_FOUND');
    const unknown = await call('/api/v1/mcp/catalog/uuid-inexistant-000', 'GET', H_OWNER);
    assert.equal(unknown.status, 404);
    // Même code pour les deux : aucun oracle d'existence.
    assert.equal(errorBody(draft).code, errorBody(unknown).code);
  });

  /* ---- Activation / désactivation ---- */

  it('USR-3 : activation RÉELLE (instance scope catalog enabled=1) + idempotence', async () => {
    const first = await call(`/api/v1/mcp/catalog/${publishedId}/activation`, 'POST', H_OWNER, {});
    assert.equal(first.status, 200, first.text.slice(0, 200));
    const firstBody = first.body as { activated: boolean; connector: { connectorId: string; enabled: boolean; scope: string; catalogId: string } };
    assert.equal(firstBody.activated, true);
    assert.equal(firstBody.connector.enabled, true, 'activation = enabled=1 réel');
    assert.equal(firstBody.connector.scope, 'catalog');
    assert.equal(firstBody.connector.catalogId, publishedId);
    instanceConnectorId = firstBody.connector.connectorId;

    // Idempotence : une seconde activation ne crée pas de doublon.
    const second = await call(`/api/v1/mcp/catalog/${publishedId}/activation`, 'POST', H_OWNER, {});
    assert.equal(second.status, 200);
    const secondBody = second.body as { connector: { connectorId: string } };
    assert.equal(secondBody.connector.connectorId, instanceConnectorId, 'pas de doublon');

    // L'état est reflété dans le catalogue.
    const list = await call('/api/v1/mcp/catalog', 'GET', H_OWNER);
    const entry = (list.body as { entries: UserEntry[] }).entries.find((one) => one.catalogId === publishedId);
    assert.ok(entry);
    assert.equal(entry.activated, true);
    assert.equal(entry.instanceConnectorId, instanceConnectorId);
  });

  it('USR-4 : désactivation (enabled=0) puis réactivation', async () => {
    const off = await call(`/api/v1/mcp/catalog/${publishedId}/activation`, 'DELETE', H_OWNER, {});
    assert.equal(off.status, 200, off.text.slice(0, 200));
    const offBody = off.body as { deactivated: boolean; connector: { enabled: boolean; scope: string } };
    assert.equal(offBody.deactivated, true);
    assert.equal(offBody.connector.enabled, false, 'désactivation = enabled=0 réel');
    assert.equal(offBody.connector.scope, 'catalog');

    const list = await call('/api/v1/mcp/catalog', 'GET', H_OWNER);
    const entry = (list.body as { entries: UserEntry[] }).entries.find((one) => one.catalogId === publishedId);
    assert.ok(entry);
    assert.equal(entry.activated, false);

    // Désactivation idempotente : ré-DELETE sans réactivation → 200,
    // instance toujours enabled=0 (aucune écriture parasite).
    const again = await call(`/api/v1/mcp/catalog/${publishedId}/activation`, 'DELETE', H_OWNER, {});
    assert.equal(again.status, 200);
    assert.equal((again.body as { connector: { enabled: boolean } }).connector.enabled, false);

    const back = await call(`/api/v1/mcp/catalog/${publishedId}/activation`, 'POST', H_OWNER, {});
    assert.equal(back.status, 200);
    assert.equal((back.body as { connector: { enabled: boolean } }).connector.enabled, true);
  });

  it('USR-5 : activation refusée sans JWT (401) et sans droits MCP (403)', async () => {
    // En-têtes dev SANS userId : identité non fiable → 401.
    const dev = await call(`/api/v1/mcp/catalog/${publishedId}/activation`, 'POST', {
      'Content-Type': 'application/json',
      'x-tenant-id': T_USER,
      'x-user-role': 'OWNER'
    }, {});
    assert.equal(dev.status, 401, `401 attendu : ${dev.text.slice(0, 160)}`);

    // ENGINEER : PROJECT_READ pour lire, mais AUCUN droit d'activation.
    const engineer = await call(`/api/v1/mcp/catalog/${publishedId}/activation`, 'POST', H_ENGINEER, {});
    assert.equal(engineer.status, 403, `403 attendu : ${engineer.text.slice(0, 160)}`);

    // L'instance de l'OWNER est intacte.
    const list = await call('/api/v1/mcp/catalog', 'GET', H_OWNER);
    const entry = (list.body as { entries: UserEntry[] }).entries.find((one) => one.catalogId === publishedId);
    assert.ok(entry && entry.activated === true);
  });

  /* ---- Imports personnels ---- */

  it('USR-6 : import personnel = création scope personal (JWT + MCP_REMOTE_INVOKE)', async () => {
    const created = await call('/api/v1/mcp-remote/connectors', 'POST', H_OWNER, {
      name: 'Mon import perso',
      url: URL_PERSO,
      scope: 'personal',
      secret: 'super-secret-value-never-returned'
    });
    assert.equal(created.status, 201, created.text.slice(0, 200));
    const connector = (created.body as { connector: Record<string, unknown> }).connector;
    assert.equal(connector.scope, 'personal');
    assert.equal(connector.secretPresent, true);
    assert.equal(connector.enabled, false, 'créé désactivé (activation explicite)');
    // Le secret n'apparaît JAMAIS dans la réponse.
    assert.equal(created.text.includes('super-secret-value-never-returned'), false);
    assert.equal(created.text.includes('"secret"'), false);
  });

  it('USR-7 : « mes connecteurs » = uniquement les miens (scope=mine, JWT requis)', async () => {
    const mine = await call('/api/v1/mcp-remote/connectors?scope=mine', 'GET', H_OWNER);
    assert.equal(mine.status, 200, mine.text.slice(0, 200));
    const mineBody = mine.body as { connectors: Array<{ connectorId: string; scope: string; ownerUserId: string | null; secretPresent: boolean }> };
    const personal = mineBody.connectors.filter((one) => one.scope === 'personal');
    const firstPersonal = personal[0];
    assert.ok(firstPersonal !== undefined, 'mon import personnel doit être listé');
    assert.equal(firstPersonal.ownerUserId, 'usr_ui_owner');
    assert.equal(firstPersonal.secretPresent, true);
    // Les instances de catalogue sont aussi à moi.
    const catalogInstances = mineBody.connectors.filter((one) => one.scope === 'catalog');
    assert.ok(catalogInstances.length >= 1);

    // Sans JWT → 401 (pas d'identité fiable pour « mes » connecteurs).
    const noJwt = await call('/api/v1/mcp-remote/connectors?scope=mine', 'GET', {
      'Content-Type': 'application/json',
      'x-tenant-id': T_USER,
      'x-user-role': 'OWNER'
    });
    assert.equal(noJwt.status, 401);

    // scope invalide → 400.
    const badScope = await call('/api/v1/mcp-remote/connectors?scope=autrui', 'GET', H_OWNER);
    assert.equal(badScope.status, 400);
  });

  it('USR-8 : la liste tenant n\'expose JAMAIS les imports personnels', async () => {
    const tenantList = await call('/api/v1/mcp-remote/connectors', 'GET', H_OWNER);
    assert.equal(tenantList.status, 200);
    const body = tenantList.body as { connectors: Array<{ scope: string }> };
    assert.ok(
      body.connectors.every((one) => one.scope === 'tenant'),
      `seules les lignes tenant dans la liste historique : ${JSON.stringify(body.connectors.map((one) => one.scope))}`
    );
    // Le catalogue global ne contient que des métadonnées d'entrée, jamais
    // l'import personnel (table distincte, aucune écriture croisée).
    const catalog = await call('/api/v1/mcp/admin/catalog', 'GET', H_OWNER);
    const entries = (catalog.body as { entries: Array<{ url: string }> }).entries;
    assert.equal(entries.some((one) => one.url === URL_PERSO), false, 'import absent du catalogue global');
  });

  it('USR-9 : test de connexion personnel via client injecté (aucun réseau réel)', async () => {
    const mine = await call('/api/v1/mcp-remote/connectors?scope=mine', 'GET', H_OWNER);
    const personal = (mine.body as { connectors: Array<{ connectorId: string; scope: string }> })
      .connectors.find((one) => one.scope === 'personal');
    assert.ok(personal);
    const test = await call(`/api/v1/mcp-remote/connectors/${personal.connectorId}/test`, 'POST', H_OWNER, {});
    assert.equal(test.status, 200, test.text.slice(0, 200));
    const body = test.body as { ok: boolean; serverName?: string };
    assert.equal(body.ok, true);
    assert.equal(body.serverName, 'stub-user');
  });

  it('USR-10 : modification et suppression de mon import personnel', async () => {
    const mine = await call('/api/v1/mcp-remote/connectors?scope=mine', 'GET', H_OWNER);
    const personal = (mine.body as { connectors: Array<{ connectorId: string; scope: string }> })
      .connectors.find((one) => one.scope === 'personal');
    assert.ok(personal);

    const patched = await call(`/api/v1/mcp-remote/connectors/${personal.connectorId}`, 'PATCH', H_OWNER, {
      name: 'Mon import perso v2'
    });
    assert.equal(patched.status, 200, patched.text.slice(0, 200));
    assert.equal((patched.body as { connector: { name: string } }).connector.name, 'Mon import perso v2');

    const removed = await call(`/api/v1/mcp-remote/connectors/${personal.connectorId}`, 'DELETE', H_OWNER);
    assert.equal(removed.status, 200);
    assert.equal((removed.body as { removed: boolean }).removed, true);

    const gone = await call(`/api/v1/mcp-remote/connectors/${personal.connectorId}`, 'GET', H_OWNER);
    assert.equal(gone.status, 404);
  });

  /* ---- Séparation minimale côté user (détail dans le fichier dédié) ---- */

  it('USR-11 : un utilisateur ne voit pas les imports d\'un autre (404 sans oracle)', async () => {
    // H_OTHER crée son propre import.
    const created = await call('/api/v1/mcp-remote/connectors', 'POST', H_OTHER, {
      name: 'Import de autrui',
      url: 'https://api-autrui.example.org/mcp',
      scope: 'personal'
    });
    assert.equal(created.status, 201, created.text.slice(0, 200));
    const foreignId = (created.body as { connector: { connectorId: string } }).connector.connectorId;

    // Lecture directe par H_OWNER (même tenant) → 404 indiscernable.
    const read = await call(`/api/v1/mcp-remote/connectors/${foreignId}`, 'GET', H_OWNER);
    assert.equal(read.status, 404, `404 attendu : ${read.text.slice(0, 160)}`);
    const unknown = await call('/api/v1/mcp-remote/connectors/uuid-inexistant-000', 'GET', H_OWNER);
    assert.equal(unknown.status, 404);
    assert.equal(errorBody(read).code, errorBody(unknown).code, 'aucun oracle d\'existence');

    // Modification/suppression par autrui → 404, l'import reste intact.
    const patch = await call(`/api/v1/mcp-remote/connectors/${foreignId}`, 'PATCH', H_OWNER, { name: 'pirate' });
    assert.equal(patch.status, 404);
    const del = await call(`/api/v1/mcp-remote/connectors/${foreignId}`, 'DELETE', H_OWNER);
    assert.equal(del.status, 404);
    const stillThere = await call(`/api/v1/mcp-remote/connectors/${foreignId}`, 'GET', H_OTHER);
    assert.equal(stillThere.status, 200);
    assert.equal((stillThere.body as { connector: { name: string } }).connector.name, 'Import de autrui');

    // Propriétaire : suppression possible.
    const ownerDel = await call(`/api/v1/mcp-remote/connectors/${foreignId}`, 'DELETE', H_OTHER);
    assert.equal(ownerDel.status, 200);
  });

  it('USR-12 : secret jamais renvoyé en lecture (secretPresent + keyId seulement)', async () => {
    const created = await call('/api/v1/mcp-remote/connectors', 'POST', H_OWNER, {
      name: 'Import avec secret',
      url: 'https://api-secret.example.org/mcp',
      scope: 'personal',
      secret: 'valeur-qui-ne-doit-jamais-sortir'
    });
    assert.equal(created.status, 201, created.text.slice(0, 200));
    const id = (created.body as { connector: { connectorId: string } }).connector.connectorId;

    for (const path of [
      `/api/v1/mcp-remote/connectors/${id}`,
      '/api/v1/mcp-remote/connectors?scope=mine',
      '/api/v1/mcp/catalog'
    ]) {
      const out = await call(path, 'GET', H_OWNER);
      assert.equal(out.status, 200, `${path} → ${out.status}`);
      assert.equal(out.text.includes('valeur-qui-ne-doit-jamais-sortir'), false, `${path} fuitte de secret`);
    }
    // Secret retiré → secretPresent à false, suppression idempotente OK.
    const removed = await call(`/api/v1/mcp-remote/connectors/${id}/secret`, 'DELETE', H_OWNER);
    assert.equal(removed.status, 200);
    const after = await call(`/api/v1/mcp-remote/connectors/${id}`, 'GET', H_OWNER);
    assert.equal((after.body as { connector: { secretPresent: boolean } }).connector.secretPresent, false);
    await call(`/api/v1/mcp-remote/connectors/${id}`, 'DELETE', H_OWNER);
  });
});
