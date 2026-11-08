/**
 * LOT UI-MCP — Tests ADMINISTRATEUR du catalogue MCP global.
 *
 * Couverture (mission §7 « Tests administrateur ») :
 *   - accès administrateur autorisé (OWNER/ADMIN) ;
 *   - accès utilisateur refusé (ENGINEER/VIEWER : 403 sur CHAQUE endpoint
 *     admin, accès DIRECT aux endpoints — masquer un bouton ne suffit pas) ;
 *   - création d'un MCP global (toujours BROUILLON, validation des champs,
 *     rejet mass-assignment, refus SSRF) ;
 *   - modification (whitelist de champs, version++) ;
 *   - publication / dépublication / désactivation (matrice serveur, 409 hors
 *     matrice) ;
 *   - suppression avec contrôle des dépendances (409 tant qu'une instance
 *     d'activation existe, puis succès après retrait) ;
 *   - test de santé via client STUB (aucun réseau réel) + last_test persisté ;
 *   - historique et stats = données réelles du backend, audit des opérations.
 *
 * Harnais identique à mcp-remote-b1 : isolation SQLite par le PREMIER import,
 * serveur réel port 0, JWT signés (identité fiable) + en-têtes dev pour les
 * refus, usine de client injectée (zéro appel réseau réel).
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
import { RemoteMcpClientError } from '../../../packages/core/src/mcp/remote/client.js';
import { RemoteMcpSecretCipher, createRemoteMcpKeyRing } from '../../../packages/core/src/mcp/remote/crypto.js';
import { signToken } from '../../../packages/core/src/identity/user-store.js';

const DATA_DIR = isolatedVolacoDataDir;

const T_ADMIN = 'studio-local';

/** En-têtes dev (sans JWT) — pour les refus de rôle. */
const H_ENGINEER = { 'Content-Type': 'application/json', 'x-tenant-id': T_ADMIN, 'x-user-role': 'ENGINEER' };
const H_VIEWER = { 'Content-Type': 'application/json', 'x-tenant-id': T_ADMIN, 'x-user-role': 'VIEWER' };

/** JWT signés : identité fiable (sub) + rôle/tenant du token. */
function bearerFor(id: string, role: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${signToken(
      { id, tenantId: T_ADMIN, role: role as 'OWNER', email: `${id}@uimcp.test` },
      3600
    )}`
  };
}

const H_OWNER = bearerFor('usr_admin_owner', 'OWNER');
const H_ADMIN = bearerFor('usr_admin_admin', 'ADMIN');
const H_USER_JWT = bearerFor('usr_admin_bas', 'ENGINEER');
// Deuxième propriétaire OWNER : possède les droits MCP (MCP_REMOTE_INVOKE)
// requis pour activer/désactiver une entrée du catalogue.
const H_OWNER2 = bearerFor('usr_admin_user2', 'OWNER');

const URL_OK = 'https://api-catalog.example.org/mcp';

let baseUrl = '';
let server: Server | undefined;
let catalogStore: import('../../../packages/core/src/mcp/catalog/store.js').McpCatalogStore;

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

interface EntryView {
  catalogId: string;
  name: string;
  status: string;
  version: number;
  visibility: string;
  activationCount: number;
  lastTest: { status: string } | null;
  createdBy: string;
}

function entryOf(out: JsonOut): EntryView {
  const body = out.body as { entry?: EntryView } | null;
  assert.ok(body?.entry, `entrée absente de la réponse : ${out.text.slice(0, 200)}`);
  return body.entry;
}

function stubClientFrom(initializeImpl: () => Promise<unknown>): RemoteMcpHttpClient {
  return { initialize: initializeImpl } as unknown as RemoteMcpHttpClient;
}

describe('LOT UI-MCP admin : catalogue global, transitions, tests, stats', () => {
  let createdId = '';
  let secondId = '';

  before(async () => {
    const connectorStore = new RemoteMcpConnectorStore(
      new RemoteMcpSecretCipher(createRemoteMcpKeyRing({ active: { keyId: 'uimcp', key: randomBytes(32) } }))
    );
    setMcpRemoteRuntimeForTests({ connectorStore: () => connectorStore });
    const { getCatalogStore } = await import('../src/routes/mcp-catalog.js');
    catalogStore = getCatalogStore();
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

  /* ---- Accès : admin autorisé, utilisateur refusé (accès direct endpoints) ---- */

  it('ADM-1 : OWNER et ADMIN accèdent aux endpoints admin (200/201)', async () => {
    for (const headers of [H_OWNER, H_ADMIN]) {
      const list = await call('/api/v1/mcp/admin/catalog', 'GET', headers);
      assert.equal(list.status, 200);
      const stats = await call('/api/v1/mcp/admin/stats', 'GET', headers);
      assert.equal(stats.status, 200);
    }
    const created = await call('/api/v1/mcp/admin/catalog', 'POST', H_OWNER, {
      name: 'Catalogue ADM',
      description: 'Entrée de test admin',
      category: 'outils',
      url: URL_OK,
      icon: '🧰'
    });
    assert.equal(created.status, 201);
    createdId = entryOf(created).catalogId;
  });

  it('ADM-2 : ENGINEER/VIEWER refusés 403 sur CHAQUE endpoint admin (accès direct)', async () => {
    const id = createdId;
    const attempts: Array<[string, string, unknown?]> = [
      ['GET', '/api/v1/mcp/admin/catalog'],
      ['POST', '/api/v1/mcp/admin/catalog', { name: 'x', url: URL_OK }],
      ['GET', `/api/v1/mcp/admin/catalog/${id}`],
      ['PATCH', `/api/v1/mcp/admin/catalog/${id}`, { name: 'y' }],
      ['POST', `/api/v1/mcp/admin/catalog/${id}/status`, { status: 'VALIDATION' }],
      ['DELETE', `/api/v1/mcp/admin/catalog/${id}`],
      ['POST', `/api/v1/mcp/admin/catalog/${id}/test`, {}],
      ['GET', `/api/v1/mcp/admin/catalog/${id}/history`],
      ['GET', '/api/v1/mcp/admin/stats']
    ];
    for (const headers of [H_ENGINEER, H_VIEWER]) {
      for (const [method, path, payload] of attempts) {
        const out = await call(path, method, headers, payload);
        assert.equal(out.status, 403, `${method} ${path} → ${out.status} (attendu 403)`);
      }
    }
    // L'entrée n'a pas été modifiée ni supprimée par les refus.
    const still = await call(`/api/v1/mcp/admin/catalog/${id}`, 'GET', H_OWNER);
    assert.equal(still.status, 200);
    assert.equal(entryOf(still).name, 'Catalogue ADM');
  });

  /* ---- Création ---- */

  it('ADM-3 : création forcée en BROUILLON (aucune entrée ne naît publiée)', async () => {
    const created = await call('/api/v1/mcp/admin/catalog', 'POST', H_ADMIN, {
      name: 'Deuxième entrée',
      description: 'Brouillon',
      category: 'productivité',
      url: 'https://api-two.example.org/mcp'
    });
    assert.equal(created.status, 201);
    const entry = entryOf(created);
    secondId = entry.catalogId;
    assert.equal(entry.status, 'BROUILLON');
    assert.equal(entry.version, 1);
    assert.equal(entry.visibility, 'public');
    assert.equal(entry.activationCount, 0);
    assert.equal(entry.createdBy, 'usr_admin_admin');
    // Aucun champ de secret dans la réponse.
    assert.equal(created.text.includes('secret'), false);
  });

  it('ADM-4 : validations à la création (URL SSRF refusée, champs requis, mass-assignment)', async () => {
    const ssrf = await call('/api/v1/mcp/admin/catalog', 'POST', H_OWNER, {
      name: 'evil',
      url: 'http://127.0.0.1:8080/mcp'
    });
    assert.equal(ssrf.status, 400, `SSRF non refusé : ${ssrf.text.slice(0, 160)}`);
    const localhost = await call('/api/v1/mcp/admin/catalog', 'POST', H_OWNER, {
      name: 'evil2',
      url: 'https://169.254.169.254/mcp'
    });
    assert.equal(localhost.status, 400, `IP link-local non refusée : ${localhost.text.slice(0, 160)}`);
    const noName = await call('/api/v1/mcp/admin/catalog', 'POST', H_OWNER, { url: URL_OK });
    assert.equal(noName.status, 400);
    const noUrl = await call('/api/v1/mcp/admin/catalog', 'POST', H_OWNER, { name: 'sans-url' });
    assert.equal(noUrl.status, 400);
    const massAssignment = await call('/api/v1/mcp/admin/catalog', 'POST', H_OWNER, {
      name: 'mass',
      url: URL_OK,
      status: 'PUBLIE'
    });
    assert.equal(massAssignment.status, 400, 'propriété inconnue (status) doit être refusée');
    // Aucune entrée parasite créée.
    const list = await call('/api/v1/mcp/admin/catalog?status=BROUILLON', 'GET', H_OWNER);
    const body = list.body as { entries: EntryView[] };
    assert.equal(
      body.entries.filter((one) => ['evil', 'evil2', 'sans-url', 'mass'].includes(one.name)).length,
      0
    );
  });

  /* ---- Publication / dépublication (matrice serveur) ---- */

  it('ADM-5 : cycle BROUILLON → VALIDATION → PUBLIÉ → DÉSACTIVÉ (transitions serveur)', async () => {
    const id = createdId;
    const s1 = await call(`/api/v1/mcp/admin/catalog/${id}/status`, 'POST', H_OWNER, { status: 'VALIDATION' });
    assert.equal(s1.status, 200);
    assert.equal(entryOf(s1).status, 'VALIDATION');
    const s2 = await call(`/api/v1/mcp/admin/catalog/${id}/status`, 'POST', H_ADMIN, { status: 'PUBLIE' });
    assert.equal(s2.status, 200);
    assert.equal(entryOf(s2).status, 'PUBLIE');
    const s3 = await call(`/api/v1/mcp/admin/catalog/${id}/status`, 'POST', H_OWNER, { status: 'DESACTIVE' });
    assert.equal(s3.status, 200);
    assert.equal(entryOf(s3).status, 'DESACTIVE');
    const s4 = await call(`/api/v1/mcp/admin/catalog/${id}/status`, 'POST', H_OWNER, { status: 'PUBLIE' });
    assert.equal(s4.status, 200);
    assert.equal(entryOf(s4).status, 'PUBLIE');
  });

  it('ADM-6 : transitions hors matrice → 409 MCP_CATALOG_INVALID_TRANSITION', async () => {
    // createdId est PUBLIE : saut direct BROUILLON→PUBLIE impossible sur secondId.
    const jump = await call(`/api/v1/mcp/admin/catalog/${secondId}/status`, 'POST', H_OWNER, { status: 'PUBLIE' });
    assert.equal(jump.status, 409);
    assert.equal(errorBody(jump).code, 'MCP_CATALOG_INVALID_TRANSITION');
    const back = await call(`/api/v1/mcp/admin/catalog/${createdId}/status`, 'POST', H_OWNER, { status: 'VALIDATION' });
    assert.equal(back.status, 409);
    const invalid = await call(`/api/v1/mcp/admin/catalog/${createdId}/status`, 'POST', H_OWNER, { status: 'PUBLIÉ' });
    assert.equal(invalid.status, 400, 'statut non normalisé → 400');
    // L'état n'a pas bougé.
    const check = await call(`/api/v1/mcp/admin/catalog/${createdId}`, 'GET', H_OWNER);
    assert.equal(entryOf(check).status, 'PUBLIE');
  });

  /* ---- Modification ---- */

  it('ADM-7 : PATCH whitelisté, version++, rejet des champs inconnus et URL SSRF', async () => {
    const id = createdId;
    const ok = await call(`/api/v1/mcp/admin/catalog/${id}`, 'PATCH', H_OWNER, {
      name: 'Catalogue ADM v2',
      category: 'infrastructure',
      description: 'Modifié'
    });
    assert.equal(ok.status, 200);
    const entry = entryOf(ok);
    assert.equal(entry.name, 'Catalogue ADM v2');
    // La création part de version=1 ; les transitions ne bumpent pas la
    // version → un seul PATCH = version 2 (au minimum).
    assert.ok(entry.version >= 2, `version incrémentée (reçu ${entry.version})`);
    const unknown = await call(`/api/v1/mcp/admin/catalog/${id}`, 'PATCH', H_OWNER, {
      createdBy: 'usr_intrus'
    });
    assert.equal(unknown.status, 400, 'mass-assignment refusée');
    const ssrf = await call(`/api/v1/mcp/admin/catalog/${id}`, 'PATCH', H_OWNER, {
      url: 'http://169.254.169.254/mcp'
    });
    assert.equal(ssrf.status, 400, 'URL SSRF refusée au PATCH');
    // L'URL d'origine est intacte (aucune écriture partielle).
    const check = await call(`/api/v1/mcp/admin/catalog/${id}`, 'GET', H_OWNER);
    const body = check.body as { entry: { url: string; name: string } };
    assert.equal(body.entry.url, URL_OK);
    assert.equal(body.entry.name, 'Catalogue ADM v2');
  });

  /* ---- Test de santé (client stub, zéro réseau réel) ---- */

  it('ADM-8 : test de santé OK via client stub → last_test persisté + audit', async () => {
    const okStub = stubClientFrom(async () => ({
      protocolVersion: '2024-11-05',
      serverName: 'stub-admin',
      serverVersion: '9.9.9'
    }));
    setMcpCatalogRuntimeForTests({ clientFactory: () => okStub });
    const out = await call(`/api/v1/mcp/admin/catalog/${createdId}/test`, 'POST', H_ADMIN, {});
    assert.equal(out.status, 200);
    const body = out.body as { ok: boolean; serverName: string };
    assert.equal(body.ok, true);
    assert.equal(body.serverName, 'stub-admin');
    const check = await call(`/api/v1/mcp/admin/catalog/${createdId}`, 'GET', H_OWNER);
    const entry = entryOf(check);
    assert.equal(entry.lastTest?.status, 'OK');
    setMcpCatalogRuntimeForTests(null);
  });

  it('ADM-9 : test de santé en échec → 200 {ok:false} + last_test FAILED (code seul)', async () => {
    const failStub = stubClientFrom(async () => {
      throw new RemoteMcpClientError('connexion refusée vers la cible', 'CONNECT_ERROR');
    });
    setMcpCatalogRuntimeForTests({ clientFactory: () => failStub });
    const out = await call(`/api/v1/mcp/admin/catalog/${createdId}/test`, 'POST', H_OWNER, {});
    assert.equal(out.status, 200, 'échec réseau = 200 {ok:false}, pas un 5xx');
    const body = out.body as { ok: boolean; error: { code: string; message: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'MCP_REMOTE_UNREACHABLE');
    const check = await call(`/api/v1/mcp/admin/catalog/${createdId}`, 'GET', H_OWNER);
    const entry = entryOf(check);
    assert.equal(entry.lastTest?.status, 'FAILED');
    setMcpCatalogRuntimeForTests(null);
  });

  /* ---- Historique + stats (données réelles) ---- */

  it('ADM-10 : historique administratif = opérations réelles auditées', async () => {
    const out = await call(`/api/v1/mcp/admin/catalog/${createdId}/history`, 'GET', H_OWNER);
    assert.equal(out.status, 200);
    const body = out.body as { history: Array<{ action: string; userId: string }> };
    const actions = body.history.map((one) => one.action);
    assert.ok(actions.includes('MCP_CATALOG_CREATED'), 'création auditée');
    assert.ok(actions.includes('MCP_CATALOG_TRANSITIONED'), 'transitions auditées');
    assert.ok(actions.includes('MCP_CATALOG_TESTED'), 'tests audités');
    assert.ok(actions.includes('MCP_CATALOG_UPDATED'), 'mise à jour auditée');
    for (const one of body.history) {
      assert.ok(
        ['MCP_CATALOG_CREATED', 'MCP_CATALOG_UPDATED', 'MCP_CATALOG_DELETED', 'MCP_CATALOG_TRANSITIONED', 'MCP_CATALOG_TESTED'].includes(one.action),
        `action inattendue dans l'historique admin : ${one.action}`
      );
      assert.ok(one.userId.length > 0, 'opérateur identifié');
    }
  });

  it('ADM-11 : stats = chiffres réels (compteurs catalogue + agrégats connexion)', async () => {
    const out = await call('/api/v1/mcp/admin/stats', 'GET', H_OWNER);
    assert.equal(out.status, 200);
    const body = out.body as {
      catalog: {
        total: number;
        byStatus: Record<string, number>;
        byCategory: Array<{ category: string; count: number }>;
        health: { ok: number; failed: number; neverTested: number };
      };
      connections: { byScope: Array<{ scope: string; total: number; enabled: number }>; lastTest: { ok: number; failed: number; neverTested: number } };
      personalImports: { total: number; enabled: number };
      recentOperations: Array<{ action: string }>;
    };
    // Au moins les 2 entrées de cette suite.
    assert.ok(body.catalog.total >= 2, `total catalogue (${body.catalog.total}) >= 2`);
    assert.equal(
      Object.values(body.catalog.byStatus).reduce((sum, one) => sum + one, 0),
      body.catalog.total,
      'somme des statuts = total'
    );
    assert.ok((body.catalog.byStatus['PUBLIE'] ?? 0) >= 1);
    // ADM-7 a déplacé l'entrée créée en ADM-1 vers « infrastructure » :
    // les compteurs reflètent l'état RÉEL du backend.
    assert.ok(
      body.catalog.byCategory.some((one) => one.category === 'infrastructure'),
      `catégories réelles : ${JSON.stringify(body.catalog.byCategory)}`
    );
    assert.ok(body.catalog.health.ok + body.catalog.health.failed + body.catalog.health.neverTested === body.catalog.total);
    // Agrégats : imports personnels en compteurs uniquement.
    assert.equal(typeof body.personalImports.total, 'number');
    assert.equal(Object.keys(body.personalImports).sort().join(','), 'enabled,total');
    assert.ok(Array.isArray(body.connections.byScope));
    assert.ok(body.recentOperations.length > 0);
    for (const op of body.recentOperations) {
      assert.ok(op.action.startsWith('MCP_CATALOG_'), `opération inattendue : ${op.action}`);
    }
  });

  /* ---- Dépendances de suppression ---- */

  it('ADM-12 : suppression bloquée 409 tant qu une instance existe, puis succès après retrait', async () => {
    // L'entrée createdId est PUBLIE : un utilisateur OWNER (droits MCP) l'active (réel).
    const activate = await call(`/api/v1/mcp/catalog/${createdId}/activation`, 'POST', H_OWNER2, {});
    assert.equal(activate.status, 200, `activation attendue : ${activate.text.slice(0, 160)}`);
    const activated = activate.body as { connector: { connectorId: string; enabled: boolean; scope: string } };
    assert.equal(activated.connector.enabled, true);
    assert.equal(activated.connector.scope, 'catalog');

    // Admin : suppression refusée (dépendance).
    const blocked = await call(`/api/v1/mcp/admin/catalog/${createdId}`, 'DELETE', H_OWNER);
    assert.equal(blocked.status, 409, `409 attendu : ${blocked.text.slice(0, 160)}`);
    assert.equal(errorBody(blocked).code, 'MCP_CATALOG_DEPENDENCY');
    const stillThere = await call(`/api/v1/mcp/admin/catalog/${createdId}`, 'GET', H_OWNER);
    assert.equal(stillThere.status, 200);

    // L'utilisateur retire SON instance (route existante, ownership vérifié).
    const remove = await call(
      `/api/v1/mcp-remote/connectors/${activated.connector.connectorId}`,
      'DELETE',
      H_OWNER2
    );
    assert.equal(remove.status, 200, `retrait instance : ${remove.text.slice(0, 160)}`);

    // La suppression admin fonctionne maintenant.
    const deleted = await call(`/api/v1/mcp/admin/catalog/${createdId}`, 'DELETE', H_OWNER);
    assert.equal(deleted.status, 200);
    const gone = await call(`/api/v1/mcp/admin/catalog/${createdId}`, 'GET', H_OWNER);
    assert.equal(gone.status, 404);
    const audited = await call('/api/v1/mcp/admin/stats', 'GET', H_OWNER);
    const ops = (audited.body as { recentOperations: Array<{ action: string }> }).recentOperations;
    assert.ok(ops.some((one) => one.action === 'MCP_CATALOG_DELETED'), 'suppression auditée');
    createdId = '';
  });

  it('ADM-13 : entrée absente → 404 sans oracle (GET/PATCH/DELETE/status/test/history)', async () => {
    const id = 'uuid-inexistant-000';
    const attempts: Array<[string, string, unknown?]> = [
      ['GET', `/api/v1/mcp/admin/catalog/${id}`],
      ['PATCH', `/api/v1/mcp/admin/catalog/${id}`, { name: 'x' }],
      ['DELETE', `/api/v1/mcp/admin/catalog/${id}`],
      ['POST', `/api/v1/mcp/admin/catalog/${id}/status`, { status: 'VALIDATION' }],
      ['POST', `/api/v1/mcp/admin/catalog/${id}/test`, {}],
      ['GET', `/api/v1/mcp/admin/catalog/${id}/history`]
    ];
    for (const [method, path, payload] of attempts) {
      const out = await call(path, method, H_OWNER, payload);
      assert.equal(out.status, 404, `${method} ${path} → ${out.status} (404 attendu)`);
    }
  });

  it('ADM-14 : filtres serveur admin (status, catégorie, recherche)', async () => {
    // Entrée dédiée publiée pour le filtre (la seule PUBLIE a été supprimée
    // en ADM-12 ; secondId reste volontairement en BROUILLON).
    const dedicated = await call('/api/v1/mcp/admin/catalog', 'POST', H_OWNER, {
      name: 'Entrée filtres',
      category: 'outils',
      url: 'https://api-filtres.example.org/mcp'
    });
    assert.equal(dedicated.status, 201);
    const dedicatedId = entryOf(dedicated).catalogId;
    await call(`/api/v1/mcp/admin/catalog/${dedicatedId}/status`, 'POST', H_OWNER, { status: 'VALIDATION' });
    const republished = await call(`/api/v1/mcp/admin/catalog/${dedicatedId}/status`, 'POST', H_OWNER, { status: 'PUBLIE' });
    assert.equal(republished.status, 200);

    const pub = await call('/api/v1/mcp/admin/catalog?status=PUBLIE', 'GET', H_OWNER);
    assert.equal(pub.status, 200);
    const pubBody = pub.body as { entries: EntryView[] };
    assert.ok(pubBody.entries.length >= 1, `filtre PUBLIE vide : ${pub.text.slice(0, 160)}`);
    for (const one of pubBody.entries) assert.equal(one.status, 'PUBLIE');
    assert.ok(pubBody.entries.some((one) => one.catalogId === dedicatedId));
    const cat = await call('/api/v1/mcp/admin/catalog?category=productivité', 'GET', H_OWNER);
    assert.equal(cat.status, 200);
    const catBody = cat.body as { entries: EntryView[] };
    assert.ok(catBody.entries.some((one) => one.name === 'Deuxième entrée'));
    // Recherche : motif sans accent (« Deuxième » matche « eux »).
    const search = await call('/api/v1/mcp/admin/catalog?q=eux', 'GET', H_OWNER);
    assert.equal(search.status, 200);
    const searchBody = search.body as { entries: EntryView[] };
    assert.ok(searchBody.entries.some((one) => one.name === 'Deuxième entrée'), 'recherche case-insensible');
    const badStatus = await call('/api/v1/mcp/admin/catalog?status=INCONNU', 'GET', H_OWNER);
    assert.equal(badStatus.status, 400, 'statut filtre invalide → 400');
    // secondId est encore en brouillon : il ne doit PAS apparaître côté UTILISATEUR.
    const userList = await call('/api/v1/mcp/catalog', 'GET', H_USER_JWT);
    const userBody = userList.body as { entries: Array<{ catalogId: string }> };
    assert.equal(
      userBody.entries.some((one) => one.catalogId === secondId),
      false,
      'un brouillon ne doit jamais figurer dans la liste utilisateur'
    );
    // Nettoyage : l'entrée dédiée est retirée du catalogue.
    const cleaned = await call(`/api/v1/mcp/admin/catalog/${dedicatedId}`, 'DELETE', H_OWNER);
    assert.equal(cleaned.status, 200);
  });
});
