/**
 * C3.2-A — Tests du client HTTPS MCP distant.
 *
 * Serveur de test : TLS local sur 127.0.0.1 avec CA + feuilles générés en DER
 * natif (aucune dépendance, aucun binaire externe, aucune attente réseau).
 * L URL pointe vers un nom DNS factice (TLD .invalid — jamais résolu : aucun
 * trafic réel) ; les résolutions sont INJECTÉES via dnsResolverForTests et
 * seule l ingestion loopback passe l adressePolicyForTests de test, tout
 * verdict hors loopback délégué à assertPublicResolvedAddresses RÉELLE.
 * validateRemoteMcpUrl et validateRemoteMcpRedirectChain restent toujours
 * réels (fonctions pures sans réseau).
 *
 * C3.3 — l'infra de harnais de ce fichier (DER/X.509, serveur TLS mock,
 * résolveurs et helpers de client) est désormais EXTRAITE dans
 * ./client-harness.ts, partagée avec client-c33.test.ts (batterie C3.3) —
 * une seule source de vérité des preuves : ce fichier n'ajuste QUE ses
 * imports ; les cas de test ci-dessous restent inchangés à l'octet près.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import {
  RemoteMcpHttpClient,
  RemoteMcpClientError,
  extractSseMessageForId,
  REMOTE_MCP_HTTP_PROTOCOL_VERSION,
  type RemoteMcpClientOptions
} from '../../../src/mcp/remote/client.js';
import {
  allowLoopbackOrRealPolicy,
  asClientError,
  BEARER_TOKEN_VALUE,
  DEFAULT_LOOPBACK_RESOLVER,
  HAPPY_TOOLS,
  HOST_B,
  LEAF_B,
  LEAF_MAIN,
  LEAF_MISMATCH,
  parseRpcBody,
  respondJsonRpcError,
  respondJsonRpcResult,
  respondRaw,
  spyResolver,
  standardMcpHandler,
  startMockServer,
  TEST_HOSTNAME,
  testClientOptions,
  type MockBody
} from './client-harness.js';

/* ============================ tests ============================ */

describe('C3.2-A : client HTTPS MCP distant', () => {
  it('initialize : TLS vérifié + SNI nominal + IP épinglée + bearer + session + idempotence', async () => {
    const handle = await startMockServer(LEAF_MAIN, ctx => standardMcpHandler(ctx));
    try {
      const client = new RemoteMcpHttpClient(testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`));
      const init = await client.initialize();
      assert.equal(init.protocolVersion, REMOTE_MCP_HTTP_PROTOCOL_VERSION);
      assert.equal(init.serverName, 'mock-mcp-server');
      assert.equal(init.serverVersion, '1.2.3');
      assert.deepEqual(init.capabilities as Record<string, unknown>, { tools: {} });
      assert.equal(init.sessionId, 'sess-alpha-1');

      // Requête initialize observée côté serveur (indice 0).
      const initRequest = handle.requests[0];
      assert.ok(initRequest);
      assert.equal(initRequest.method, 'POST');
      assert.equal(initRequest.path, '/mcp');
      assert.equal(initRequest.headers['host'], `${TEST_HOSTNAME}:${handle.port}`);
      assert.equal(initRequest.headers['authorization'], `Bearer ${BEARER_TOKEN_VALUE}`);
      assert.ok(String(initRequest.headers['accept'] ?? '').includes('application/json'));
      assert.equal(initRequest.headers['mcp-protocol-version'], undefined);
      const initBody = parseRpcBody(initRequest.bodyText);
      assert.equal(initBody.id, 1);
      assert.equal(initBody.method, 'initialize');
      assert.deepEqual(initBody.params?.['capabilities'], {});
      assert.deepEqual(initBody.params?.['clientInfo'], { name: 'volaco-core-mcp-remote-client', version: '0.1.0' });

      // SNI reçu = hostname d origine (pas l IP épinglée) — mécanique preuve P1.
      // initialize() envoie DEUX requêtes avant de résoudre : initialize +
      // notification notifications/initialized best-effort. Politique du
      // client : une socket NEUVE à chaque requête → 2 handshakes légitimes.
      assert.deepEqual(handle.sniNames, [TEST_HOSTNAME, TEST_HOSTNAME]);
      assert.equal(handle.getTlsHandshakeCount(), 2);

      // Notification (indice 1) — POST simple, sans id.
      const notifRequest = handle.requests[1];
      assert.ok(notifRequest);
      assert.equal(notifRequest.method, 'POST');
      assert.equal(notifRequest.path, '/mcp');
      assert.equal(notifRequest.headers['authorization'], `Bearer ${BEARER_TOKEN_VALUE}`);
      const notifBody = parseRpcBody(notifRequest.bodyText);
      assert.equal(notifBody.method, 'notifications/initialized');
      assert.equal(notifBody.id, undefined);

      // tools/list (indice 2) — headers de session/protocole + id suivant.
      const tools = await client.listTools();
      assert.equal(tools.nextCursor, null);
      assert.equal(tools.tools[0]?.name, 'echo');
      const firstToolSchema = tools.tools[0]?.inputSchema as { type?: string } | undefined;
      assert.equal(firstToolSchema?.type, 'object');
      const listRequest = handle.requests[2];
      assert.ok(listRequest);
      assert.equal(parseRpcBody(listRequest.bodyText).id, 2);
      assert.equal(listRequest.headers['mcp-session-id'], 'sess-alpha-1');
      assert.equal(listRequest.headers['mcp-protocol-version'], REMOTE_MCP_HTTP_PROTOCOL_VERSION);

      // tools/call (indice 3).
      const call = await client.callTool('echo', { question: 'coucou' });
      assert.equal(call.isError, false);
      const firstContent = call.content[0] as { type?: string; text?: string } | undefined;
      assert.equal(firstContent?.text, 'salut coucou');

      // initialize() rappelée : cache local, aucun nouveau contact.
      const secondInit = await client.initialize();
      assert.equal(secondInit.protocolVersion, REMOTE_MCP_HTTP_PROTOCOL_VERSION);
      assert.equal(handle.requests.length, 4);
      assert.equal(handle.getTlsHandshakeCount(), 4);
    } finally {
      await handle.close();
    }
  });

  it('tools/list : pagination cursor respectée (params.cursor transmis tel quel)', async () => {
    const handle = await startMockServer(LEAF_MAIN, ctx => {
      let body: MockBody;
      try {
        body = parseRpcBody(ctx.bodyText);
      } catch {
        respondRaw(ctx.res, 400, Buffer.from('mock'), {});
        return;
      }
      if (body.method === 'initialize') {
        respondJsonRpcResult(
          ctx.res,
          body.id ?? 0,
          {
            protocolVersion: REMOTE_MCP_HTTP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-paginated', version: '0.9' }
          },
          { 'mcp-session-id': 'sess-pag-2' }
        );
        return;
      }
      if (body.method === 'notifications/initialized') {
        ctx.res.writeHead(202);
        ctx.res.end();
        return;
      }
      if (body.method === 'tools/list') {
        if (body.params?.['cursor'] === 'tok-1') {
          // Dernière page : nextCursor ABSENT (absence canonique). Un null
          // explicite serait une forme non spécifiée que le client refuse
          // fail-closed (c'est le comportement attendu du client).
          respondJsonRpcResult(ctx.res, body.id ?? 0, { tools: [HAPPY_TOOLS[1]] });
          return;
        }
        respondJsonRpcResult(ctx.res, body.id ?? 0, { tools: [HAPPY_TOOLS[0]], nextCursor: 'tok-1' });
        return;
      }
      respondJsonRpcError(ctx.res, body.id ?? 0, -32601, 'mock');
    });
    try {
      const client = new RemoteMcpHttpClient(testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`));
      const page1 = await client.listTools();
      assert.equal(page1.nextCursor, 'tok-1');
      assert.equal(page1.tools[0]?.name, 'echo');
      const page2 = await client.listTools('tok-1');
      assert.equal(page2.nextCursor, null);
      assert.equal(page2.tools[0]?.name, 'server_status');
      const paginated = handle.requests.find(
        record => parseRpcBody(record.bodyText).method === 'tools/list' &&
          parseRpcBody(record.bodyText).params?.['cursor'] === 'tok-1'
      );
      assert.ok(paginated);
      assert.equal(parseRpcBody(paginated.bodyText).params?.['cursor'], 'tok-1');
    } finally {
      await handle.close();
    }
  });

  it('hostname incompatible avec le certificat : TLS refusé, aucun échange applicatif', async () => {
    const handle = await startMockServer(LEAF_MISMATCH, ctx => standardMcpHandler(ctx));
    try {
      const client = new RemoteMcpHttpClient(testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`));
      await assert.rejects(
        client.initialize(),
        (error: unknown) => {
          const clientError = asClientError(error);
          assert.equal(clientError.code, 'TLS_FAILURE');
          assert.ok(clientError.message.includes('TLS'));
          return true;
        }
      );
      // Le client abrège PENDANT la vérification du certificat, avant d avoir
      // envoyé son Finished TLS 1.3 : côté serveur, aucun canal n a atteint
      // secureConnection (donc sniNames vide, de façon déterministe) et AUCUN
      // échange applicatif n a atteint le handler mock.
      assert.deepEqual(handle.sniNames, []);
      assert.equal(handle.requests.length, 0);
    } finally {
      await handle.close();
    }
  });

  it('DNS mixte (publique + interdite) : refus avant tout contact réseau', async () => {
    const spy = spyResolver({ [TEST_HOSTNAME]: ['93.184.216.34', '127.0.0.1'] });
    const handle = await startMockServer(LEAF_MAIN, ctx => {
      throw new Error('CONTACT INTERDIT DANS CE TEST');
    });
    try {
      // SANS addressPolicyForTests : la classification réelle décide.
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`, { dnsResolverForTests: spy.resolver })
      );
      await assert.rejects(
        client.initialize(),
        (error: unknown) => {
          const clientError = asClientError(error);
          assert.equal(clientError.code, 'DNS_POLICY');
          assert.ok(clientError.message.includes('NON_PUBLIC_ADDRESS'));
          return true;
        }
      );
      assert.deepEqual(spy.hostsSeen, [TEST_HOSTNAME]);
      assert.equal(handle.requests.length, 0);
      assert.equal(handle.getTlsHandshakeCount(), 0);
      assert.deepEqual(handle.sniNames, []);
    } finally {
      await handle.close();
    }
  });

  it('DNS 100 pour cent interdite, non IP ou vide : refus identique (fail-closed)', async () => {
    // Cas 127.0.0.1 enlevé : le seam de test (allowLoopbackOrRealPolicy) accepte
    // le loopback pour pouvoirtester le serveur local — le refus loopback par
    // la politique réelle est déjà prouvé dans les tests C3.1 dédiés.
    // Ici : non publiques NON-loopback, et résolution vide.
    const cases: Array<Record<string, readonly string[]>> = [
      { [TEST_HOSTNAME]: ['10.0.0.9'] },
      { [TEST_HOSTNAME]: [] }
    ];
    for (const mapping of cases) {
      const spy = spyResolver(mapping);
      const handle = await startMockServer(LEAF_MAIN, ctx => standardMcpHandler(ctx));
      try {
        const client = new RemoteMcpHttpClient(
          testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`, { dnsResolverForTests: spy.resolver })
        );
        await assert.rejects(
          client.initialize(),
          (error: unknown) => {
            const clientError = asClientError(error);
            assert.equal(clientError.code, 'DNS_POLICY');
            return true;
          }
        );
        assert.equal(handle.getTlsHandshakeCount(), 0);
      } finally {
        await handle.close();
      }
    }
  });

  it('redirection vers adresse privée : URL refusée par la politique réelle, jamais résolue ni contactée', async () => {
    const spy = spyResolver({ [TEST_HOSTNAME]: ['127.0.0.1'] });
    const handle = await startMockServer(LEAF_MAIN, ctx => {
      const body = parseRpcBody(ctx.bodyText);
      if (body.method === 'initialize') {
        standardMcpHandler(ctx);
        return;
      }
      if (body.method === 'notifications/initialized') {
        ctx.res.writeHead(202);
        ctx.res.end();
        return;
      }
      if (body.method === 'tools/list') {
        ctx.res.writeHead(302, { location: 'https://10.9.8.7/hop-prive' });
        ctx.res.end();
        return;
      }
      respondJsonRpcError(ctx.res, body.id ?? 0, -32601, 'mock');
    });
    try {
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`, { dnsResolverForTests: spy.resolver })
      );
      await client.initialize();
      await assert.rejects(
        client.listTools(),
        (error: unknown) => {
          const clientError = asClientError(error);
          assert.equal(clientError.code, 'REDIRECT_POLICY');
          assert.ok(clientError.message.includes('NON_PUBLIC_ADDRESS'));
          return true;
        }
      );
      // Le client revalide le DNS à CHAQUE requête (initialize + notification +
      // tools/list) : 3 résolutions du seul hostname du serveur A. La cible
      // privée n a JAMAIS été résolue : validateRemoteMcpUrl la refuse avant
      // le passage au DNS (aucune fuite de résolution d adresse interdite).
      assert.deepEqual(spy.hostsSeen, [TEST_HOSTNAME, TEST_HOSTNAME, TEST_HOSTNAME]);
      // 3 requêtes seulement : initialize + notification + tools/list (celui
      // qui fork la redirection — lue, suivie côté politique, PUIS refusée).
      // La cible privée n a JAMAIS été contactée ni résolue.
      assert.equal(handle.requests.length, 3);
    } finally {
      await handle.close();
    }
  });

  it('chaîne de redirections au-delà de 3 : REDIRECT_LIMIT, aucun contact au saut 4', async () => {
    const spy = spyResolver({ [TEST_HOSTNAME]: ['127.0.0.1'] });
    const handle = await startMockServer(LEAF_MAIN, ctx => {
      if (ctx.req.url === '/start') {
        ctx.res.writeHead(302, { location: '/hop/1' });
        ctx.res.end();
        return;
      }
      const raw = String(ctx.req.url ?? '');
      const tail = raw.startsWith('/hop/') ? Number.parseInt(raw.slice(5), 10) : Number.NaN;
      if (!Number.isFinite(tail)) {
        respondRaw(ctx.res, 500, Buffer.from('mock hop inconnu'), {});
        return;
      }
      ctx.res.writeHead(302, { location: `/hop/${tail + 1}` });
      ctx.res.end();
    });
    try {
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/start`, { dnsResolverForTests: spy.resolver })
      );
      await assert.rejects(
        client.initialize(),
        (error: unknown) => {
          const clientError = asClientError(error);
          assert.equal(clientError.code, 'REDIRECT_LIMIT');
          assert.ok(clientError.message.includes('limite'));
          return true;
        }
      );
      const visitedPaths = handle.requests.map(record => record.path);
      assert.deepEqual(visitedPaths, ['/start', '/hop/1', '/hop/2', '/hop/3']);
      assert.equal(handle.getTlsHandshakeCount(), 4); // une socket neuve par saut
      assert.ok(!visitedPaths.includes('/hop/4'));
    } finally {
      await handle.close();
    }
  });

  it('redirection cross-origin : destination revalidée (DNS + SNI propres) et credentials abandonnés', async () => {
    let serverBPort = 0;
    const spy = spyResolver({ [TEST_HOSTNAME]: ['127.0.0.1'], [HOST_B]: ['127.0.0.1'] });
    const serverA = await startMockServer(LEAF_MAIN, ctx => {
      const body = parseRpcBody(ctx.bodyText);
      if (body.method === 'initialize') {
        standardMcpHandler(ctx);
        return;
      }
      if (body.method === 'notifications/initialized') {
        ctx.res.writeHead(202);
        ctx.res.end();
        return;
      }
      if (body.method === 'tools/list') {
        ctx.res.writeHead(307, { location: `https://${HOST_B}:${String(serverBPort)}/mcp` });
        ctx.res.end();
        return;
      }
      respondJsonRpcError(ctx.res, body.id ?? 0, -32601, 'mock A');
    });
    const serverB = await startMockServer(LEAF_B, ctx => {
      const body = parseRpcBody(ctx.bodyText);
      if (body.method === 'tools/list') {
        respondJsonRpcResult(ctx.res, body.id ?? 0, { tools: [HAPPY_TOOLS[0]] });
        return;
      }
      respondJsonRpcError(ctx.res, body.id ?? 0, -32601, 'mock B');
    });
    serverBPort = serverB.port;
    try {
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${serverA.port}/mcp`, { dnsResolverForTests: spy.resolver })
      );
      const tools = await client.listTools();
      assert.equal(tools.tools[0]?.name, 'echo');
      // 4 requêtes → 4 résolutions : A ×3 (initialize + notification +
      // tools/list), B ×1 (l infusion 307 suivie). Chaque saut revalide
      // indépendamment hostname + DNS + TLS.
      assert.deepEqual(spy.hostsSeen, [TEST_HOSTNAME, TEST_HOSTNAME, TEST_HOSTNAME, HOST_B]);
      assert.deepEqual(serverB.sniNames, [HOST_B]);
      const forwarded = serverB.requests[0];
      assert.ok(forwarded);
      assert.equal(forwarded.method, 'POST'); // 307 : corps préservé
      assert.equal(forwarded.headers['authorization'], undefined);
      assert.equal(forwarded.headers['mcp-session-id'], undefined);
    } finally {
      await serverA.close();
      await serverB.close();
    }
  });

  it('redirection 302 : la requête se poursuit en GET, POST non repété, bearer conservé intra-origin', async () => {
    const spy = spyResolver({ [TEST_HOSTNAME]: ['127.0.0.1'] });
    const handle = await startMockServer(LEAF_MAIN, ctx => {
      // GET de suivi : corps vide — trier sur l URL AVANT tout parseRpcBody
      // (sinon JSON.parse('') lancerait et le mock répondeur 500 par repli).
      if (ctx.req.method === 'GET' && ctx.req.url === '/mcp-final') {
        respondJsonRpcResult(
          ctx.res,
          1,
          {
            protocolVersion: REMOTE_MCP_HTTP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-redirect', version: '0.2' }
          },
          { 'mcp-session-id': 'sess-redirect-9' }
        );
        return;
      }
      const body = parseRpcBody(ctx.bodyText);
      if (ctx.req.url === '/mcp' && body.method === 'initialize' && body.id === 1) {
        ctx.res.writeHead(302, { location: '/mcp-final' });
        ctx.res.end();
        return;
      }
      if (ctx.req.url === '/mcp' && body.method === 'notifications/initialized') {
        ctx.res.writeHead(202);
        ctx.res.end();
        return;
      }
      respondJsonRpcError(ctx.res, body.id ?? 0, -32601, 'mock redirect');
    });
    try {
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`, { dnsResolverForTests: spy.resolver })
      );
      const init = await client.initialize();
      assert.equal(init.serverName, 'mock-redirect');
      assert.equal(handle.requests[0]?.method, 'POST');
      assert.equal(handle.requests[0]?.path, '/mcp');
      assert.equal(handle.requests[1]?.method, 'GET');
      assert.equal(handle.requests[1]?.bodyText, '');
      assert.equal(handle.requests[1]?.headers['authorization'], `Bearer ${BEARER_TOKEN_VALUE}`);
      // Le POST initial n a pas été repété sur /mcp-final (pas de 2e POST).
      assert.equal(handle.requests[1]?.headers['content-length'], undefined);
      // Notification depuis l URL origine.
      assert.equal(handle.requests[2]?.method, 'POST');
      assert.equal(handle.requests[2]?.path, '/mcp');
      const notifBody = parseRpcBody(handle.requests[2]?.bodyText ?? '');
      assert.equal(notifBody.method, 'notifications/initialized');
      assert.equal(notifBody.id, undefined);
    } finally {
      await handle.close();
    }
  });

  it('HTTP 500 : code HTTP_STATUS, corps jamais reflété', async () => {
    const handle = await startMockServer(LEAF_MAIN, ctx => {
      const body = parseRpcBody(ctx.bodyText);
      if (body.method === 'initialize') {
        standardMcpHandler(ctx);
        return;
      }
      if (body.method === 'notifications/initialized') {
        ctx.res.writeHead(202);
        ctx.res.end();
        return;
      }
      respondRaw(ctx.res, 500, Buffer.from('preuve-corps-secret-500-mock'), { 'content-type': 'application/json' });
    });
    try {
      const client = new RemoteMcpHttpClient(testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`));
      await client.initialize();
      await assert.rejects(
        client.listTools(),
        (error: unknown) => {
          const clientError = asClientError(error);
          assert.equal(clientError.code, 'HTTP_STATUS');
          assert.ok(clientError.message.includes('500'));
          assert.ok(!clientError.message.includes('preuve-corps-secret-500-mock'));
          return true;
        }
      );
    } finally {
      await handle.close();
    }
  });

  it('JSON-RPC malformés (non-JSON, mauvaise version, id non apparié) : JSONRPC_INVALID ou équivalent strict', async () => {
    const responses: Array<(ctx: { res: ServerResponse; id: number }) => void> = [
      ctx => respondRaw(ctx.res, 200, Buffer.from('ceci-n-est-pas-du-json'), { 'content-type': 'application/json' }),
      ctx => respondRaw(ctx.res, 200, Buffer.from(JSON.stringify({ jsonrpc: '1.0', id: ctx.id, result: {} })), { 'content-type': 'application/json' }),
      ctx => respondJsonRpcResult(ctx.res, ctx.id + 1000, { tools: [] })
    ];
    for (const makeResponse of responses) {
      const handle = await startMockServer(LEAF_MAIN, ctx => {
        const body = parseRpcBody(ctx.bodyText);
        if (body.method === 'initialize') {
          standardMcpHandler(ctx);
          return;
        }
        if (body.method === 'notifications/initialized') {
          ctx.res.writeHead(202);
          ctx.res.end();
          return;
        }
        makeResponse({ res: ctx.res, id: body.id ?? 2 });
      });
      try {
        const client = new RemoteMcpHttpClient(testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`));
        await client.initialize();
        await assert.rejects(
          client.listTools(),
          (error: unknown) => {
            const clientError = asClientError(error);
            assert.ok(
              ['JSONRPC_INVALID', 'ENCODING_INVALID'].includes(clientError.code),
              jsonprcCodeUnexpected(clientError.code)
            );
            return true;
          }
        );
      } finally {
        await handle.close();
      }
    }
  });

  it('erreur JSON-RPC distante : code numérique conservé, message assaini, tronqué, sans secret', async () => {
    const handle = await startMockServer(LEAF_MAIN, ctx => {
      const body = parseRpcBody(ctx.bodyText);
      if (body.method === 'initialize') {
        standardMcpHandler(ctx);
        return;
      }
      if (body.method === 'notifications/initialized') {
        ctx.res.writeHead(202);
        ctx.res.end();
        return;
      }
      const longMessage = `trace ${BEARER_TOKEN_VALUE} des paramètres de l appel, ` + 'x'.repeat(600);
      respondJsonRpcError(ctx.res, body.id ?? 0, -32602, longMessage);
    });
    try {
      const client = new RemoteMcpHttpClient(testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`));
      await client.initialize();
      await assert.rejects(
        client.callTool('echo', { question: 'purge' }),
        (error: unknown) => {
          const clientError = asClientError(error);
          assert.equal(clientError.code, 'JSONRPC_REMOTE_ERROR');
          assert.equal(clientError.remoteRpcCode, -32602);
          assert.ok(clientError.message.startsWith('MCP distant refuse la requête'));
          assert.ok(!clientError.message.includes(BEARER_TOKEN_VALUE));
          assert.ok(clientError.message.includes('[redacted]'));
          assert.ok(clientError.message.length < 400);
          return true;
        }
      );
    } finally {
      await handle.close();
    }
  });

  it('HTTP 401 avec secret écho dans le corps : secret jamais reflété', async () => {
    const handle = await startMockServer(LEAF_MAIN, ctx => {
      const body = parseRpcBody(ctx.bodyText);
      if (body.method === 'initialize') {
        standardMcpHandler(ctx);
        return;
      }
      if (body.method === 'notifications/initialized') {
        ctx.res.writeHead(202);
        ctx.res.end();
        return;
      }
      respondRaw(
        ctx.res,
        401,
        Buffer.from(`{"erreur":"jeton invalide ${BEARER_TOKEN_VALUE}"}`),
        { 'content-type': 'application/json' }
      );
    });
    try {
      const client = new RemoteMcpHttpClient(testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`));
      await client.initialize();
      await assert.rejects(
        client.listTools(),
        (error: unknown) => {
          const clientError = asClientError(error);
          assert.equal(clientError.code, 'HTTP_STATUS');
          assert.ok(!clientError.message.includes(BEARER_TOKEN_VALUE));
          assert.ok(clientError.message.includes('401'));
          return true;
        }
      );
      // Le secret a bien été émis (donc l absence de reflet est significative).
      assert.equal(handle.requests[2]?.headers['authorization'], `Bearer ${BEARER_TOKEN_VALUE}`);
    } finally {
      await handle.close();
    }
  });

  it('plafond de taille de réponse : RESPONSE_TOO_LARGE, annulation avant lecture intégrale', async () => {
    const handle = await startMockServer(LEAF_MAIN, ctx => {
      const big = Buffer.alloc(2 * 1024 * 1024, 0x41);
      ctx.res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(big.length) });
      ctx.res.end(big);
    });
    try {
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`, { maxResponseBytes: 65536 })
      );
      const startedAt = Date.now();
      await assert.rejects(
        client.initialize(),
        (error: unknown) => {
          const clientError = asClientError(error);
          assert.equal(clientError.code, 'RESPONSE_TOO_LARGE');
          assert.ok(clientError.message.includes('65536'));
          return true;
        }
      );
      assert.ok(Date.now() - startedAt < 4000);
      assert.equal(handle.getTlsHandshakeCount(), 1);
    } finally {
      await handle.close();
    }
  });

  it('timeout borné : annulation réelle avant la réponse attendue du serveur', async () => {
    const handle = await startMockServer(LEAF_MAIN, ctx => {
      let body: MockBody;
      try {
        body = parseRpcBody(ctx.bodyText);
      } catch {
        respondRaw(ctx.res, 400, Buffer.from('mock'), {});
        return;
      }
      setTimeout(() => {
        try {
          respondJsonRpcResult(ctx.res, body.id ?? 0, {
            protocolVersion: REMOTE_MCP_HTTP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-slow', version: '0' }
          });
        } catch {
          // socket déjà détruite côté client : indifférent pour ce test.
        }
      }, 1500);
    });
    try {
      const client = new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`, { timeoutMs: 1000 })
      );
      const startedAt = Date.now();
      await assert.rejects(
        client.initialize(),
        (error: unknown) => {
          const clientError = asClientError(error);
          assert.equal(clientError.code, 'TIMEOUT');
          return true;
        }
      );
      const elapsed = Date.now() - startedAt;
      // Rejet dans la fenètre du deadline : ni anticipé, ni au-delà du délai
      // serveur (1500 ms) — l opération n attend PAS la réponse tardive.
      assert.ok(elapsed < 1490, `annulation trop tardive : ${elapsed} ms`);
      assert.ok(elapsed >= 940, `annulation suspecte précoce : ${elapsed} ms`);
      // Une seule tentative : le client ne reémet pas après le dépassement
      // (initialize non réessayable → 1 requête exactement malgré le timer).
      assert.equal(handle.requests.length, 1);
      // La preuve d arrêt de socket est dépendante de la pile (visibilité du
      // RST côté serveur sur loopback Windows) : la preuve d annulation réelle
      // est le REJET à ~1000 ms alors que la réponse n arrive qu à 1500 ms.
    } finally {
      await handle.close();
    }
  });

  it('aucune réutilisation de connexion : 4 requêtes = 4 handshakes distincts', async () => {
    const handle = await startMockServer(LEAF_MAIN, ctx => standardMcpHandler(ctx));
    try {
      const client = new RemoteMcpHttpClient(testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`));
      await client.initialize();
      await client.listTools();
      await client.callTool('echo', {});
      assert.equal(handle.requests.length, 4);
      assert.equal(handle.getTlsHandshakeCount(), handle.requests.length);
      const connectionHeaders = handle.requests.map(record => record.headers['connection']);
      assert.deepEqual(connectionHeaders, ['close', 'close', 'close', 'close']);
    } finally {
      await handle.close();
    }
  });

  it('configuration invalide : rejet fail-closed du client', () => {
    const badConfigs: Array<[Partial<RemoteMcpClientOptions>, RemoteMcpClientError['code']]> = [
      [{ timeoutMs: 0 }, 'CONFIG_INVALID'],
      [{ timeoutMs: 4 }, 'CONFIG_INVALID'],
      [{ timeoutMs: 999 }, 'CONFIG_INVALID'],
      [{ timeoutMs: 121_000 }, 'CONFIG_INVALID'],
      [{ maxResponseBytes: 512 }, 'CONFIG_INVALID'],
      [{ maxResponseBytes: 11_000_000 }, 'CONFIG_INVALID'],
      [{ maxRequestBytes: 16 }, 'CONFIG_INVALID'],
      [{ maxRequestBytes: 5_000_000 }, 'CONFIG_INVALID'],
      [{ maxRedirects: 4 }, 'CONFIG_INVALID'],
      [{ maxRedirects: -1 }, 'CONFIG_INVALID'],
      [{ caPem: 'pas-un-pem' }, 'CONFIG_INVALID']
    ];
    for (const [overrides, expectedCode] of badConfigs) {
      assert.throws(
        () => new RemoteMcpHttpClient(testClientOptions(`https://${TEST_HOSTNAME}:9000/mcp`, overrides)),
        (error: unknown) => asClientError(error).code === expectedCode,
        `overrides ${JSON.stringify(overrides)} devait être refusé (${expectedCode})`
      );
    }
    // connectorId hors motif du store :
    assert.throws(
      () => new RemoteMcpHttpClient(testClientOptions(`https://${TEST_HOSTNAME}:9000/mcp`, { connectorId: '~~' })),
      (error: unknown) => asClientError(error).code === 'CONFIG_INVALID'
    );
    // bearerToken non textuel :
    assert.throws(
      () => new RemoteMcpHttpClient(
        testClientOptions(`https://${TEST_HOSTNAME}:9000/mcp`, { bearerToken: 42 as unknown as string })
      ),
      (error: unknown) => asClientError(error).code === 'CONFIG_INVALID'
    );
    // URL non https → politique SSRF réelle :
    assert.throws(
      () => new RemoteMcpHttpClient(testClientOptions('http://exemple-fictif.invalid/mcp')),
      (error: unknown) => asClientError(error).code === 'URL_POLICY'
    );
    // URL avec credentials → politique SSRF réelle :
    assert.throws(
      () => new RemoteMcpHttpClient(testClientOptions('https://utilisateur:motdepasse@exemple-fictif.invalid/')),
      (error: unknown) => asClientError(error).code === 'URL_POLICY'
    );
  });

  it('écho de version 2024-11-05 (constante du projet stdio) accepté puis propagé', async () => {
    const handle = await startMockServer(LEAF_MAIN, ctx => {
      let body: MockBody;
      try {
        body = parseRpcBody(ctx.bodyText);
      } catch {
        respondRaw(ctx.res, 400, Buffer.from('mock'), {});
        return;
      }
      if (body.method === 'initialize') {
        respondJsonRpcResult(
          ctx.res,
          body.id ?? 0,
          {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-legacy', version: '0' }
          },
          { 'mcp-session-id': 'sess-legacy-1' }
        );
        return;
      }
      if (body.method === 'notifications/initialized') {
        ctx.res.writeHead(202);
        ctx.res.end();
        return;
      }
      if (body.method === 'tools/list') {
        respondJsonRpcResult(ctx.res, body.id ?? 0, { tools: HAPPY_TOOLS });
        return;
      }
      respondJsonRpcError(ctx.res, body.id ?? 0, -32601, 'mock legacy');
    });
    try {
      const client = new RemoteMcpHttpClient(testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`));
      const init = await client.initialize();
      assert.equal(init.protocolVersion, '2024-11-05');
      assert.equal(client.session.protocolVersion, '2024-11-05');
      assert.equal(init.sessionId, 'sess-legacy-1');
      await client.listTools();
      assert.equal(handle.requests[2]?.headers['mcp-protocol-version'], '2024-11-05');
    } finally {
      await handle.close();
    }
  });

  it('écho de version inconnue : PROTOCOL_UNSUPPORTED (fail-closed)', async () => {
    const handle = await startMockServer(LEAF_MAIN, ctx => {
      const body = parseRpcBody(ctx.bodyText);
      if (body.method === 'initialize') {
        respondJsonRpcResult(ctx.res, body.id ?? 0, {
          protocolVersion: '2023-06-01',
          capabilities: {},
          serverInfo: { name: 'mock-trop-vieux', version: '0' }
        });
        return;
      }
      ctx.res.writeHead(202);
      ctx.res.end();
    });
    try {
      const client = new RemoteMcpHttpClient(testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`));
      await assert.rejects(
        client.initialize(),
        (error: unknown) => {
          const clientError = asClientError(error);
          assert.equal(clientError.code, 'PROTOCOL_UNSUPPORTED');
          assert.ok(clientError.message.includes('2023-06-01'));
          assert.ok(clientError.message.includes('2024-11-05'));
          assert.ok(clientError.message.includes('2025-03-26'));
          return true;
        }
      );
    } finally {
      await handle.close();
    }
  });

  it('réponse SSE : premier évènement data: portant le JSON-RPC attendu', async () => {
    const handle = await startMockServer(LEAF_MAIN, ctx => {
      let body: MockBody;
      try {
        body = parseRpcBody(ctx.bodyText);
      } catch {
        respondRaw(ctx.res, 400, Buffer.from('mock'), {});
        return;
      }
      if (body.method === 'initialize') {
        standardMcpHandler(ctx);
        return;
      }
      if (body.method === 'notifications/initialized') {
        ctx.res.writeHead(202);
        ctx.res.end();
        return;
      }
      if (body.method === 'tools/list') {
        const payload = JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 0, result: { tools: HAPPY_TOOLS } });
        const stream = `event: message\r\ndata: ${payload}\r\n\r\n`;
        respondRaw(ctx.res, 200, Buffer.from(stream, 'utf8'), { 'content-type': 'text/event-stream' });
        return;
      }
      respondJsonRpcError(ctx.res, body.id ?? 0, -32601, 'mock sse');
    });
    try {
      const client = new RemoteMcpHttpClient(testClientOptions(`https://${TEST_HOSTNAME}:${handle.port}/mcp`));
      await client.initialize();
      const tools = await client.listTools();
      assert.equal(tools.tools[0]?.name, 'echo');
    } finally {
      await handle.close();
    }
  });
});

describe('C3.2-A : extractSseMessageForId (unitaire)', () => {
  it('extrait le premier évènement portant l id attendu, CRLF et LF tolérés', () => {
    const stream =
      'event: unrelated\r\n' +
      'data: {"jsonrpc":"2.0","id":4,"result":{"r":"premier"}}\r\n' +
      '\r\n' +
      'data: {"jsonrpc":"2.0","id":5,"result":{"r":"second"}}\r\n' +
      '\r\n';
    const first = extractSseMessageForId(stream, 4);
    assert.deepEqual(first?.result, { r: 'premier' });
    const second = extractSseMessageForId(stream, 5);
    assert.deepEqual(second?.result, { r: 'second' });
    assert.equal(extractSseMessageForId(stream, 6), null);
    assert.equal(extractSseMessageForId('data: []\r\n\r\n', 1), null);
    assert.equal(extractSseMessageForId('', 1), null);
  });
});

function jsonprcCodeUnexpected(code: string): string {
  return `code inattendu : ${code} (JSONRPC_INVALID ou ENCODING_INVALID attendus, cas de forme malformée)`;
}
