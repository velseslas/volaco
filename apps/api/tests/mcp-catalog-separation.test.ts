/**
 * LOT UI-MCP — Tests de SÉPARATION Admin / User (mission §7).
 *
 * Couverture :
 *   - un utilisateur (ENGINEER) ne peut PAS créer un connecteur global
 *     (scope=tenant refusé) ni modifier le catalogue (403 sur chaque route) ;
 *   - un utilisateur ne voit pas les imports d'un autre (404 sans oracle) ;
 *   - un utilisateur ne lit pas les secrets d'un autre (404, secret absent) ;
 *   - un import personnel n'apparaît JAMAIS dans le catalogue global ni
 *     dans la liste tenant ;
 *   - un administrateur ne contourne PAS les contrôles MCP : la création
 *     d'entrée refuse les URLs SSRF, l'activation exige JWT + droits, et
 *     l'exécution reste sur le flux gouverné prepare→call (aucune route du
 *     catalogue n'exécute un outil) ;
 *   - les actions admin sont auditées, les activations utilisateur non
 *     (historique admin = opérations administratives uniquement).
 *
 * Harnais : isolation SQLite au premier import, serveur réel port 0,
 * JWT signés, client MCP injecté (zéro réseau réel).
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
const T_SEP = 'studio-local';

function bearerFor(id: string, role: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${signToken(
      { id, tenantId: T_SEP, role: role as 'OWNER', email: `${id}@uimcp.test` },
      3600
    )}`
  };
}

const H_ADMIN = bearerFor('sep_admin', 'OWNER');
const H_USER = bearerFor('sep_user', 'ENGINEER');
/** Deuxième OWNER : propriétaire d'imports à protéger. */
const H_OWNER_B = bearerFor('sep_owner_b', 'OWNER');
/** En-têtes dev SANS identité (clé API / repli) : fail-closed attendu. */
const H_DEV_NO_JWT = {
  'Content-Type': 'application/json',
  'x-tenant-id': T_SEP,
  'x-user-role': 'OWNER'
};

const URL_CATALOG = 'https://api-sep-catalog.example.org/mcp';
const URL_PERSO_B = 'https://api-sep-persob.example.org/mcp';

let baseUrl = '';
let server: Server | undefined;
let publishedId = '';

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

function stubOk(): RemoteMcpHttpClient {
  return {
    initialize: async () => ({
      protocolVersion: '2024-11-05',
      serverName: 'stub-sep',
      serverVersion: '1.0.0',
      sessionId: null
    })
  } as unknown as RemoteMcpHttpClient;
}

describe('LOT UI-MCP séparation admin/user', () => {
  let foreignConnectorId = '';

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

    // Entrée publiée (fixture admin).
    const pub = await call('/api/v1/mcp/admin/catalog', 'POST', H_ADMIN, {
      name: 'Entrée séparation',
      description: 'Fixture',
      category: 'divers',
      url: URL_CATALOG
    });
    assert.equal(pub.status, 201, pub.text.slice(0, 200));
    publishedId = (pub.body as { entry: { catalogId: string } }).entry.catalogId;
    await call(`/api/v1/mcp/admin/catalog/${publishedId}/status`, 'POST', H_ADMIN, { status: 'VALIDATION' });
    const go = await call(`/api/v1/mcp/admin/catalog/${publishedId}/status`, 'POST', H_ADMIN, { status: 'PUBLIE' });
    assert.equal(go.status, 200, go.text.slice(0, 200));

    // Import personnel du propriétaire B (avec secret).
    const foreign = await call('/api/v1/mcp-remote/connectors', 'POST', H_OWNER_B, {
      name: 'Import secret de B',
      url: URL_PERSO_B,
      scope: 'personal',
      secret: 'secret-de-b-jamais-lisible'
    });
    assert.equal(foreign.status, 201, foreign.text.slice(0, 200));
    foreignConnectorId = (foreign.body as { connector: { connectorId: string } }).connector.connectorId;
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

  /* ---- Un utilisateur ne crée ni ne modifie le catalogue ---- */

  it('SEP-1 : ENGINEER ne crée AUCUN connecteur global (scope=tenant refusé)', async () => {
    // Création tenant classique → 403 (TENANT_MANAGE absent).
    const tenantCreate = await call('/api/v1/mcp-remote/connectors', 'POST', H_USER, {
      name: 'Global pirate',
      url: 'https://api-pirate.example.org/mcp'
    });
    assert.equal(tenantCreate.status, 403, `403 attendu : ${tenantCreate.text.slice(0, 160)}`);

    // Scope=personal sans MCP_REMOTE_INVOKE → 403 (DENY par défaut).
    const personal = await call('/api/v1/mcp-remote/connectors', 'POST', H_USER, {
      name: 'Perso pirate',
      url: 'https://api-pirate2.example.org/mcp',
      scope: 'personal'
    });
    assert.equal(personal.status, 403, `403 attendu : ${personal.text.slice(0, 160)}`);

    // Scope=catégorie réservée (jamais créable par les routes existantes).
    const catalogScope = await call('/api/v1/mcp-remote/connectors', 'POST', H_ADMIN, {
      name: 'Scope illégal',
      url: 'https://api-scope.example.org/mcp',
      scope: 'catalog'
    });
    assert.equal(catalogScope.status, 400, `scope=catalog refusé : ${catalogScope.text.slice(0, 160)}`);

    // Rien n'a été créé.
    const list = await call('/api/v1/mcp-remote/connectors', 'GET', H_ADMIN);
    const body = list.body as { connectors: Array<{ name: string }> };
    assert.equal(body.connectors.some((one) => one.name.includes('pirate')), false);
    assert.equal(body.connectors.some((one) => one.name === 'Scope illégal'), false);
  });

  it('SEP-2 : ENGINEER ne modifie PAS le catalogue (403 sur chaque route admin)', async () => {
    const attempts: Array<[string, string, unknown?]> = [
      ['GET', '/api/v1/mcp/admin/catalog'],
      ['POST', '/api/v1/mcp/admin/catalog', { name: 'x', url: URL_CATALOG }],
      ['GET', `/api/v1/mcp/admin/catalog/${publishedId}`],
      ['PATCH', `/api/v1/mcp/admin/catalog/${publishedId}`, { name: 'pirate' }],
      ['POST', `/api/v1/mcp/admin/catalog/${publishedId}/status`, { status: 'DESACTIVE' }],
      ['DELETE', `/api/v1/mcp/admin/catalog/${publishedId}`],
      ['POST', `/api/v1/mcp/admin/catalog/${publishedId}/test`, {}],
      ['GET', `/api/v1/mcp/admin/catalog/${publishedId}/history`],
      ['GET', '/api/v1/mcp/admin/stats']
    ];
    for (const [method, path, payload] of attempts) {
      const out = await call(path, method, H_USER, payload);
      assert.equal(out.status, 403, `${method} ${path} → ${out.status} (403 attendu)`);
    }
    // L'entrée est intacte et toujours publiée.
    const check = await call('/api/v1/mcp/catalog', 'GET', H_USER);
    const entry = (check.body as { entries: Array<{ catalogId: string; name: string }> })
      .entries.find((one) => one.catalogId === publishedId);
    assert.ok(entry, 'l\'entrée reste publiée malgré les tentatives');
    assert.equal(entry.name, 'Entrée séparation');
  });

  /* ---- Isolation des imports et secrets ---- */

  it('SEP-3 : un utilisateur ne voit pas les imports d\'un autre (404 sans oracle)', async () => {
    // Liste « mine » de A : aucun import de B.
    const mineA = await call('/api/v1/mcp-remote/connectors?scope=mine', 'GET', H_ADMIN);
    assert.equal(mineA.status, 200);
    const ids = (mineA.body as { connectors: Array<{ connectorId: string }> })
      .connectors.map((one) => one.connectorId);
    assert.equal(ids.includes(foreignConnectorId), false, 'les imports d\'autrui sont absents de ma liste');

    // Lecture directe par A → 404 identique à un ID inexistant.
    const read = await call(`/api/v1/mcp-remote/connectors/${foreignConnectorId}`, 'GET', H_ADMIN);
    assert.equal(read.status, 404);
    const unknown = await call('/api/v1/mcp-remote/connectors/uuid-inexistant-000', 'GET', H_ADMIN);
    assert.equal(unknown.status, 404);
    assert.equal(errorBody(read).code, errorBody(unknown).code, 'aucun oracle d\'existence');
    assert.equal(read.text.includes('secret-de-b-jamais-lisible'), false);

    // Écritures par A → 404, l'import de B reste intact.
    for (const [method, payload] of [
      ['PATCH', { name: 'piraté' }],
      ['DELETE', undefined]
    ] as Array<[string, unknown]>) {
      const out = await call(`/api/v1/mcp-remote/connectors/${foreignConnectorId}`, method, H_ADMIN, payload);
      assert.equal(out.status, 404, `${method} → ${out.status} (404 attendu)`);
    }
    const still = await call(`/api/v1/mcp-remote/connectors/${foreignConnectorId}`, 'GET', H_OWNER_B);
    assert.equal(still.status, 200, 'l\'import de B est intact');
    assert.equal((still.body as { connector: { name: string } }).connector.name, 'Import secret de B');
  });

  it('SEP-4 : secrets d\'autrui jamais lisibles (secretAbsent côté A, 404)', async () => {
    const read = await call(`/api/v1/mcp-remote/connectors/${foreignConnectorId}`, 'GET', H_ADMIN);
    assert.equal(read.status, 404);
    assert.equal(read.text.includes('secret-de-b-jamais-lisible'), false);
    assert.equal(read.text.includes('secret'), false, 'aucun champ secret dans le 404');

    // Le propriétaire voit secretPresent mais JAMAIS la valeur.
    const owner = await call(`/api/v1/mcp-remote/connectors/${foreignConnectorId}`, 'GET', H_OWNER_B);
    assert.equal(owner.status, 200);
    const connector = (owner.body as { connector: Record<string, unknown> }).connector;
    assert.equal(connector.secretPresent, true);
    assert.equal('secret' in connector, false, 'pas de champ secret dans la vue');
    assert.equal(owner.text.includes('secret-de-b-jamais-lisible'), false);

    // Le journal est filtré par propriété : A (OWNER, même tenant) ne voit
    // AUCUN événement de l'import de B (fail-closed sans JWT compris).
    const journalA = await call('/api/v1/mcp-remote/journal?limit=100', 'GET', H_ADMIN);
    assert.equal(journalA.status, 200);
    const events = (journalA.body as { events?: Array<{ resourceId: string }> }).events ?? [];
    assert.equal(
      events.some((one) => one.resourceId === foreignConnectorId),
      false,
      'les événements d\'un import d\'autrui ne sont pas visibles'
    );
    const journalDev = await call('/api/v1/mcp-remote/journal?limit=100', 'GET', H_DEV_NO_JWT);
    assert.equal(journalDev.status, 200);
    const devEvents = (journalDev.body as { events?: Array<{ resourceId: string }> }).events ?? [];
    assert.equal(
      devEvents.some((one) => one.resourceId === foreignConnectorId),
      false,
      'appelant sans JWT : fail-closed, aucun événement non-tenant visible'
    );
  });

  /* ---- Imports personnels jamais dans le catalogue global ---- */

  it('SEP-5 : un import personnel n\'apparaît JAMAIS dans le catalogue global', async () => {
    const adminList = await call('/api/v1/mcp/admin/catalog', 'GET', H_ADMIN);
    assert.equal(adminList.status, 200);
    const entries = (adminList.body as { entries: Array<{ url: string; name: string }> }).entries;
    assert.equal(entries.some((one) => one.url === URL_PERSO_B), false, 'URL perso absente du catalogue');
    assert.equal(entries.some((one) => one.name === 'Import secret de B'), false);

    // Liste tenant : seules les lignes de configuration du tenant.
    const tenantList = await call('/api/v1/mcp-remote/connectors', 'GET', H_ADMIN);
    const tenantBody = tenantList.body as { connectors: Array<{ scope: string; url: string }> };
    assert.ok(tenantBody.connectors.every((one) => one.scope === 'tenant'));
    assert.equal(tenantBody.connectors.some((one) => one.url === URL_PERSO_B), false);

    // La création d'une ENTRÉE de catalogue n'accepte jamais scope ni secret.
    const withScope = await call('/api/v1/mcp/admin/catalog', 'POST', H_ADMIN, {
      name: 'Entrée avec scope',
      url: 'https://api-entree.example.org/mcp',
      scope: 'personal',
      secret: 'ne-doit-pas-passer'
    });
    assert.equal(withScope.status, 400, 'propriétés inconnues refusées');
    assert.equal(withScope.text.includes('ne-doit-pas-passer'), false);
  });

  /* ---- L'admin ne contourne pas les contrôles MCP ---- */

  it('SEP-6 : l\'admin ne contourne ni SSRF ni les flux d\'exécution', async () => {
    // SSRF refusé à la création comme à la mise à jour (politique serveur).
    const ssrf = await call('/api/v1/mcp/admin/catalog', 'POST', H_ADMIN, {
      name: 'SSRF admin',
      url: 'http://169.254.169.254/latest/meta-data/'
    });
    assert.equal(ssrf.status, 400, `SSRF refusé même pour l'admin : ${ssrf.text.slice(0, 160)}`);

    // Aucune route du catalogue n'exécute un outil : les seules surfaces
    // d'exécution restent prepare/call (gouvernées), testées ailleurs.
    const probes: Array<[string, string]> = [
      ['POST', `/api/v1/mcp/catalog/${publishedId}/call`],
      ['POST', `/api/v1/mcp/catalog/${publishedId}/tools/list`],
      ['POST', '/api/v1/mcp/admin/catalog/call'],
      ['POST', '/api/v1/mcp/admin/exec']
    ];
    for (const [method, path] of probes) {
      const out = await call(path, method, H_ADMIN, { tool: 'x', arguments: {} });
      assert.equal(out.status, 404, `${method} ${path} → ${out.status} (route d'exécution inexistante)`);
    }

    // L'activation exige toujours une identité : même OWNER sans JWT → 401.
    const noIdentity = await call(`/api/v1/mcp/catalog/${publishedId}/activation`, 'POST', H_DEV_NO_JWT, {});
    assert.equal(noIdentity.status, 401, `401 attendu : ${noIdentity.text.slice(0, 160)}`);
  });

  it('SEP-7 : l\'historique admin ne contient QUE des opérations administratives', async () => {
    // Une activation utilisateur a lieu (activité non-admin).
    const activate = await call(`/api/v1/mcp/catalog/${publishedId}/activation`, 'POST', H_ADMIN, {});
    assert.equal(activate.status, 200, activate.text.slice(0, 200));

    const history = await call(`/api/v1/mcp/admin/catalog/${publishedId}/history`, 'GET', H_ADMIN);
    assert.equal(history.status, 200);
    const actions = (history.body as { history: Array<{ action: string }> }).history.map((one) => one.action);
    assert.ok(actions.length > 0, 'des opérations admin sont auditées');
    for (const action of actions) {
      assert.ok(
        [
          'MCP_CATALOG_CREATED',
          'MCP_CATALOG_UPDATED',
          'MCP_CATALOG_DELETED',
          'MCP_CATALOG_TRANSITIONED',
          'MCP_CATALOG_TESTED'
        ].includes(action),
        `action non-admin dans l'historique : ${action}`
      );
    }
    // L'activation utilisateur (ci-dessus) n'apparaît PAS ici : l'historique
    // est réservé aux opérations administratives.
    assert.equal(
      actions.includes('MCP_CATALOG_ACTIVATED'),
      false,
      'activation utilisateur absente de l historique admin'
    );

    // Stats : les agrégats personnels ne contiennent QUE des compteurs.
    const stats = await call('/api/v1/mcp/admin/stats', 'GET', H_ADMIN);
    assert.equal(stats.status, 200);
    const personal = (stats.body as { personalImports: Record<string, unknown> }).personalImports;
    assert.deepEqual(Object.keys(personal).sort(), ['enabled', 'total']);
    assert.equal(stats.text.includes('Import secret de B'), false, 'aucune donnée de ligne dans les stats');
    assert.equal(stats.text.includes(URL_PERSO_B), false);
  });
});
