/**
 * C3.3 — Batterie de durcissement du client HTTPS MCP réel :
 * preuves SSRF réseau (DNS rebinding, redirections, TLS) + résilience +
 * session + défauts centralisés, sur la MÊME griffe que client.test.ts
 * (client-harness.ts) : moteurs RÉELS partout, serveurs locaux 127.0.0.1,
 * TLD .invalid jamais résolu hors injections = zéro trafic Internet.
 *
 * Les cas déjà couverts par client.test.ts (DNS mixte refusé avant contact,
 * redirection vers adresse privée littérale, chaîne > 3 redirections,
 * cross-origin credentials abandonnés, TLS hostname incorrect, plafonds de
 * taille, timeout borné sans lecture du corps, JSON-RPC malformé, secret
 * réfléchi rédigé…) ne sont PAS dupliqués ici — ce fichier comble les
 * lacunes précises contre la grille §7 du cahier C3.3.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RemoteMcpHttpClient,
  RemoteMcpClientError,
  REMOTE_MCP_DEFAULT_MAX_REQUEST_BYTES,
  REMOTE_MCP_DEFAULT_MAX_RESPONSE_BYTES,
  REMOTE_MCP_DEFAULT_TIMEOUT_MS,
  REMOTE_MCP_HTTP_PROTOCOL_VERSION,
  type RemoteMcpClientOptions
} from '../../../src/mcp/remote/client.js';
import { REMOTE_MCP_MAX_REDIRECTS } from '../../../src/mcp/remote/url-policy.js';
import {
  allowLoopbackOrRealPolicy,
  asClientError,
  BEARER_TOKEN_VALUE,
  DEFAULT_LOOPBACK_RESOLVER,
  LEAF_EXPIRED,
  LEAF_MAIN,
  respondJsonRpcResult,
  respondRaw,
  spyResolver,
  standardMcpHandler,
  startMockServer,
  TEST_HOSTNAME,
  testClientOptions
} from './client-harness.js';

describe('C3.3 : client MCP réel — SSRF, TLS, résilience (grille §7 du cahier)', () => {

  it('C33-1 DNS rebinding : UNE seule résolution par saut — aucune seconde résolution entre validation et connexion', async () => {
    const handle = await startMockServer(LEAF_MAIN, ctx => standardMcpHandler(ctx));
    try {
      const spy = spyResolver({ [TEST_HOSTNAME]: ['127.0.0.1'] });
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`, { dnsResolverForTests: spy.resolver })
      );
      const init = await client.initialize();
      assert.equal(init.protocolVersion, REMOTE_MCP_HTTP_PROTOCOL_VERSION);
      // initialize + notification = 2 enveloppes POST → EXACTEMENT 2 résolutions.
      // Une implémentation naïve « résout pour valider puis re-résout pour
      // connecter » en produirait 4 : ici la fenêtre de rebind est FERMÉE.
      assert.deepEqual(spy.hostsSeen, [TEST_HOSTNAME, TEST_HOSTNAME]);
      // agent:false : chaque enveloppe = socket neuve et handshake distinct.
      assert.equal(handle.getTlsHandshakeCount(), 2);
      for (const request of handle.requests) {
        assert.equal(request.headers.authorization, `Bearer ${BEARER_TOKEN_VALUE}`);
      }
    } finally {
      await handle.close();
    }
  });

  it('C33-2 rebinding inter-saut : le SAUT 2 est re-résolu puis refusé par la classification RÉELLE', async () => {
    const spy = spyResolver({
      [TEST_HOSTNAME]: ['127.0.0.1'],
      'rebind-alt.invalid': ['10.9.8.7'] // cible privée découvrable UNIQUEMENT au saut 2
    });
    const handle = await startMockServer(LEAF_MAIN, ({ req, res }) => {
      if (req.method === 'POST') {
        res.writeHead(302, { location: 'https://rebind-alt.invalid/mcp' });
        res.end();
      }
    });
    try {
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`, { dnsResolverForTests: spy.resolver })
      );
      let failure: RemoteMcpClientError | null = null;
      try {
        await client.initialize();
      } catch (error) {
        failure = asClientError(error);
      }
      assert.ok(failure !== null, 'la résolution interdite du saut 2 devait être refusée');
      assert.equal(failure.code, 'DNS_POLICY');
      // Le serveur du saut 1 a vu EXACTEMENT une requête (la 302) ; la cible
      // privée du saut 2 n'a JAMAIS été contactée : refus au stade DNS, avant
      // toute socket.
      assert.equal(handle.requests.length, 1);
      assert.deepEqual(spy.hostsSeen, [TEST_HOSTNAME, 'rebind-alt.invalid']);
    } finally {
      await handle.close();
    }
  });

  it('C33-3 bypass impossible : résolveur de test SANS policy → la classification réelle refuse loopback', async () => {
    let handlerTouched = false;
    const handle = await startMockServer(LEAF_MAIN, () => {
      handlerTouched = true; // ne doit JAMAIS être atteint (refus pré-socket)
    });
    try {
      // Production-like : résolveur injecté mais PAS d'addressPolicyForTests —
      // assertPublicResolvedAddresses RÉELLE statue et refuse loopback.
      const options: RemoteMcpClientOptions = {
        url: `https://${TEST_HOSTNAME}:${handle.port}/mcp`,
        connectorId: 'conn-c33-bypass',
        bearerToken: BEARER_TOKEN_VALUE,
        dnsResolverForTests: DEFAULT_LOOPBACK_RESOLVER
      };
      const client = new RemoteMcpHttpClient(options);
      let failure: RemoteMcpClientError | null = null;
      try {
        await client.initialize();
      } catch (error) {
        failure = asClientError(error);
      }
      assert.ok(failure !== null, 'la classification réelle doit refuser loopback');
      assert.equal(failure.code, 'DNS_POLICY');
      assert.ok(failure.message.includes('NON_PUBLIC_ADDRESS'));
      assert.equal(handlerTouched, false, 'aucun contact réseau');
      assert.equal(handle.requests.length, 0);
      assert.equal(handle.getTlsHandshakeCount(), 0, 'aucun handshake TLS');
    } finally {
      await handle.close();
    }
  });

  it('C33-4 redirection : downgrade http:// refusé (policy réelle à chaque saut)', async () => {
    const handle = await startMockServer(LEAF_MAIN, ({ res }) => {
      res.writeHead(302, { location: `http://${TEST_HOSTNAME}:9443/ok` });
      res.end();
    });
    try {
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`)
      );
      let failure: RemoteMcpClientError | null = null;
      try {
        await client.initialize();
      } catch (error) {
        failure = asClientError(error);
      }
      assert.ok(failure !== null, 'le downgrade http attendait un refus');
      assert.equal(failure.code, 'REDIRECT_POLICY');
      assert.equal(handle.requests.length, 1, 'le saut 2 n est jamais contacté');
    } finally {
      await handle.close();
    }
  });

  it('C33-5 redirection vers l endpoint de métadonnées cloud (169.254.169.254) : refus au niveau URL', async () => {
    const handle = await startMockServer(LEAF_MAIN, ({ res }) => {
      res.writeHead(302, { location: 'https://169.254.169.254/latest/meta-data' });
      res.end();
    });
    try {
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`)
      );
      let failure: RemoteMcpClientError | null = null;
      try {
        await client.initialize();
      } catch (error) {
        failure = asClientError(error);
      }
      assert.ok(failure !== null, 'la cible metadata devait être refusée');
      assert.equal(failure.code, 'REDIRECT_POLICY');
      assert.equal(handle.requests.length, 1);
    } finally {
      await handle.close();
    }
  });

  it('C33-6 certificat expiré : TLS refusé avant tout échange applicatif', async () => {
    const handle = await startMockServer(LEAF_EXPIRED, ctx => standardMcpHandler(ctx));
    try {
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`)
      );
      let failure: RemoteMcpClientError | null = null;
      try {
        await client.initialize();
      } catch (error) {
        failure = asClientError(error);
      }
      assert.ok(failure !== null, 'le certificat expiré devait être refusé');
      assert.equal(failure.code, 'TLS_FAILURE');
      assert.equal(handle.requests.length, 0, 'aucune requête MCP transmise');
      assert.equal(handle.getTlsHandshakeCount(), 0, 'aucun handshake achevé');
    } finally {
      await handle.close();
    }
  });

  it('C33-7 certificat non fiable (self-signed hors AC fixée) : TLS refusé', async () => {
    const handle = await startMockServer(LEAF_MAIN, ctx => standardMcpHandler(ctx));
    try {
      // Production-like : AUCUN caPem fourni (magasin système) → self-signed
      // non ancré → rejet (rejectUnauthorized figé : aucune option de bypass).
      // La policy de test (loopback autorisé) reste présente pour que la
      // validation soit dépassée et que le VÉRITABLE refus TLS soit éprouvé.
      const options: RemoteMcpClientOptions = {
        url: `https://${TEST_HOSTNAME}:${handle.port}/mcp`,
        connectorId: 'conn-c33-untrusted',
        bearerToken: BEARER_TOKEN_VALUE,
        dnsResolverForTests: DEFAULT_LOOPBACK_RESOLVER,
        addressPolicyForTests: allowLoopbackOrRealPolicy
      };
      const client = new RemoteMcpHttpClient(options);
      let failure: RemoteMcpClientError | null = null;
      try {
        await client.initialize();
      } catch (error) {
        failure = asClientError(error);
      }
      assert.ok(failure !== null, 'le certificat non ancré devait être refusé');
      assert.equal(failure.code, 'TLS_FAILURE');
      assert.equal(handle.requests.length, 0);
    } finally {
      await handle.close();
    }
  });

  it('C33-8 connexion refusée (aucun auditeur) : CONNECT_ERROR, bearer jamais reflété', async () => {
    const victim = await startMockServer(LEAF_MAIN, () => { /* jamais servi */ });
    const deadPort = victim.port;
    await victim.close();
    const client = new RemoteMcpHttpClient(
      testClientOptions(`https://${TEST_HOSTNAME}:${deadPort}/mcp`)
    );
    let failure: RemoteMcpClientError | null = null;
    try {
      await client.initialize();
    } catch (error) {
      failure = asClientError(error);
    }
    assert.ok(failure !== null, 'l échec de connexion était attendu');
    assert.equal(failure.code, 'CONNECT_ERROR');
    assert.ok(!failure.message.includes(BEARER_TOKEN_VALUE), 'bearer jamais dans l erreur');
  });

  it('C33-9 flux coupé en cours de corps : CONNECT_ERROR (interruption avant fin de réponse)', async () => {
    const handle = await startMockServer(LEAF_MAIN, ({ res }) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"jsonrpc":"2.0","id":1,');
      setTimeout(() => {
        res.socket?.destroy(); // interrompt le flux AVANT la fin du corps
      }, 150);
    });
    try {
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`, { timeoutMs: 5_000 })
      );
      let failure: RemoteMcpClientError | null = null;
      try {
        await client.initialize();
      } catch (error) {
        failure = asClientError(error);
      }
      assert.ok(failure !== null, 'l interruption du flux devait échouer proprement');
      assert.equal(failure.code, 'CONNECT_ERROR');
    } finally {
      await handle.close();
    }
  });

  it('C33-10 réponse SSE sans évènement portant l id attendu : JSONRPC_INVALID', async () => {
    const handle = await startMockServer(LEAF_MAIN, ({ res }) => {
      const payload = JSON.stringify({ jsonrpc: '2.0', id: 999, result: {} });
      respondRaw(
        res,
        200,
        Buffer.from(`data: ${payload}\n\n`),
        { 'content-type': 'text/event-stream' }
      );
    });
    try {
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`)
      );
      let failure: RemoteMcpClientError | null = null;
      try {
        await client.initialize();
      } catch (error) {
        failure = asClientError(error);
      }
      assert.ok(failure !== null, 'le flux discordant devait échouer');
      assert.equal(failure.code, 'JSONRPC_INVALID');
    } finally {
      await handle.close();
    }
  });

  it('C33-11 serveur incompatible (initialize sans serverInfo) : ENCODING_INVALID', async () => {
    const handle = await startMockServer(LEAF_MAIN, ({ res, bodyText }) => {
      const body = JSON.parse(bodyText) as { id?: number; method?: string };
      if (body.method === 'initialize') {
        respondJsonRpcResult(res, body.id ?? 0, {
          protocolVersion: REMOTE_MCP_HTTP_PROTOCOL_VERSION,
          capabilities: {}
          // serverInfo ABSENT : incompatible côté client fail-closed
        });
        return;
      }
      standardMcpHandler({ res, bodyText });
    });
    try {
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`)
      );
      let failure: RemoteMcpClientError | null = null;
      try {
        await client.initialize();
      } catch (error) {
        failure = asClientError(error);
      }
      assert.ok(failure !== null, 'serverInfo manquant est incompatible');
      assert.equal(failure.code, 'ENCODING_INVALID');
    } finally {
      await handle.close();
    }
  });

  it('C33-12 Mcp-Session-Id malformé : jamais adopté (fail-closed)', async () => {
    const handle = await startMockServer(LEAF_MAIN, ({ res, bodyText }) => {
      const body = JSON.parse(bodyText) as { id?: number; method?: string };
      if (body.method === 'initialize') {
        respondJsonRpcResult(
          res,
          body.id ?? 0,
          {
            protocolVersion: REMOTE_MCP_HTTP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-mcp-server', version: '1.2.3' }
          },
          { 'mcp-session-id': 'sess moisi v2' } // espace : hors motif d'identifiant de session
        );
        return;
      }
      standardMcpHandler({ res, bodyText });
    });
    try {
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`)
      );
      await client.initialize();
      assert.equal(client.session.sessionId, null, 'la session invalide n est pas adoptée');
    } finally {
      await handle.close();
    }
  });

  it('C33-13 défauts réseau centralisés (C3.3 §4.5) : 10 s / 1 MiB / 1 MiB / 3 redirections', () => {
    assert.equal(REMOTE_MCP_DEFAULT_TIMEOUT_MS, 10_000, 'délai global par défaut : 10 secondes');
    assert.equal(REMOTE_MCP_DEFAULT_MAX_RESPONSE_BYTES, 1_048_576, 'réponse : 1 Mo');
    assert.equal(REMOTE_MCP_DEFAULT_MAX_REQUEST_BYTES, 1_048_576, 'requête : 1 Mo');
    assert.equal(REMOTE_MCP_MAX_REDIRECTS, 3, 'redirections : 3 sauts maximum');
  });
});
