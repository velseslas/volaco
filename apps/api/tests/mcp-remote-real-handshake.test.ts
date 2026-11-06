/**
 * MCP-C3.3 Phase D — le test de connexion des connecteurs routés utilise le
 * CLIENT HTTPS RÉEL (RemoteMcpHttpClient) contre des serveurs TLS locaux :
 *   - négociation MCP authentique (initialize → écho 2025-03-26, session) ;
 *   - lastTest OK/FAILED persisté (recordLastTest C3.2) avec détail = CODE de
 *     transport discriminant (PROTOCOL_UNSUPPORTED / DNS_POLICY /
 *     TLS_FAILURE / TIMEOUT — estoppel §5 du cahier) ;
 *   - secrets : jamais dans les réponses, jamais dans les détails ;
 *   - la vue C3.2 /mcp/remote-servers expose l'état de test cross-surface.
 *
 * Zéro trafic Internet : le client réel est branché via le seam clientFactory
 * (TENANT test uniquement) sur des serveurs TLS 127.0.0.1 avec harnais partagé
 * (client-harness.ts) ; les protections SSRF RÉELLES (validateRemoteMcpUrl,
 * classification d adresses) restent actives — l'injection ne court-circuite
 * pas la classification (le verdict hors loopback est délégué à la RÉELLE).
 */

// MCP-TEST-ISOLATION-001 en PREMIER (VOLACO_DATA_DIR = mkdtemp hors dépôt).
import './_lot-b-legacy-env.js';

import { isolatedVolacoDataDir } from './mcp-remote-isolated-env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setMcpRemoteRuntimeForTests } from '../src/routes/mcp-remote.js';
import { RemoteMcpHttpClient, type RemoteMcpClientOptions } from '../../../packages/core/src/mcp/remote/client.js';
import {
  RemoteMcpSecretCipher,
  createRemoteMcpKeyRing
} from '../../../packages/core/src/mcp/remote/crypto.js';
import { RemoteMcpConnectorStore } from '../../../packages/core/src/mcp/remote/store.js';
import {
  allowLoopbackOrRealPolicy,
  CA_CERT_PEM,
  generateLeaf,
  LEAF_MAIN,
  startMockServer,
  standardMcpHandler
} from '../../../packages/core/tests/mcp/remote/client-harness.js';

const DATA_DIR = isolatedVolacoDataDir;

const T_MANAGER = 'studio-local';
const H_OWNER = { 'Content-Type': 'application/json', 'x-tenant-id': T_MANAGER, 'x-user-role': 'OWNER' };
const CONNECTORS = '/api/v1/mcp-remote/connectors';
const SERVERS = '/api/v1/mcp/remote-servers';

const SECRET_TOKEN = 'tok_c33_' + randomBytes(9).toString('hex');

/** Modes de transport par test : policy de test (loopback) ou production-like (réelle). */
type PolicyMode = 'loopback' | 'real';
let policyMode: PolicyMode = 'loopback';
/** Hostname mappé vers 127.0.0.1 par le résolveur de test de la phase. */
let mappedHostname = '';

const TEST_RESOLVER = async (host: string): Promise<readonly { address: string; family: number }[]> =>
  host === mappedHostname ? [{ address: '127.0.0.1', family: 4 }] : [];

function realClientFactory(options: RemoteMcpClientOptions): RemoteMcpHttpClient {
  // Client RÉEL (la même classe qu'en production) + coutures de harnais de
  // test uniquement : résolution DNS injectée (TLD .invalid → 127.0.0.1) et
  // Span d'AC local (le serveur mock est signé par l'AC du harnais).
  if (policyMode === 'real') {
    // Production-like : SANS addressPolicyForTests — la classification
    // d'adresses RÉELLE statue (les loopback sont refusés pré-socket).
    return new RemoteMcpHttpClient({
      ...options,
      caPem: CA_CERT_PEM,
      dnsResolverForTests: TEST_RESOLVER
    });
  }
  return new RemoteMcpHttpClient({
    ...options,
    caPem: CA_CERT_PEM,
    dnsResolverForTests: TEST_RESOLVER,
    addressPolicyForTests: allowLoopbackOrRealPolicy
  });
}

let baseUrl = '';
let server: Server | undefined;
let c33Store: RemoteMcpConnectorStore;

interface JsonOut { status: number; text: string; body: unknown }

async function call(path: string, method: string, payload?: unknown): Promise<JsonOut> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: H_OWNER,
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

async function createConnector(url: string): Promise<string> {
  const res = await call(CONNECTORS, 'POST', { name: 'Connecteur C3.3 réel', url, secret: SECRET_TOKEN });
  assert.equal(res.status, 201, `création du connecteur attendue (${res.text})`);
  const record = recordOf(res) as { connector?: { connectorId?: string } };
  assert.equal(typeof record.connector?.connectorId, 'string');
  return record.connector!.connectorId!;
}

describe('MCP-C3.3 Phase D : test de connexion via le CLIENT HTTPS RÉEL (routes)', () => {
  before(async () => {
    c33Store = new RemoteMcpConnectorStore(
      new RemoteMcpSecretCipher(createRemoteMcpKeyRing({ active: { keyId: 'c33-real', key: randomBytes(32) } }))
    );
    setMcpRemoteRuntimeForTests({
      connectorStore: () => c33Store,
      clientFactory: realClientFactory
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
      // Windows : SQLite encore ouverte — répertoire temporaire système.
    }
  });

  it('RH-1 handshake MCP réel via TLS local : route ok:true, lastTest OK, session capturée', async () => {
    mappedHostname = 'mcp-handshake-1.invalid';
    policyMode = 'loopback';
    // Feuille dédiée au cas : SAN = hostname du connecteur (l'AC du harnais
    // la signe ; le client réel vérifie la chaîne + l'identité du nom d'origine).
    const leaf = generateLeaf(mappedHostname, [mappedHostname]);
    const handle = await startMockServer(leaf, ctx => standardMcpHandler(ctx));
    try {
      const connectorId = await createConnector(`https://${mappedHostname}:${handle.port}/mcp`);
      const tested = await call(`${CONNECTORS}/${connectorId}/test`, 'POST', {});
      assert.equal(tested.status, 200);
      const record = recordOf(tested) as Record<string, unknown>;
      assert.equal(record.ok, true);
      assert.equal(record.sessionCaptured, true);
      assert.ok(!tested.text.includes(SECRET_TOKEN), 'bearer jamais dans la réponse');
      const lastTest = c33Store.getLastTest(T_MANAGER, connectorId);
      assert.ok(lastTest !== null);
      assert.equal(lastTest.status, 'OK');
      assert.equal(lastTest.detail, null);
      // Vue C3.2 cross-surface : l'état de test est exposé aux serveurs.
      const view = await call(`${SERVERS}/${connectorId}`, 'GET');
      assert.equal(view.status, 200);
      const serverView = (recordOf(view) as { server?: Record<string, unknown> }).server ?? {};
      const viewLastTest = serverView.lastTest as Record<string, unknown>;
      assert.equal(viewLastTest.status, 'OK');
    } finally {
      await handle.close();
    }
  });

  it('RH-2 serveur incompatible (écho de version inconnu) : lastTest FAILED detail PROTOCOL_UNSUPPORTED', async () => {
    mappedHostname = 'mcp-handshake-2.invalid';
    policyMode = 'loopback';
    const leaf2 = generateLeaf(mappedHostname, [mappedHostname]);
    const handle = await startMockServer(leaf2, ({ res, bodyText }) => {
      const body = JSON.parse(bodyText) as { id?: number; method?: string };
      if (body.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id ?? 0,
          result: { protocolVersion: '1999-01-01', capabilities: {}, serverInfo: { name: 'vieux', version: '0' } }
        }));
        return;
      }
      standardMcpHandler({ res, bodyText });
    });
    try {
      const connectorId = await createConnector(`https://${mappedHostname}:${handle.port}/mcp`);
      const tested = await call(`${CONNECTORS}/${connectorId}/test`, 'POST', {});
      assert.equal(tested.status, 200);
      assert.equal((recordOf(tested) as Record<string, unknown>).ok, false);
      const lastTest = c33Store.getLastTest(T_MANAGER, connectorId);
      assert.ok(lastTest !== null);
      assert.equal(lastTest.status, 'FAILED');
      assert.equal(lastTest.detail, 'PROTOCOL_UNSUPPORTED', 'code transport discriminant persisté');
    } finally {
      await handle.close();
    }
  });

  it('RH-3 DNS refusé (classification RÉELLE sans policy de test) : lastTest FAILED detail DNS_POLICY', async () => {
    mappedHostname = 'mcp-handshake-3.invalid';
    policyMode = 'real'; // SANS addressPolicyForTests : verdict réel
    const handle = await startMockServer(LEAF_MAIN, () => { /* ne doit pas être joint */ });
    try {
      const connectorId = await createConnector(`https://${mappedHostname}:${handle.port}/mcp`);
      const tested = await call(`${CONNECTORS}/${connectorId}/test`, 'POST', {});
      assert.equal(tested.status, 200);
      assert.equal((recordOf(tested) as Record<string, unknown>).ok, false);
      const lastTest = c33Store.getLastTest(T_MANAGER, connectorId);
      assert.ok(lastTest !== null);
      assert.equal(lastTest.status, 'FAILED');
      assert.equal(lastTest.detail, 'DNS_POLICY');
      assert.equal(handle.requests.length, 0, 'aucun contact réseau après refus');
    } finally {
      policyMode = 'loopback';
      await handle.close();
    }
  });

  it('RH-4 TLS hostname incorrect : lastTest FAILED detail TLS_FAILURE', async () => {
    mappedHostname = 'mcp-remote-tests-b.invalid'; // le serveur porte LEAF_MAIN (autre CN)
    policyMode = 'loopback';
    const handle = await startMockServer(LEAF_MAIN, () => { /* TLS refusé avant */ });
    try {
      const connectorId = await createConnector(`https://${mappedHostname}:${handle.port}/mcp`);
      const tested = await call(`${CONNECTORS}/${connectorId}/test`, 'POST', {});
      assert.equal(tested.status, 200);
      assert.equal((recordOf(tested) as Record<string, unknown>).ok, false);
      const lastTest = c33Store.getLastTest(T_MANAGER, connectorId);
      assert.ok(lastTest !== null);
      assert.equal(lastTest.status, 'FAILED');
      assert.equal(lastTest.detail, 'TLS_FAILURE');
      assert.ok(!tested.text.includes(SECRET_TOKEN), 'secret jamais reflété même en échec');
    } finally {
      await handle.close();
    }
  });

  it('RH-5 timeout demandé via la route : annulation réelle, lastTest FAILED detail TIMEOUT', async () => {
    mappedHostname = 'mcp-handshake-5.invalid';
    policyMode = 'loopback';
    const leaf5 = generateLeaf(mappedHostname, [mappedHostname]);
    let serverAnswered = false;
    const handle = await startMockServer(leaf5, ({ res }) => {
      serverAnswered = true; // la réponse tardive (jamais consommée côté client)
      setTimeout(() => {
        if (!res.writableEnded) res.end();
      }, 4_000);
    });
    try {
      const connectorId = await createConnector(`https://${mappedHostname}:${handle.port}/mcp`);
      const tested = await call(`${CONNECTORS}/${connectorId}/test`, 'POST', { timeoutMs: 1_200 });
      assert.equal(tested.status, 200);
      assert.equal((recordOf(tested) as Record<string, unknown>).ok, false);
      const lastTest = c33Store.getLastTest(T_MANAGER, connectorId);
      assert.ok(lastTest !== null);
      assert.equal(lastTest.status, 'FAILED');
      assert.equal(lastTest.detail, 'TIMEOUT');
      assert.equal(serverAnswered, true, 'le serveur devait encore attendre à l échéance client');
    } finally {
      await handle.close();
    }
  });

  it('RH-6 redirection malveillante (downgrade http) via la route : lastTest FAILED detail REDIRECT_POLICY', async () => {
    mappedHostname = 'mcp-handshake-6.invalid';
    policyMode = 'loopback';
    const leaf6 = generateLeaf(mappedHostname, [mappedHostname]);
    const handle = await startMockServer(leaf6, ({ res }) => {
      res.writeHead(302, { location: `http://${mappedHostname}:9443/ok` });
      res.end();
    });
    try {
      const connectorId = await createConnector(`https://${mappedHostname}:${handle.port}/mcp`);
      const tested = await call(`${CONNECTORS}/${connectorId}/test`, 'POST', {});
      assert.equal(tested.status, 200);
      assert.equal((recordOf(tested) as Record<string, unknown>).ok, false);
      const lastTest = c33Store.getLastTest(T_MANAGER, connectorId);
      assert.ok(lastTest !== null);
      assert.equal(lastTest.status, 'FAILED');
      assert.equal(lastTest.detail, 'REDIRECT_POLICY');
      assert.equal(handle.requests.length, 1, 'le saut 2 (http) n est jamais joint');
    } finally {
      await handle.close();
    }
  });
});
