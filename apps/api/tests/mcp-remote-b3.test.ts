/**
 * C3.2-B3 — Tests d'intégration PRÉPARATION / CONFIRMATION / EXÉCUTION :
 *   POST /api/v1/mcp-remote/connectors/:id/tools/:t/prepare  (aucun tools/call)
 *   POST /api/v1/mcp-remote/connectors/:id/tools/:t/call     (exécution unique)
 *
 * MATRICE OBLIGATOIRE (GO §5) couverte :
 *   B3-1  préparation nominale SANS exécution (TTL serveur fixe, plumb bearer)
 *   B3-2  exécution nominale unique + REJEU refusé (0 callTool au rejeu)
 *   B3-3  identité : sans userId (repli dev) → 403 ; JWT falsifié → 403 ;
 *         autre utilisateur → 409 binding indiscernable (0 callTool)
 *   B3-4  connecteur DÉSACTIVÉ → 409, zéro réseau (prepare ET call)
 *   B3-5  outil non approuvé / révoqué → 403, 0 callTool
 *   B3-6  outil inconnu/disparu → 404 (prepare ET call)
 *   B3-7  DÉRIVE du schéma → 409 ; ré-approbation du nouveau hash → e2e OK
 *   B3-8  arguments hors bornes (non-objet / volume / profondeur) +
 *         confirmationId absent/invalide → 400, zéro réseau
 *   B3-9  arguments MODIFIÉS après préparation → 409 binding (pas consommé) ;
 *         les args EXACTS préparés restent exécutables
 *   B3-10 confirmation EXPIRÉE → 409 ; ligne non consommée (consume → EXPIRED)
 *   B3-11 isolation inter-tenant → 404 indiscernable, zéro réseau
 *   B3-12 révocation ENTRE prepare et call → 403, 0 callTool
 *   B3-13 changement d'URL ENTRE prepare et call (MANDATÉ GO §3) : PATCH →
 *         invalidatedConfirmations, refus 403 (politiques révoquées), 0
 *         callTool, et consume direct → REPLAY (invalidation D3 prouvée)
 *   B3-14 désactivation ENTRE les deux → 409, zéro réseau
 *   B3-15 CONCURRENCE : deux exécutions de la même confirmation → 1×200 +
 *         1×409, callTool total exactement 1
 *   B3-16 erreurs distantes : CONNECT_ERROR → 502, TIMEOUT → 504 ; la
 *         confirmation est BRÛLÉE par l'échec (rejeu refusé) ; audit FAILED
 *   B3-17 RBAC : ENGINEER/VIEWER → 403 zéro réseau ; ADMIN (MCP_REMOTE_INVOKE)
 *         → prépare ET exécute avec SA confirmation
 *   B3-18 réponse distante non conforme (tools non tableau) → 502 fail-closed
 *   B3-19 journal : NI secret, NI canari d'arguments, NI schéma, NI résultat ;
 *         whitelists EXACTES des métadonnées PREPARED/CALLED/CALL_FAILED
 *
 * Harnais identique à B1/B2 : serveur HTTP réel (port 0), client MCP STUB
 * injecté (aucun réseau réel), VOLACO_DATA_DIR temporaire fixé AVANT l'import
 * dynamique de server.js ; identity fiable = JWT signé (AUTH_SECRET de test,
 * D7). Horloge du store de confirmations injectée (expiration pilotable).
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
import { RemoteMcpConnectorStore } from '../../../packages/core/src/mcp/remote/store.js';
import { RemoteMcpClientError } from '../../../packages/core/src/mcp/remote/client.js';
import type { RemoteMcpClientOptions, RemoteMcpHttpClient } from '../../../packages/core/src/mcp/remote/client.js';
import {
  RemoteMcpSecretCipher,
  createRemoteMcpKeyRing
} from '../../../packages/core/src/mcp/remote/crypto.js';
import { remoteMcpCanonicalSha256 } from '../../../packages/core/src/mcp/remote/canonical-json.js';
import {
  RemoteMcpConfirmationStore,
  REMOTE_MCP_CONFIRMATION_MAX_TTL_MS
} from '../../../packages/core/src/mcp/remote/confirmation.js';
import type { Role } from '../../../packages/core/src/identity/permissions.js';
import { signToken } from '../../../packages/core/src/identity/user-store.js';

/** Clé HMAC JWT : fixée AVANT l'import du serveur (vérification côté serveur = même secret). */
process.env.AUTH_SECRET = 'volaco-test-b3-' + 'jwt-secret-'.repeat(4);

/** MCP-TEST-ISOLATION-001 : DATA_DIR = répertoire mkdtemp neuf fourni par le
 * module d'isolement (importé en premier) — VOLACO_DATA_DIR y est déjà fixé à
 * ce stade. Le rmSync final (after) reste inchangé. */
const DATA_DIR = isolatedVolacoDataDir;

const T_MAIN = 'studio-b3-main';
const T_FOREIGN = 'tenant-b3-etranger';

const USR_OWNER = 'usr_owner_b3x';
const USR_ADMIN = 'usr_admin_b3x';
const USR_ENGINEER = 'usr_eng_b3x';
const USR_VIEWER = 'usr_view_b3x';
const USR_FOREIGN = 'usr_autre_b3x';

function authHeaders(userId: string, tenantId: string, role: Role): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    authorization: `Bearer ${signToken({ id: userId, tenantId, role, email: `${userId}@b3.test` }, 3600)}`
  };
}

const H_OWNER = authHeaders(USR_OWNER, T_MAIN, 'OWNER');
const H_ADMIN = authHeaders(USR_ADMIN, T_MAIN, 'ADMIN');
const H_ENGINEER = authHeaders(USR_ENGINEER, T_MAIN, 'ENGINEER');
const H_VIEWER = authHeaders(USR_VIEWER, T_MAIN, 'VIEWER');
const H_FOREIGN = authHeaders(USR_FOREIGN, T_FOREIGN, 'OWNER');
/** Repli dev (en-têtes) : contexte AUTHENTIFIÉ pour les permissions, mais AUCUN userId fiable (D7). */
const H_DEV = { 'Content-Type': 'application/json', 'x-tenant-id': T_MAIN, 'x-user-role': 'OWNER' };

const URL_MAIN = 'https://api-b3.example.org/mcp';
const URL_ALT = 'https://api-b3-alt.example.org/mcp';

const CANARY_DESC = 'CANARY-B3-journal-DEFENDU';
const SCHEMA_MARKER = 'MARKER_SCHEMA_B3-' + randomBytes(4).toString('hex');
const ARG_CANARY = 'CANARY-ARGS-B3-' + randomBytes(6).toString('hex');
const SECRET_PLAINTEXT = 'tok_' + randomBytes(16).toString('hex') + '_b3secret';
const STUB_RESULT_OK = 'stub-b3-result-OK';

const S1: Record<string, unknown> = {
  type: 'object',
  properties: { q: { type: 'string', description: SCHEMA_MARKER } },
  required: ['q']
};
const S2: Record<string, unknown> = {
  type: 'object',
  properties: { q: { type: 'string', description: SCHEMA_MARKER }, flag: { type: 'boolean' } },
  required: ['q', 'flag']
};
const HASH_S1 = remoteMcpCanonicalSha256(S1);
const HASH_S2 = remoteMcpCanonicalSha256(S2);

const ARGS_A: Record<string, unknown> = { q: ARG_CANARY, limit: 3 };
const TAMPER_MARK = ARG_CANARY + '-MODIFIE';
const ARGS_A_TAMPER: Record<string, unknown> = { q: TAMPER_MARK, limit: 3 };
const HASH_ARGS_A = remoteMcpCanonicalSha256(ARGS_A);

interface PreparedConfirmation {
  confirmationId: string;
  toolName: string;
  schemaSha256: string;
  argsSha256: string;
  expiresAt: number;
}

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

function preparedBody(out: JsonOut): PreparedConfirmation {
  assert.equal(out.status, 201, `préparation attendue 201 — reçu ${out.status} : ${out.text}`);
  const body = out.body as { confirmation?: PreparedConfirmation } | null;
  assert.ok(body && body.confirmation && typeof body.confirmation === 'object');
  const conf = body.confirmation;
  assert.equal(typeof conf.confirmationId, 'string');
  assert.ok(conf.confirmationId.length > 0 && conf.confirmationId.length <= 64);
  return conf;
}

interface StubToolDef {
  name: string;
  title: string | null;
  description: string | null;
  inputSchema: unknown;
}

interface StubPage { tools: unknown; nextCursor: string | null }

type CallToolBehavior = 'ok' | { readonly throw: RemoteMcpClientError } | { readonly result: unknown };

interface CallStub {
  calls: string[];
  client: RemoteMcpHttpClient;
  setPages(pages: StubPage[]): void;
  setCallToolBehavior(behavior: CallToolBehavior): void;
}

/**
 * Stub client C3.2-A : enregistre TOUTES les méthodes invoquées (initialize /
 * listTools / callTool) et les arguments transmis à callTool — la matrice du
 * GO exige de COMPTER les appels réseau et les invocations d'outil.
 */
function makeCallStub(): CallStub {
  const calls: string[] = [];
  let pages: StubPage[] = [];
  let index = 0;
  let behavior: CallToolBehavior = 'ok';
  const client = {
    initialize: async () => {
      calls.push('initialize');
      return {
        protocolVersion: '2025-03-26',
        serverName: 'stub-b3',
        serverVersion: '1.0.0',
        capabilities: {},
        sessionId: 'sess-b3-stub'
      };
    },
    listTools: async (cursor?: string) => {
      calls.push(cursor === undefined ? 'listTools' : 'listTools(cursor)');
      const page = pages[Math.min(index, Math.max(pages.length - 1, 0))] ?? { tools: [], nextCursor: null };
      index += 1;
      return page;
    },
    callTool: async () => {
      calls.push('callTool');
      if (behavior === 'ok') {
        return { content: [{ type: 'text', text: STUB_RESULT_OK }], isError: false, structuredContent: null };
      }
      if ('throw' in behavior) throw behavior.throw;
      return behavior.result;
    }
  } as unknown as RemoteMcpHttpClient;
  return {
    calls,
    client,
    setPages: (next) => { pages = next; index = 0; },
    setCallToolBehavior: (next) => { behavior = next; }
  };
}

let baseUrl = '';
let server: Server | undefined;
let b3Store: RemoteMcpConnectorStore;
let cMain = '';
/** Horloge injectable : décaler `clockMs` pour simuler l'expiration. */
let clockMs = Date.now();
const confirmationStore = new RemoteMcpConfirmationStore(() => clockMs);
const capturedOptions: RemoteMcpClientOptions[] = [];

function stubTool(name: string, inputSchema: unknown, description: string | null = null): StubToolDef {
  return { name, title: null, description, inputSchema };
}

function setRuntimeForStub(stub: CallStub): void {
  setMcpRemoteRuntimeForTests({
    connectorStore: () => b3Store,
    confirmationStore: () => confirmationStore,
    clientFactory: (options) => {
      capturedOptions.push(options);
      return stub.client;
    }
  });
}

function ensureAlphaApproved(schemaSha256: string = HASH_S1): void {
  b3Store.approveTool({
    tenantId: T_MAIN,
    connectorId: cMain,
    toolName: 'outil_alpha',
    schemaSha256,
    approvedBy: USR_OWNER
  });
}

const PREPARE_PATH = (connectorId: string, tool = 'outil_alpha') =>
  `/api/v1/mcp-remote/connectors/${connectorId}/tools/${tool}/prepare`;
const CALL_PATH = (connectorId: string, tool = 'outil_alpha') =>
  `/api/v1/mcp-remote/connectors/${connectorId}/tools/${tool}/call`;
const MAIN_PAGE_S1: StubPage = { tools: [stubTool('outil_alpha', S1, `Alpha ${CANARY_DESC}`)], nextCursor: null };
const MAIN_PAGE_BOTH: StubPage = {
  tools: [stubTool('outil_alpha', S1, `Alpha ${CANARY_DESC}`), stubTool('outil_beta', {})],
  nextCursor: null
};

/** Prépare 'outil_alpha' via les routes (stub fraîchement injecté) et retourne le stub + la confirmation. */
async function prepareAlpha(
  args: Record<string, unknown>,
  page: StubPage = MAIN_PAGE_S1,
  headers: Record<string, string> = H_OWNER
): Promise<{ stub: CallStub; conf: PreparedConfirmation }> {
  const stub = makeCallStub();
  stub.setPages([page]);
  setRuntimeForStub(stub);
  const out = await call(PREPARE_PATH(cMain), 'POST', headers, { arguments: args });
  return { stub, conf: preparedBody(out) };
}

async function executeAlpha(
  stub: CallStub,
  conf: PreparedConfirmation,
  args: Record<string, unknown>,
  headers: Record<string, string> = H_OWNER
): Promise<JsonOut> {
  return call(CALL_PATH(cMain), 'POST', headers, { confirmationId: conf.confirmationId, arguments: args });
}

function consumeDirect(conf: PreparedConfirmation, userId: string, argsSha256: string) {
  return confirmationStore.consume({
    tenantId: T_MAIN,
    userId,
    confirmationId: conf.confirmationId,
    connectorId: cMain,
    toolName: conf.toolName,
    schemaSha256: conf.schemaSha256,
    argsSha256
  });
}

describe('C3.2-B3 : préparation / confirmation / exécution /api/v1/mcp-remote', () => {
  before(async () => {
    b3Store = new RemoteMcpConnectorStore(
      new RemoteMcpSecretCipher(createRemoteMcpKeyRing({ active: { keyId: 'b3', key: randomBytes(32) } }))
    );
    setMcpRemoteRuntimeForTests({
      connectorStore: () => b3Store,
      confirmationStore: () => confirmationStore
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
    // Connecteur principal : création fail-closed (disabled), activation
    // explicite (OWNER JWT = TENANT_MANAGE + D5), approbation via store (B2
    // couvre déjà les routes d'approbation ; le focus B3 est prepare/call).
    const created = await call('/api/v1/mcp-remote/connectors', 'POST', H_OWNER, {
      name: 'b3 principal',
      url: URL_MAIN,
      secret: SECRET_PLAINTEXT
    });
    assert.equal(created.status, 201, created.text);
    cMain = String((created.body as { connector: { connectorId: string } }).connector.connectorId);
    const activated = await call(`/api/v1/mcp-remote/connectors/${cMain}`, 'PATCH', H_OWNER, { enabled: true });
    assert.equal(activated.status, 200);
    ensureAlphaApproved();
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
      // Windows : SQLite encore ouvert — répertoire temporaire OS.
    }
  });

  /* ---- B3-1 : préparation nominale, SANS aucune exécution ---- */

  it('B3-1 préparation nominale : confirmation bornée par le TTL serveur, plumb bearer, AUCUN tools/call', async () => {
    ensureAlphaApproved();
    const { stub, conf } = await prepareAlpha(ARGS_A);
    assert.equal(conf.toolName, 'outil_alpha');
    assert.equal(conf.schemaSha256, HASH_S1, 'hash canonique recalculé SERVEUR sur le schéma du distant');
    assert.equal(conf.argsSha256, HASH_ARGS_A, 'hash des arguments soumis, canonique serveur');
    assert.equal(conf.expiresAt, clockMs + REMOTE_MCP_CONFIRMATION_MAX_TTL_MS,
      'TTL FIXE serveur (cap C3.1) : aucune négociation client, échéance epoch ms');
    // Réseau : exactement UNE interrogation metadata, AUCUN tools/call (le
    // stub compteur tomberait en défaut si le lot B3 préparait un appel).
    assert.deepEqual(stub.calls.filter((c) => c.startsWith('listTools')), ['listTools']);
    assert.ok(!stub.calls.includes('callTool'), 'AUCUN tools/call pendant la préparation');
    // Plomberie : le client HTTPS reçoit l'URL + bearer DÉCRYPTÉ du store.
    assert.equal(capturedOptions.length, 1);
    const wire = capturedOptions[0];
    assert.ok(wire);
    assert.equal(wire.url, URL_MAIN);
    assert.equal(wire.bearerToken, SECRET_PLAINTEXT);
    capturedOptions.length = 0;
  });

  /* ---- B3-2 : exécution nominale unique + rejeu refusé ---- */

  it('B3-2 exécution nominale : UNIQUE tools/call passthrough, journal whitelisté, rejeu refusé', async () => {
    ensureAlphaApproved();
    const { stub, conf } = await prepareAlpha(ARGS_A);
    stub.setPages([MAIN_PAGE_S1]);
    const exec = await executeAlpha(stub, conf, ARGS_A);
    assert.equal(exec.status, 200, exec.text);
    const payload = exec.body as {
      result: { isError: boolean; content: Array<{ type?: string; text?: string }>; structuredContent: unknown };
      requestId: string;
    };
    assert.equal(payload.result.isError, false);
    const first = payload.result.content[0];
    assert.ok(first);
    assert.equal(first.text, STUB_RESULT_OK, 'résultat distant PASSED THROUGH (borné par le client C3.2-A)');
    // Compte exact : ré-interrogation metadata ×1, tools/call ×1 — LA SEULE
    // invocation d'outil de toute la confirmation.
    assert.equal(stub.calls.filter((c) => c === 'callTool').length, 1);
    assert.equal(stub.calls.filter((c) => c.startsWith('listTools')).length, 2, 'une par phase (prepare + call)');
    // REJEU immédiat : 409, code drift, et TOUJOURS 1 callTool (aucune 2e invocation).
    const replay = await executeAlpha(stub, conf, ARGS_A);
    assert.equal(replay.status, 409);
    assert.equal(errorBody(replay).code, 'MCP_REMOTE_DRIFT');
    assert.equal(stub.calls.filter((c) => c === 'callTool').length, 1, 'rejeu SANS nouvelle invocation');
    // Journal de l'exécution : whiteliste EXACTE (tous les events CALLED).
    const journal = await call('/api/v1/mcp-remote/journal', 'GET', H_OWNER);
    const events = (journal.body as { events: Array<{ action: string; metadata: Record<string, unknown> | null }> }).events;
    const called = events.filter((e) => e.action === 'MCP_REMOTE_TOOL_CALLED');
    assert.ok(called.length >= 1, 'l’exécution nominale est auditée');
    for (const event of called) {
      assert.deepEqual(
        Object.keys(event.metadata ?? {}).sort(),
        ['argsSha256', 'confirmationId', 'isError', 'schemaSha256', 'toolName']
      );
    }
    const meta = called[0]?.metadata as Record<string, unknown> | undefined;
    assert.ok(meta);
    assert.equal(meta.schemaSha256, HASH_S1);
    assert.equal(meta.argsSha256, HASH_ARGS_A);
  });

  /* ---- B3-3 : identité fiable obligatoire ---- */

  it('B3-3 identité : repli dev (sans userId) → 403 sans réseau ; JWT falsifié → 403 ; autre utilisateur → 409 binding', async () => {
    // (a) repli dev OWNER : permission OK, mais userId ABSENT → REFUS.
    let stub = makeCallStub();
    stub.setPages([MAIN_PAGE_S1]);
    setRuntimeForStub(stub);
    const prepDev = await call(PREPARE_PATH(cMain), 'POST', H_DEV, { arguments: ARGS_A });
    assert.equal(prepDev.status, 403);
    assert.equal(errorBody(prepDev).code, 'FORBIDDEN');
    assert.equal(stub.calls.length, 0, 'aucun réseau sans identité fiable');
    const callDev = await call(CALL_PATH(cMain), 'POST', H_DEV, {
      confirmationId: 'c'.repeat(32), arguments: ARGS_A
    });
    assert.equal(callDev.status, 403);
    assert.equal(stub.calls.length, 0);
    // (b) JWT falsifié (signature modifiée) : jamais une identité fabriquée.
    const ownerAuth = H_OWNER.authorization;
    assert.ok(typeof ownerAuth === 'string' && ownerAuth.startsWith('Bearer '));
    const token = ownerAuth.slice('Bearer '.length);
    const forged = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    stub = makeCallStub();
    setRuntimeForStub(stub);
    const forgedOut = await call(PREPARE_PATH(cMain), 'POST', {
      'Content-Type': 'application/json',
      authorization: `Bearer ${forged}`
    }, { arguments: ARGS_A });
    assert.equal(forgedOut.status, 403, 'un JWT falsifié ne doit JAMAIS devenir une identité');
    assert.equal(stub.calls.length, 0);
    // (c) confirmation liée à un AUTRE utilisateur (même tenant, invocateur légal) :
    const prepared = await prepareAlpha(ARGS_A);
    const conf = prepared.conf;
    const otherUser = await executeAlpha(prepared.stub, conf, ARGS_A, H_ADMIN);
    assert.equal(otherUser.status, 409);
    assert.equal(errorBody(otherUser).code, 'MCP_REMOTE_DRIFT', 'BINDING_MISMATCH: consigné comme état divergé');
    assert.ok(!prepared.stub.calls.includes('callTool'), 'aucun tools/call pour une autre identité');
  });

  /* ---- B3-4 : connecteur désactivé ---- */

  it('B3-4 connecteur désactivé : prepare ET call → 409 MCP_REMOTE_DRIFT, zéro réseau', async () => {
    const created = await call('/api/v1/mcp-remote/connectors', 'POST', H_OWNER, {
      name: 'b3 verrouille', url: URL_MAIN, secret: SECRET_PLAINTEXT
    });
    assert.equal(created.status, 201);
    const record = (created.body as { connector: { connectorId: string; enabled: boolean } }).connector;
    assert.equal(record.enabled, false, 'fail-closed : création désactivée ; PAS d activation ici');
    const stub = makeCallStub();
    stub.setPages([MAIN_PAGE_S1]);
    setRuntimeForStub(stub);
    const disabledPrepare = await call(PREPARE_PATH(record.connectorId), 'POST', H_OWNER, { arguments: ARGS_A });
    assert.equal(disabledPrepare.status, 409);
    assert.equal(errorBody(disabledPrepare).code, 'MCP_REMOTE_DRIFT');
    assert.equal(stub.calls.length, 0, 'connecteur désactivé : AUCUNE interrogation réseau (préparation)');
    const disabledCall = await call(CALL_PATH(record.connectorId), 'POST', H_OWNER, {
      confirmationId: 'c'.repeat(32), arguments: ARGS_A
    });
    assert.equal(disabledCall.status, 409);
    assert.equal(errorBody(disabledCall).code, 'MCP_REMOTE_DRIFT');
    assert.equal(stub.calls.length, 0, 'connecteur désactivé : AUCUNE interrogation réseau (exécution)');
  });

  /* ---- B3-5 : outil non approuvé / approbation révoquée ---- */

  it('B3-5 approbations : outil JAMAIS approuvé → 403 ; approbation RÉVOQUÉE → 403 ; 0 callTool partout', async () => {
    // (a) outil_beta existe côté distant mais n’a AUCUNE politique.
    const stub = makeCallStub();
    stub.setPages([MAIN_PAGE_BOTH]);
    setRuntimeForStub(stub);
    const neverApproved = await call(PREPARE_PATH(cMain, 'outil_beta'), 'POST', H_OWNER, { arguments: {} });
    assert.equal(neverApproved.status, 403);
    assert.equal(errorBody(neverApproved).code, 'FORBIDDEN');
    assert.ok(!stub.calls.includes('callTool'));
    // (b) l’outil principal, approuvé→révoqué AVANT la préparation.
    assert.equal(b3Store.revokeTool(T_MAIN, cMain, 'outil_alpha'), true);
    const revokedStub = makeCallStub();
    revokedStub.setPages([MAIN_PAGE_S1]);
    setRuntimeForStub(revokedStub);
    const revokedPrepare = await call(PREPARE_PATH(cMain), 'POST', H_OWNER, { arguments: ARGS_A });
    assert.equal(revokedPrepare.status, 403);
    assert.equal(errorBody(revokedPrepare).code, 'FORBIDDEN');
    assert.ok(!revokedStub.calls.includes('callTool'));
    assert.ok(revokedStub.calls.some((c) => c.startsWith('listTools')),
      'la découverte a eu lieu (ordre GO) — mais AUCUN tools/call');
    ensureAlphaApproved();
  });

  /* ---- B3-6 : outil inconnu / disparu du distant ---- */

  it('B3-6 outil inconnu : prepare → 404, call → 404, 0 callTool', async () => {
    const stub = makeCallStub();
    stub.setPages([MAIN_PAGE_S1]);
    setRuntimeForStub(stub);
    const unknownPrepare = await call(PREPARE_PATH(cMain, 'outil_omega'), 'POST', H_OWNER, { arguments: ARGS_A });
    assert.equal(unknownPrepare.status, 404);
    assert.equal(errorBody(unknownPrepare).code, 'NOT_FOUND');
    assert.ok(!stub.calls.includes('callTool'));
    const unknownCall = await call(CALL_PATH(cMain, 'outil_omega'), 'POST', H_OWNER, {
      confirmationId: 'c'.repeat(32), arguments: ARGS_A
    });
    assert.equal(unknownCall.status, 404);
    assert.ok(!stub.calls.includes('callTool'));
  });

  /* ---- B3-7 : dérive du schéma, puis ré-approbation et e2e sur le NOUVEAU hash ---- */

  it('B3-7 dérive : prepare OK sur S1, exécution refusée sur S2 dérivé (0 callTool), ré-approbation S2 → e2e OK', async () => {
    ensureAlphaApproved(HASH_S1);
    const { stub, conf } = await prepareAlpha(ARGS_A);
    assert.equal(conf.schemaSha256, HASH_S1);
    // Le distant présente DÉSORMAIS S2 (champ obligatoire ajouté) : le couple
    // apprové était S1 → dérive → REFUS AVANT consommation.
    stub.setPages([{ tools: [stubTool('outil_alpha', S2, `Alpha ${CANARY_DESC}`)], nextCursor: null }]);
    const drifted = await executeAlpha(stub, conf, ARGS_A);
    assert.equal(drifted.status, 409);
    assert.equal(errorBody(drifted).code, 'MCP_REMOTE_DRIFT');
    assert.ok(!stub.calls.includes('callTool'), 'dérive : l’outil n’est JAMAIS invoqué');
    // La préparation d’un appel contre le schéma dérivé échoue AUSSI (débit).
    const driftedPrepare = await call(PREPARE_PATH(cMain), 'POST', H_OWNER, { arguments: ARGS_A });
    assert.equal(driftedPrepare.status, 409);
    // Ré-approbation EXPLICITE du nouveau hash (engagement OWNER analogique à
    // B2 ; ici via store — les routes B2 couvrent le flux approve).
    ensureAlphaApproved(HASH_S2);
    const reprepare = await call(PREPARE_PATH(cMain), 'POST', H_OWNER, { arguments: ARGS_A });
    assert.equal(reprepare.status, 201, 'ré-approbation du NOUVEAU schéma → nouvelle confirmation');
    const conf2 = preparedBody(reprepare);
    assert.equal(conf2.schemaSha256, HASH_S2);
    const reworked = await executeAlpha(stub, conf2, ARGS_A);
    assert.equal(reworked.status, 200);
    assert.equal(stub.calls.filter((c) => c === 'callTool').length, 1);
    ensureAlphaApproved(HASH_S1);
  });

  /* ---- B3-8 : arguments hors bornes / confirmationId invalide → 400 + zéro réseau ---- */

  it('B3-8 arguments invalides (non-objet, volume, profondeur) et confirmationId invalide → 400 SANS réseau', async () => {
    ensureAlphaApproved();
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 70; i += 1) deep = { nested: deep };

    const cases: Array<{ label: string; path: string; payload: unknown }> = [
      { label: 'prepare : arguments non-objet', path: PREPARE_PATH(cMain), payload: { arguments: [1, 2, 3] } },
      { label: 'prepare : arguments volumineux (canonique > 16 KiB)', path: PREPARE_PATH(cMain), payload: { arguments: { blob: 'x'.repeat(20_000) } } },
      { label: 'prepare : profondeur > 64', path: PREPARE_PATH(cMain), payload: { arguments: deep } },
      { label: 'call : arguments non-objet', path: CALL_PATH(cMain), payload: { confirmationId: 'c'.repeat(32), arguments: 'hello' } },
      { label: 'call : confirmationId absent', path: CALL_PATH(cMain), payload: { arguments: ARGS_A } },
      { label: 'call : confirmationId caractères refusés', path: CALL_PATH(cMain), payload: { confirmationId: 'bad;chars!', arguments: ARGS_A } },
      { label: 'call : arguments volumineux', path: CALL_PATH(cMain), payload: { confirmationId: 'c'.repeat(32), arguments: { blob: 'y'.repeat(20_000) } } }
    ];
    for (const one of cases) {
      const stub = makeCallStub();
      stub.setPages([MAIN_PAGE_S1]);
      setRuntimeForStub(stub);
      const out = await call(one.path, 'POST', H_OWNER, one.payload);
      assert.equal(out.status, 400, one.label);
      assert.equal(errorBody(out).code, 'VALIDATION_ERROR', one.label);
      assert.equal(stub.calls.length, 0, `${one.label} : AUCUN réseau`);
    }
  });

  /* ---- B3-9 : arguments modifiés après préparation ---- */

  it('B3-9 arguments modifiés → 409 binding, ligne NON brûlée : les args exacts préparés restent exécutables', async () => {
    ensureAlphaApproved();
    const { stub, conf } = await prepareAlpha(ARGS_A);
    const tampered = await executeAlpha(stub, conf, ARGS_A_TAMPER);
    assert.equal(tampered.status, 409);
    assert.equal(errorBody(tampered).code, 'MCP_REMOTE_DRIFT');
    assert.ok(!stub.calls.includes('callTool'), 'args modifiés : JAMAIS invocation');
    // La comparaison-refus laisse la ligne INTACTE : le couple exact préparé
    // reste exécutable une fois (anti-DoS : le fraudeur ne détruit pas sa
    // propre confirmation, et seule la charge exactement préparée passe).
    const honest = await executeAlpha(stub, conf, ARGS_A);
    assert.equal(honest.status, 200);
    assert.equal(stub.calls.filter((c) => c === 'callTool').length, 1);
    const replay = await executeAlpha(stub, conf, ARGS_A);
    assert.equal(replay.status, 409);
    assert.equal(stub.calls.filter((c) => c === 'callTool').length, 1);
  });

  /* ---- B3-10 : confirmation expirée ---- */

  it('B3-10 confirmation EXPIRÉE → 409, 0 callTool, ligne non consommée (consume direct → EXPIRED)', async () => {
    ensureAlphaApproved();
    const { stub, conf } = await prepareAlpha(ARGS_A);
    const saved = clockMs;
    clockMs = saved + REMOTE_MCP_CONFIRMATION_MAX_TTL_MS + 1;
    try {
      const late = await executeAlpha(stub, conf, ARGS_A);
      assert.equal(late.status, 409);
      assert.equal(errorBody(late).code, 'MCP_REMOTE_DRIFT');
      assert.ok(!stub.calls.includes('callTool'), 'expiration : aucune invocation');
      assert.equal(stub.calls.filter((c) => c.startsWith('listTools')).length, 2,
        'ré-interrogation metadata pré-consommation (ordre GO : 3 avant 6) — documenté');
      // La ligne n’a PAS été consommée par le refus : c’est l’EXPIRATIONqui la
      // rend inutilisable (consume direct, même bindings).
      const direct = consumeDirect(conf, USR_OWNER, HASH_ARGS_A);
      assert.deepEqual(direct, { consumed: false, reason: 'EXPIRED' });
    } finally {
      clockMs = saved;
    }
  });

  /* ---- B3-11 : isolation inter-tenant ---- */

  it('B3-11 tenant étranger sur une confirmation d’un autre tenant : 404 INDISCERNABLE, zéro réseau', async () => {
    const { stub, conf } = await prepareAlpha(ARGS_A);
    const callsBefore = stub.calls.length;
    const foreign = await executeAlpha(stub, conf, ARGS_A, H_FOREIGN);
    assert.equal(foreign.status, 404, 'connecteur inconnu depuis le tenant étranger (404 central)');
    assert.equal(errorBody(foreign).code, 'NOT_FOUND');
    assert.equal(stub.calls.length, callsBefore, 'tenant étranger : AUCUN réseau');
  });

  /* ---- B3-12 : révocation entre préparation et exécution ---- */

  it('B3-12 révocation ENTRE prepare et call → 403, 0 callTool', async () => {
    ensureAlphaApproved();
    const { stub, conf } = await prepareAlpha(ARGS_A);
    assert.equal(b3Store.revokeTool(T_MAIN, cMain, 'outil_alpha'), true);
    const after = await executeAlpha(stub, conf, ARGS_A);
    assert.equal(after.status, 403);
    assert.equal(errorBody(after).code, 'FORBIDDEN');
    assert.ok(!stub.calls.includes('callTool'), 'révocation CRUD : l’outil n’est jamais invoqué');
    ensureAlphaApproved();
  });

  /* ---- B3-13 : changement d'URL (MANDATÉ GO §3) ---- */

  it('B3-13 changement d’URL ENTRE prepare et call : invalidatedConfirmations=1, refus, 0 callTool, consume → REPLAY', async () => {
    ensureAlphaApproved();
    const { stub, conf } = await prepareAlpha(ARGS_A);
    const patched = await call(`/api/v1/mcp-remote/connectors/${cMain}`, 'PATCH', H_OWNER, { url: URL_ALT });
    assert.equal(patched.status, 200);
    const invalidated = (patched.body as { invalidatedConfirmations?: number }).invalidatedConfirmations;
    assert.equal(typeof invalidated, 'number');
    assert.ok(invalidated !== undefined && invalidated >= 1,
      'la PATCH d’URL invalide les confirmations DANS la transaction (D3 + GO §3) — compteur >= 1');
    const after = await executeAlpha(stub, conf, ARGS_A);
    // Refus en couche politique (révocation lisible après D3) — l’exécution
    // d’outil est INATTEIGNABLE ; l’invalidation STOCKAGE est prouvée en bas.
    assert.equal(after.status, 403);
    assert.equal(errorBody(after).code, 'FORBIDDEN');
    assert.ok(!stub.calls.includes('callTool'), 'changement d’URL : AUCUN tools/call');
    // Preuve stockage/niveau anti-rejeu (par-delà la couche politique) :
    const replay = consumeDirect(conf, USR_OWNER, HASH_ARGS_A);
    assert.deepEqual(replay, { consumed: false, reason: 'REPLAY' },
      'la confirmation préparée sur l’ancienne URL est marquée consommée — jamais réutilisable');
    // Remise en état pour les tests suivants (URL d’origine + ré-approbation).
    const restore = await call(`/api/v1/mcp-remote/connectors/${cMain}`, 'PATCH', H_OWNER, { url: URL_MAIN });
    assert.equal(restore.status, 200);
    ensureAlphaApproved();
  });

  /* ---- B3-14 : désactivation entre les deux étapes ---- */

  it('B3-14 désactivation ENTRE prepare et call → 409, ZÉRO réseau (contrôle pré-réseau)', async () => {
    ensureAlphaApproved();
    const { stub, conf } = await prepareAlpha(ARGS_A);
    const callsBefore = stub.calls.length;
    const disabled = await call(`/api/v1/mcp-remote/connectors/${cMain}`, 'PATCH', H_OWNER, { enabled: false });
    assert.equal(disabled.status, 200);
    const after = await executeAlpha(stub, conf, ARGS_A);
    assert.equal(after.status, 409);
    assert.equal(errorBody(after).code, 'MCP_REMOTE_DRIFT');
    assert.equal(stub.calls.length, callsBefore, 'désactivé : détecté AVANT toute interrogation');
    const reactivate = await call(`/api/v1/mcp-remote/connectors/${cMain}`, 'PATCH', H_OWNER, { enabled: true });
    assert.equal(reactivate.status, 200);
  });

  /* ---- B3-15 : concurrence sur UNE confirmation ---- */

  it('B3-15 concurrence : deux exécutions simultanées → 1×200 + 1×409 et callTool total === 1', async () => {
    ensureAlphaApproved();
    const { stub, conf } = await prepareAlpha(ARGS_A);
    const [first, second] = await Promise.all([
      executeAlpha(stub, conf, ARGS_A),
      executeAlpha(stub, conf, ARGS_A)
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409], 'exactement une réussite, exactement un rejeu');
    assert.equal(stub.calls.filter((c) => c === 'callTool').length, 1, 'une SEULE invocation distante au total');
    assert.equal(stub.calls.filter((c) => c.startsWith('listTools')).length, 3,
      'une ré-interrogation metadata par phase (1 prepare + 2 exécutions concurrentes)');
  });

  /* ---- B3-16 : erreurs distantes — la confirmation est brûlée ---- */

  it('B3-16 connect_error → 502 et TIMEOUT → 504 ; rejeu refusé ; audit CALL_FAILED whitelisté', async () => {
    ensureAlphaApproved();
    const { stub, conf } = await prepareAlpha(ARGS_A);
    stub.setCallToolBehavior({ throw: new RemoteMcpClientError('Connexion refusée (stub b3)', 'CONNECT_ERROR') });
    const fail = await executeAlpha(stub, conf, ARGS_A);
    assert.equal(fail.status, 502);
    assert.equal(errorBody(fail).code, 'MCP_REMOTE_UNREACHABLE');
    assert.equal(stub.calls.filter((c) => c === 'callTool').length, 1);
    // Confirmation AJA brûlée par la tentative : rejeu → 409 ; pas de seconde
    // invocation (single-use, même en cas d’échec distamné).
    const replay = await executeAlpha(stub, conf, ARGS_A);
    assert.equal(replay.status, 409);
    assert.equal(errorBody(replay).code, 'MCP_REMOTE_DRIFT');
    assert.equal(stub.calls.filter((c) => c === 'callTool').length, 1);
    // Timeout.
    const { stub: stubT, conf: confT } = await prepareAlpha(ARGS_A);
    stubT.setCallToolBehavior({ throw: new RemoteMcpClientError('Délai dépassé (stub b3)', 'TIMEOUT') });
    const timed = await executeAlpha(stubT, confT, ARGS_A);
    assert.equal(timed.status, 504);
    assert.equal(errorBody(timed).code, 'MCP_REMOTE_TIMEOUT');
    // Journal d’échec : whitelist EXACTE, code transport SEUL — on retrouve
    // les DEUX échecs indépendamment de l’ordre du journal (latest-first).
    const journal = await call('/api/v1/mcp-remote/journal', 'GET', H_OWNER);
    const events = (journal.body as { events: Array<{ action: string; metadata: Record<string, unknown> | null }> }).events;
    const failed = events.filter((e) => e.action === 'MCP_REMOTE_TOOL_CALL_FAILED');
    assert.ok(failed.length >= 2);
    const codeOf = (event: NonNullable<typeof failed[number]>): string =>
      String((event.metadata as Record<string, unknown> | null)?.errorCode ?? '');
    assert.ok(failed.some((e) => codeOf(e) === 'CONNECT_ERROR'), 'l’échec CONNECT_ERROR est journalisé');
    assert.ok(failed.some((e) => codeOf(e) === 'TIMEOUT'), 'l’échec TIMEOUT est journalisé');
  });

  /* ---- B3-17 : matrice RBAC -- MINVOCATION = OWNER + ADMIN ---- */

  it('B3-17 RBAC : ENGINEER/VIEWER → 403 zéro réseau ; ADMIN prépare et exécute SA confirmation', async () => {
    ensureAlphaApproved();
    for (const headers of [H_ENGINEER, H_VIEWER]) {
      const stub = makeCallStub();
      stub.setPages([MAIN_PAGE_S1]);
      setRuntimeForStub(stub);
      const out = await call(PREPARE_PATH(cMain), 'POST', headers, { arguments: ARGS_A });
      assert.equal(out.status, 403);
      assert.equal(stub.calls.length, 0, 'RBAC refusé AVANT toute interrogation');
    }
    const adminPrep = await prepareAlpha({}, MAIN_PAGE_S1, H_ADMIN);
    // ADMIN prépare/confirme avec SON identité (sub de son JWT) — l’exécution
    // par l’OWNER (autre utilisateur) est refusée (binding) :
    const byOwner = await executeAlpha(adminPrep.stub, adminPrep.conf, {}, H_OWNER);
    assert.equal(byOwner.status, 409);
    const byAdmin = await executeAlpha(adminPrep.stub, adminPrep.conf, {}, H_ADMIN);
    assert.equal(byAdmin.status, 200);
  });

  /* ---- B3-18 : réponse distante non conforme ---- */

  it('B3-18 tools/list non conforme (tools non tableau) → 502 fail-closed, jamais un crash', async () => {
    ensureAlphaApproved();
    const stub = makeCallStub();
    stub.setPages([{ tools: 'not-a-tools-array' as unknown, nextCursor: null }]);
    setRuntimeForStub(stub);
    const out = await call(PREPARE_PATH(cMain), 'POST', H_OWNER, { arguments: ARGS_A });
    assert.equal(out.status, 502);
    assert.equal(errorBody(out).code, 'MCP_REMOTE_UNREACHABLE');
    assert.ok(!out.text.includes('not-a-tools-array'), 'aucune charge distante reflétée dans l’erreur');
    assert.ok(!stub.calls.includes('callTool'));
  });

  /* ---- B3-19 : journal sanctuaire + whitelists exactes ---- */

  it('B3-19 journal : NI secret, NI canari d’arguments, NI schéma, NI résultat ; whitelists PREPARED exactes', async () => {
    const journal = await call('/api/v1/mcp-remote/journal', 'GET', H_OWNER);
    assert.equal(journal.status, 200);
    assert.ok(!journal.text.includes(SECRET_PLAINTEXT), 'jamais le secret porteur');
    assert.ok(!journal.text.includes(ARG_CANARY), 'jamais le contenu des arguments (empreintes seules)');
    assert.ok(!journal.text.includes(SCHEMA_MARKER), 'jamais de contenu de schéma');
    assert.ok(!journal.text.includes(CANARY_DESC), 'jamais de description distante');
    assert.ok(!journal.text.includes(STUB_RESULT_OK), 'jamais le contenu du résultat d’outil');
    assert.ok(!journal.text.includes(TAMPER_MARK), 'jamais les arguments falsifiés');
    const events = (journal.body as { events: Array<{ action: string; metadata: Record<string, unknown> | null }> }).events;
    const prepared = events.filter((e) => e.action === 'MCP_REMOTE_TOOL_PREPARED');
    assert.ok(prepared.length >= 2, 'les préparations réussies sont audit');
    for (const event of prepared) {
      assert.deepEqual(
        Object.keys(event.metadata ?? {}).sort(),
        ['argsSha256', 'confirmationId', 'schemaSha256', 'toolName']
      );
    }
    const called = events.filter((e) => e.action === 'MCP_REMOTE_TOOL_CALLED');
    assert.ok(called.length >= 2, 'les exécutions réussies sont auditées');
    for (const event of called) {
      assert.deepEqual(
        Object.keys(event.metadata ?? {}).sort(),
        ['argsSha256', 'confirmationId', 'isError', 'schemaSha256', 'toolName']
      );
    }
    const failed = events.filter((e) => e.action === 'MCP_REMOTE_TOOL_CALL_FAILED');
    assert.ok(failed.length >= 2, 'les échecs distants sont audités (codes seuls)');
    for (const event of failed) {
      assert.deepEqual(
        Object.keys(event.metadata ?? {}).sort(),
        ['argsSha256', 'confirmationId', 'errorCode', 'toolName']
      );
    }
  });
});
