/**
 * MCP-C3.4 — Journalisation des REFUS (§5), invalidation des confirmations au
 * changement du CONTEXTE DE SÉCURITÉ (§4) et preuves d'isolation (§6).
 *
 * Ce que cette suite ajoute PAR RAPPORT à B1/B2/B3 :
 *   C34-1  refus PREPARE (« outil non approuvé ») journalisé : événement
 *          MCP_REMOTE_TOOL_PREPARE_REFUSED, status FAILURE, whitelist EXACTE
 *          {reason, schemaSha256, toolName}, 0 callTool.
 *   C34-2  refus CALL sur identité différente (CONFIRMATION_BINDING_MISMATCH)
 *          puis sur rejeu (CONFIRMATION_REPLAY) : événements
 *          MCP_REMOTE_TOOL_CALL_REFUSED whitelistés, callTool == 1 au total.
 *   C34-3  expiration : refus CONFIRMATION_EXPIRED journalisé ; ligne NON
 *          consommée par le refus (consume direct → EXPIRED) — §3.7 tiendra
 *          même quand la préparation est périmée.
 *   C34-4  RÉVOCATION entre prepare et call : au-delà du refus 403 (B3-12),
 *          la confirmation est INVALIDÉE (consume direct → REPLAY) : une
 *          ré-approbation ne ressuscite plus l'opération préparée (§4).
 *   C34-5  DÉSACTIVATION entre prepare et call : confirmation invalidée
 *          pendant la suspension ET après réactivation (pas de résurrection) ;
 *          le refus CALL « connecteur désactivé » est journalisé (§3.3).
 *   C34-6  ROTATION du secret entre prepare et call : confirmation invalidée
 *          (traitement équivalent au changement d'URL, §4).
 *   C34-7  politique modifiée par un rôle insuffisant : APPROVE/REVOKE/PREPARE
 *          « _REFUSED » avec PERMISSION_DENIED ; zéro réseau (RBAC) ;
 *          OWNER conserve l'exécution nominale (contrôle à CHAQUE appel).
 *   C34-8  isolation des refus inter-tenant : le refus 404 d'un tenant
 *          étranger est journalisé DANS SON journal (il décrit SA requête,
 *          sans créer d'oracle d'existence) et JAMAIS visible du tenant
 *          ciblé (aucun event du tenant ciblé n'en porte la trace).
 *   C34-9  découverte distante non conforme : refus DISCOVERY_REFUSED
 *          journalisé (502 fail-closed, 0 callTool).
 *   C34-10 entrées invalides (arguments non-objet / volumineux, confirmationId
 *          hors gabarit) : refus journalisés INPUT_INVALID, 0 réseau partout.
 *   C34-11 sanctuaire : canaries absentes de TOUT le journal ; TOUTES les
 *          lignes « _REFUSED » portent une raison de la LISTE FERMÉE et des
 *          métadonnées ⊆ union whitelistée (jamais de contenu).
 *
 * Harnais : identique à B1/B2/B3 (serveur HTTP réel port 0, client MCP STUB
 * injecté, VOLACO_DATA_DIR isolé fixé par le PREMIER import, JWT signés,
 * horloge injectée du store de confirmations).
 */

// MCP-TEST-ISOLATION-001 — Doit rester le PREMIER import de la suite (cf.
// ./mcp-remote-isolated-env.ts et l'entête mcp-remote-b3.test.ts).
import './_lot-b-secret-env.js';

import { isolatedVolacoDataDir } from './mcp-remote-isolated-env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setMcpRemoteRuntimeForTests } from '../src/routes/mcp-remote.js';
import { RemoteMcpConnectorStore } from '../../../packages/core/src/mcp/remote/store.js';
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

/** Clé HMAC JWT : fixée AVANT l'import du serveur (vérification = même secret). */
process.env.AUTH_SECRET = 'volaco-test-c34-' + 'jwt-secret-'.repeat(4);

const DATA_DIR = isolatedVolacoDataDir;

const T_MAIN = 'studio-c34-main';
const T_FOREIGN = 'tenant-c34-etranger';

const USR_OWNER = 'usr_owner_c34x';
const USR_ADMIN = 'usr_admin_c34x';
const USR_ENGINEER = 'usr_eng_c34x';
const USR_FOREIGN = 'usr_autre_c34x';

function authHeaders(userId: string, tenantId: string, role: Role): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    authorization: `Bearer ${signToken({ id: userId, tenantId, role, email: `${userId}@c34.test` }, 3600)}`
  };
}

const H_OWNER = authHeaders(USR_OWNER, T_MAIN, 'OWNER');
const H_ADMIN = authHeaders(USR_ADMIN, T_MAIN, 'ADMIN');
const H_ENGINEER = authHeaders(USR_ENGINEER, T_MAIN, 'ENGINEER');
const H_FOREIGN = authHeaders(USR_FOREIGN, T_FOREIGN, 'OWNER');

const URL_MAIN = 'https://api-c34.example.org/mcp';

const CANARY_DESC = 'CANARY-C34-journal-DEFENDU';
const SCHEMA_MARKER = 'MARKER_SCHEMA_C34-' + randomBytes(4).toString('hex');
const ARG_CANARY = 'CANARY-ARGS-C34-' + randomBytes(6).toString('hex');
const SECRET_PLAINTEXT = 'tok_' + randomBytes(16).toString('hex') + '_c34secret';
const SECRET_ROTATED = 'tok_' + randomBytes(16).toString('hex') + '_c34rotated';
const STUB_RESULT_OK = 'stub-c34-result-OK';

const S1: Record<string, unknown> = {
  type: 'object',
  properties: { q: { type: 'string', description: SCHEMA_MARKER } },
  required: ['q']
};
const HASH_S1 = remoteMcpCanonicalSha256(S1);
/** Schéma de outil_beta dans la page stub : objet vide — son hash canonique. */
const HASH_EMPTY = remoteMcpCanonicalSha256({});

const ARGS_A: Record<string, unknown> = { q: ARG_CANARY, limit: 3 };
const HASH_ARGS_A = remoteMcpCanonicalSha256(ARGS_A);

interface PreparedConfirmation {
  confirmationId: string;
  toolName: string;
  schemaSha256: string;
  argsSha256: string;
  expiresAt: number;
}

interface JournalEvent {
  id: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  status?: string;
  userId?: string;
  requestId: string;
  metadata: Record<string, unknown> | null;
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

async function journalEvents(headers: Record<string, string>): Promise<JournalEvent[]> {
  const out = await call(`/api/v1/mcp-remote/journal?limit=999`, 'GET', headers);
  assert.equal(out.status, 200, `journal attendu 200 — reçu ${out.status} : ${out.text}`);
  const list = (out.body as { events?: JournalEvent[] } | null)?.events;
  assert.ok(Array.isArray(list));
  return list;
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

interface StubPage { tools: unknown; nextCursor: string | null }

interface StubToolDef {
  name: string;
  title: string | null;
  description: string | null;
  inputSchema: unknown;
}

interface CallStub {
  calls: string[];
  client: RemoteMcpHttpClient;
  setPages(pages: StubPage[]): void;
}

/** Stub client (copie conforme à B3) : compte initialize / listTools / callTool. */
function makeCallStub(pages: StubPage[]): CallStub {
  const calls: string[] = [];
  let index = 0;
  const client = {
    initialize: async () => {
      calls.push('initialize');
      return {
        protocolVersion: '2025-03-26',
        serverName: 'stub-c34',
        serverVersion: '1.0.0',
        capabilities: {},
        sessionId: 'sess-c34-stub'
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
      return { content: [{ type: 'text', text: STUB_RESULT_OK }], isError: false, structuredContent: null };
    }
  } as unknown as RemoteMcpHttpClient;
  return {
    calls,
    client,
    setPages: (next) => { pages = next; index = 0; }
  };
}

/** Raisons de refus : LISTE FERMÉE (contrat codé côté route, miroir test). */
const CLOSED_REASONS: ReadonlySet<string> = new Set([
  'PERMISSION_DENIED',
  'IDENTITY_UNTRUSTED',
  'INPUT_INVALID',
  'CONNECTOR_NOT_FOUND',
  'CONNECTOR_DISABLED',
  'URL_DRIFT',
  'APPROVAL_URL_DRIFT',
  'TOOL_NOT_FOUND',
  'SCHEMA_INVALID',
  'TOOL_NOT_APPROVED',
  'TOOL_APPROVAL_REVOKED',
  'APPROVAL_SCHEMA_DRIFT',
  'APPROVAL_ABSENT',
  'DISCOVERY_REFUSED',
  'CONFIRMATION_NOT_FOUND',
  'CONFIRMATION_EXPIRED',
  'CONFIRMATION_REPLAY',
  'CONFIRMATION_BINDING_MISMATCH'
]);

/** Union whitelistée des métadonnées de refus (jamais de contenu). */
const REFUSAL_META_KEYS: ReadonlySet<string> = new Set([
  'reason',
  'toolName',
  'schemaSha256',
  'argsSha256',
  'confirmationId',
  'confirmationIdShape'
]);

function refusalEvents(events: JournalEvent[], action: string): JournalEvent[] {
  return events.filter((e) => e.action === action);
}

/** Cherche le refus (action, raison) le plus récent ; retourne null sinon. */
function refusalByReason(events: JournalEvent[], action: string, reason: string): JournalEvent | null {
  const matches = refusalEvents(events, action).filter(
    (e) => String((e.metadata as Record<string, unknown> | null)?.reason) === reason
  );
  return matches.length === 0 ? null : (matches[0] ?? null);
}

/** Échec refus journalisé : statut FAILURE + whitelist EXACTE d'une raison. */
function assertRefusalWhitelisted(
  event: JournalEvent | null,
  reason: string,
  expectedKeys: string[],
  label: string
): void {
  assert.ok(event !== null, `${label} : le refus (${reason}) est journalisé`);
  assert.equal(event.status, 'FAILURE', `${label} : status FAILURE`);
  const meta = event.metadata ?? {};
  assert.equal(String(meta.reason), reason, `${label} : raison structurée`);
  assert.deepEqual(
    Object.keys(meta).sort(),
    [...expectedKeys].sort(),
    `${label} : whitelist EXACTE des métadonnées (${reason})`
  );
  assert.ok(
    Object.keys(meta).every((key) => REFUSAL_META_KEYS.has(key)),
    `${label} : aucune clé de métadonnée hors union whitelistée`
  );
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

function stubTool(name: string, inputSchema: unknown, description: string | null = null): StubToolDef {
  return { name, title: null, description, inputSchema };
}

let baseUrl = '';
let server: Server | undefined;
let store: RemoteMcpConnectorStore;
/** Horloge injectable du store de confirmations (expiration pilotable). */
let clockMs = Date.now();
const confirmationStore = new RemoteMcpConfirmationStore(() => clockMs);
const capturedOptions: RemoteMcpClientOptions[] = [];

function setRuntimeForStub(stub: CallStub): void {
  setMcpRemoteRuntimeForTests({
    connectorStore: () => store,
    confirmationStore: () => confirmationStore,
    clientFactory: (options) => {
      capturedOptions.push(options);
      return stub.client;
    }
  });
}

function ensureApproved(tenantId: string, connectorId: string, tool = 'outil_alpha'): void {
  store.approveTool({
    tenantId,
    connectorId,
    toolName: tool,
    schemaSha256: HASH_S1,
    approvedBy: USR_OWNER
  });
}

/**
 * Connecteur prêt	d (actif + outil_alpha approuvé) : création fail-closed
 * désactivée → activation OWNER (JWT, D5) → approbation politique via le
 * store (les routes d'approbation sont couvertes par B2).
 */
async function createReadyConnector(name: string): Promise<string> {
  const created = await call('/api/v1/mcp-remote/connectors', 'POST', H_OWNER, {
    name,
    url: URL_MAIN,
    secret: SECRET_PLAINTEXT
  });
  assert.equal(created.status, 201, created.text);
  const connectorId = String(
    (created.body as { connector: { connectorId: string } }).connector.connectorId
  );
  const activated = await call(`/api/v1/mcp-remote/connectors/${connectorId}`, 'PATCH', H_OWNER, {
    enabled: true
  });
  assert.equal(activated.status, 200);
  ensureApproved(T_MAIN, connectorId);
  return connectorId;
}

async function prepareAlpha(
  connectorId: string,
  args: Record<string, unknown>,
  page: StubPage = MAIN_PAGE_S1,
  headers: Record<string, string> = H_OWNER
): Promise<{ stub: CallStub; conf: PreparedConfirmation }> {
  const stub = makeCallStub([page]);
  setRuntimeForStub(stub);
  const out = await call(PREPARE_PATH(connectorId), 'POST', headers, { arguments: args });
  return { stub, conf: preparedBody(out) };
}

function consumeDirect(
  connectorId: string,
  conf: PreparedConfirmation,
  userId: string,
  argsSha256: string
) {
  return confirmationStore.consume({
    tenantId: T_MAIN,
    userId,
    confirmationId: conf.confirmationId,
    connectorId,
    toolName: conf.toolName,
    schemaSha256: conf.schemaSha256,
    argsSha256
  });
}

describe('MCP-C3.4 : refus journalisés, invalidations du contexte, isolation', () => {
  before(async () => {
    store = new RemoteMcpConnectorStore(
      new RemoteMcpSecretCipher(createRemoteMcpKeyRing({ active: { keyId: 'c34', key: randomBytes(32) } }))
    );
    setMcpRemoteRuntimeForTests({
      connectorStore: () => store,
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

  /* ---- C34-1 : refus PREPARE « outil non approuvé » journalisé ---- */

  it('C34-1 prepare sans approbation → 403 + PREPARE_REFUSED (TOOL_NOT_APPROVED) whitelist exacte, 0 callTool', async () => {
    const connectorId = await createReadyConnector('c34-1 non-approve');
    const stub = makeCallStub([MAIN_PAGE_BOTH]);
    setRuntimeForStub(stub);
    const out = await call(PREPARE_PATH(connectorId, 'outil_beta'), 'POST', H_OWNER, { arguments: {} });
    assert.equal(out.status, 403);
    assert.equal(errorBody(out).code, 'FORBIDDEN');
    assert.ok(!stub.calls.includes('callTool'), 'AUCUN tools/call sur refus');

    const events = await journalEvents(H_OWNER);
    const refusal = refusalByReason(events, 'MCP_REMOTE_TOOL_PREPARE_REFUSED', 'TOOL_NOT_APPROVED');
    assertRefusalWhitelisted(refusal, 'TOOL_NOT_APPROVED', ['reason', 'schemaSha256', 'toolName'], 'C34-1');
    const meta = refusal?.metadata as Record<string, unknown> | null;
    assert.ok(meta);
    assert.equal(meta.toolName, 'outil_beta');
    assert.equal(meta.schemaSha256, HASH_EMPTY,
      'l’empreinte du schéma VU DU DISTANT pour outil_beta (objet vide, canonique)');
    assert.equal(refusal?.resourceId, connectorId);
  });

  /* ---- C34-2 : refus CALL (identité différente, puis rejeu) journalisés ---- */

  it('C34-2 exécution par un autre utilisateur → BINDING_MISMATCH journalisé ; rejeu → REPLAY ; callTool == 1', async () => {
    const connectorId = await createReadyConnector('c34-2 bindings');
    const prepared = await prepareAlpha(connectorId, ARGS_A);
    const { stub, conf } = prepared;

    // (a) AUTRE utilisateur du même tenant : la confirmation n'est PAS transférable (§4).
    const otherUser = await call(CALL_PATH(connectorId), 'POST', H_ADMIN, {
      confirmationId: conf.confirmationId,
      arguments: ARGS_A
    });
    assert.equal(otherUser.status, 409);
    assert.equal(errorBody(otherUser).code, 'MCP_REMOTE_DRIFT');
    assert.ok(!stub.calls.includes('callTool'));

    // (b) exécution nominale par le porteur → 200, puis rejeu → 409 REPLAY.
    const nominal = await call(CALL_PATH(connectorId), 'POST', H_OWNER, {
      confirmationId: conf.confirmationId,
      arguments: ARGS_A
    });
    assert.equal(nominal.status, 200, nominal.text);
    const replay = await call(CALL_PATH(connectorId), 'POST', H_OWNER, {
      confirmationId: conf.confirmationId,
      arguments: ARGS_A
    });
    assert.equal(replay.status, 409);
    assert.equal(stub.calls.filter((c) => c === 'callTool').length, 1, 'une SEULE invocation au total');

    const events = await journalEvents(H_OWNER);
    const binding = refusalByReason(events, 'MCP_REMOTE_TOOL_CALL_REFUSED', 'CONFIRMATION_BINDING_MISMATCH');
    assertRefusalWhitelisted(
      binding,
      'CONFIRMATION_BINDING_MISMATCH',
      ['reason', 'toolName', 'schemaSha256', 'argsSha256', 'confirmationId'],
      'C34-2a'
    );
    assert.equal((binding?.metadata as Record<string, unknown> | null)?.confirmationId, conf.confirmationId);
    const replayRefusal = refusalByReason(events, 'MCP_REMOTE_TOOL_CALL_REFUSED', 'CONFIRMATION_REPLAY');
    assertRefusalWhitelisted(
      replayRefusal,
      'CONFIRMATION_REPLAY',
      ['reason', 'toolName', 'schemaSha256', 'argsSha256', 'confirmationId'],
      'C34-2b'
    );
  });

  /* ---- C34-3 : expiration journalisée, ligne non consommée par le refus ---- */

  it('C34-3 confirmation expirée → refus CONFIRMATION_EXPIRED journalisé + consume direct → EXPIRED (§3.7)', async () => {
    const connectorId = await createReadyConnector('c34-3 expire');
    const { stub, conf } = await prepareAlpha(connectorId, ARGS_A);
    const saved = clockMs;
    clockMs = saved + REMOTE_MCP_CONFIRMATION_MAX_TTL_MS + 1;
    try {
      const late = await call(CALL_PATH(connectorId), 'POST', H_OWNER, {
        confirmationId: conf.confirmationId,
        arguments: ARGS_A
      });
      assert.equal(late.status, 409);
      assert.equal(errorBody(late).code, 'MCP_REMOTE_DRIFT');
      assert.ok(!stub.calls.includes('callTool'), 'expiration : aucune invocation');

      // La ligne n'a PAS été consommée par le refus : consume direct → EXPIRED.
      const direct = consumeDirect(connectorId, conf, USR_OWNER, HASH_ARGS_A);
      assert.deepEqual(direct, { consumed: false, reason: 'EXPIRED' });
    } finally {
      clockMs = saved;
    }

    const events = await journalEvents(H_OWNER);
    const expired = refusalByReason(events, 'MCP_REMOTE_TOOL_CALL_REFUSED', 'CONFIRMATION_EXPIRED');
    assertRefusalWhitelisted(
      expired,
      'CONFIRMATION_EXPIRED',
      ['reason', 'toolName', 'schemaSha256', 'argsSha256', 'confirmationId'],
      'C34-3'
    );
  });

  /* ---- C34-4 : la RÉVOCATION invalide la confirmation (§4) ---- */

  it('C34-4 révocation ENTRE prepare et call : 403 journaaisé (TOOL_APPROVAL_REVOKED) + consume direct → REPLAY', async () => {
    const connectorId = await createReadyConnector('c34-4 revoke');
    const { stub, conf } = await prepareAlpha(connectorId, ARGS_A);
    assert.equal(store.revokeTool(T_MAIN, connectorId, 'outil_alpha'), true);

    const after = await call(CALL_PATH(connectorId), 'POST', H_OWNER, {
      confirmationId: conf.confirmationId,
      arguments: ARGS_A
    });
    assert.equal(after.status, 403);
    assert.equal(errorBody(after).code, 'FORBIDDEN');
    assert.ok(!stub.calls.includes('callTool'));

    // Invalidations de contexte (§4) : la ligne préparée est marquée consommée
    // DANS la transaction de révocation — une ré-approbation ultérieure ne
    // ressuscite PAS l'opération préparée avant la révocation.
    const direct = consumeDirect(connectorId, conf, USR_OWNER, HASH_ARGS_A);
    assert.deepEqual(direct, { consumed: false, reason: 'REPLAY' },
      'la révocation a invalidé la confirmation (pas seulement le refus politique)');

    const events = await journalEvents(H_OWNER);
    const refusal = refusalByReason(events, 'MCP_REMOTE_TOOL_CALL_REFUSED', 'TOOL_APPROVAL_REVOKED');
    assertRefusalWhitelisted(
      refusal,
      'TOOL_APPROVAL_REVOKED',
      ['reason', 'toolName', 'schemaSha256'],
      'C34-4'
    );
  });

  /* ---- C34-5 : la DÉSACTIVATION invalide la confirmation (pas de résurrection) ---- */

  it('C34-5 désactivation ENTRE prepare et call : confirmation invalidée, refus journalisé (CONNECTOR_DISABLED)', async () => {
    const connectorId = await createReadyConnector('c34-5 disable');
    const { stub, conf } = await prepareAlpha(connectorId, ARGS_A);

    const disabled = await call(`/api/v1/mcp-remote/connectors/${connectorId}`, 'PATCH', H_OWNER, {
      enabled: false
    });
    assert.equal(disabled.status, 200);
    // Preuve stockage : la désactivation a INVALIDÉ la confirmation en même
    // temps que son état (consume → REPLAY).
    const direct1 = consumeDirect(connectorId, conf, USR_OWNER, HASH_ARGS_A);
    assert.deepEqual(direct1, { consumed: false, reason: 'REPLAY' });

    const callDuring = await call(CALL_PATH(connectorId), 'POST', H_OWNER, {
      confirmationId: conf.confirmationId,
      arguments: ARGS_A
    });
    assert.equal(callDuring.status, 409);
    assert.equal(errorBody(callDuring).code, 'MCP_REMOTE_DRIFT');
    assert.ok(!stub.calls.includes('callTool'), 'connecteur désactivé : AUCUNE invocation');

    // PAS de résurrection : la réactivation ne rend PAS la ligne consommable.
    const reacted = await call(`/api/v1/mcp-remote/connectors/${connectorId}`, 'PATCH', H_OWNER, {
      enabled: true
    });
    assert.equal(reacted.status, 200);
    const direct2 = consumeDirect(connectorId, conf, USR_OWNER, HASH_ARGS_A);
    assert.deepEqual(direct2, { consumed: false, reason: 'REPLAY' });

    const events = await journalEvents(H_OWNER);
    const refusal = refusalByReason(events, 'MCP_REMOTE_TOOL_CALL_REFUSED', 'CONNECTOR_DISABLED');
    assertRefusalWhitelisted(refusal, 'CONNECTOR_DISABLED', ['reason'], 'C34-5');
  });

  /* ---- C34-6 : la ROTATION du secret invalide la confirmation (§4) ---- */

  it('C34-6 rotation du secret ENTRE prepare et call : confirmation invalidée (consume → REPLAY)', async () => {
    const connectorId = await createReadyConnector('c34-6 secret');
    const { stub, conf } = await prepareAlpha(connectorId, ARGS_A);

    const swapped = await call(`/api/v1/mcp-remote/connectors/${connectorId}/secret`, 'PUT', H_OWNER, {
      secret: SECRET_ROTATED
    });
    assert.equal(swapped.status, 200, swapped.text);

    const direct = consumeDirect(connectorId, conf, USR_OWNER, HASH_ARGS_A);
    assert.deepEqual(direct, { consumed: false, reason: 'REPLAY' },
      'la rotation du secret invalide les opérations préparées AVANT');

    // L'exécution au-delà du refus refuse TOUJOURS (défense en profondeur :
    // même si la ligne était restée vivante, l'outil n'est pas invoqué sans
    // une préparation POSTérieure à la rotation).
    const late = await call(CALL_PATH(connectorId), 'POST', H_OWNER, {
      confirmationId: conf.confirmationId,
      arguments: ARGS_A
    });
    assert.equal(late.status, 409);
    assert.ok(!stub.calls.includes('callTool'));
  });

  /* ---- C34-7 : RBAC — refus de politique / préparation journalisés ---- */

  it('C34-7 rôle insuffisant : APPROVE_REFUSED + REVOKE_REFUSED + PREPARE_REFUSED PERMISSION_DENIED, 0 réseau', async () => {
    const connectorId = await createReadyConnector('c34-7 rbac');

    // (a) ENGINEER approuve une politique → 403 + APPROVE_REFUSED.
    const stubA = makeCallStub([MAIN_PAGE_S1]);
    setRuntimeForStub(stubA);
    const approve = await call(PREPARE_APPROVE(connectorId), 'POST', H_ENGINEER, { timeoutMs: 1000 });
    assert.equal(approve.status, 403);
    assert.equal(stubA.calls.length, 0, 'RBAC : aucune interrogation pour une approbation interdite');

    // (b) ENGINEER révoque → 403 + REVOKE_REFUSED (aucun réseau par nature).
    const stubR = makeCallStub([MAIN_PAGE_S1]);
    setRuntimeForStub(stubR);
    const revoke = await call(PREPARE_REVOKE(connectorId), 'POST', H_ENGINEER, {});
    assert.equal(revoke.status, 403);

    // (c) ENGINEER prépare → 403 + PREPARE_REFUSED avec PERMISSION_DENIED.
    const stubP = makeCallStub([MAIN_PAGE_S1]);
    setRuntimeForStub(stubP);
    const prepare = await call(PREPARE_PATH(connectorId), 'POST', H_ENGINEER, { arguments: ARGS_A });
    assert.equal(prepare.status, 403);
    assert.equal(stubP.calls.length, 0, 'RBAC refusé AVANT toute interrogation');
    assert.ok(!stubP.calls.includes('callTool'));

    // OWNER/ADMIN exécutent normalement : les permissions restent vérifiées à
    // chaque appel (aucun élargissement implicite).
    const adminPrepared = await prepareAlpha(connectorId, {}, MAIN_PAGE_S1, H_ADMIN);
    const byOwner = await call(CALL_PATH(connectorId), 'POST', H_OWNER, {
      confirmationId: adminPrepared.conf.confirmationId,
      arguments: {}
    });
    assert.equal(byOwner.status, 409, 'une confirmation ADMIN n’est pas transférable à OWNER');
    const byAdmin = await call(CALL_PATH(connectorId), 'POST', H_ADMIN, {
      confirmationId: adminPrepared.conf.confirmationId,
      arguments: {}
    });
    assert.equal(byAdmin.status, 200, byAdmin.text);

    const events = await journalEvents(H_OWNER);
    assertRefusalWhitelisted(
      refusalByReason(events, 'MCP_REMOTE_TOOL_APPROVE_REFUSED', 'PERMISSION_DENIED'),
      'PERMISSION_DENIED',
      ['reason'],
      'C34-7a'
    );
    assertRefusalWhitelisted(
      refusalByReason(events, 'MCP_REMOTE_TOOL_REVOKE_REFUSED', 'PERMISSION_DENIED'),
      'PERMISSION_DENIED',
      ['reason'],
      'C34-7b'
    );
    assertRefusalWhitelisted(
      refusalByReason(events, 'MCP_REMOTE_TOOL_PREPARE_REFUSED', 'PERMISSION_DENIED'),
      'PERMISSION_DENIED',
      ['reason'],
      'C34-7c'
    );
  });

  /* ---- C34-8 : isolation des refus inter-tenant ---- */

  it('C34-8 refus inter-tenant : journalisé DANS le journal du demandeur, JAMAIS visible du tenant ciblé', async () => {
    const connectorId = await createReadyConnector('c34-8 isolation');
    const stub = makeCallStub([MAIN_PAGE_S1]);
    setRuntimeForStub(stub);

    // Un owner ÉTRANGER vise l'id d'un connecteur du tenant principal : 404
    // indiscernable (B3-11), et le refus est journalisé POUR son tenant.
    const foreign = await call(PREPARE_PATH(connectorId), 'POST', H_FOREIGN, { arguments: ARGS_A });
    assert.equal(foreign.status, 404);
    assert.equal(errorBody(foreign).code, 'NOT_FOUND');
    assert.equal(stub.calls.length, 0, 'tenant étranger : AUCUN réseau');

    const foreignEvents = await journalEvents(H_FOREIGN);
    const foreignRefusal = refusalByReason(
      foreignEvents,
      'MCP_REMOTE_TOOL_PREPARE_REFUSED',
      'CONNECTOR_NOT_FOUND'
    );
    assert.ok(foreignRefusal, 'le refus est journalisé au tenant DEMANDEUR');
    assert.equal(foreignRefusal?.resourceId, connectorId, 'le resourceId décrit SA requête (pas un oracle)');
    assert.equal(foreignRefusal?.status, 'FAILURE');
    const foreignRequestId = foreignRefusal?.requestId ?? '';
    assert.ok(foreignRequestId.length > 0);

    // Le tenant ciblé ne voit RIEN de cette requête : pas l'event, pas le
    // requestId — le journal EST tenant-isolé, y compris pour les refus.
    const mainEvents = await journalEvents(H_OWNER);
    assert.equal(
      mainEvents.filter((e) => e.requestId === foreignRequestId).length, 0,
      'aucun event du tenant ciblé ne porte la trace de la requête étrangère'
    );
    assert.ok(
      !mainEvents.some((e) => e.userId === USR_FOREIGN),
      'le journal du tenant principal ne contient aucune ligne du tenant étranger'
    );
  });

  /* ---- C34-9 : découverte distante non conforme → refus journalisé ---- */

  it('C34-9 tools/list non conforme → 502 + PREPARE_REFUSED (DISCOVERY_REFUSED) journalisé, 0 callTool', async () => {
    const connectorId = await createReadyConnector('c34-9 discovery');
    const stub = makeCallStub([{ tools: 'not-a-tools-array' as unknown, nextCursor: null }]);
    setRuntimeForStub(stub);
    const out = await call(PREPARE_PATH(connectorId), 'POST', H_OWNER, { arguments: ARGS_A });
    assert.equal(out.status, 502);
    assert.equal(errorBody(out).code, 'MCP_REMOTE_UNREACHABLE');
    assert.ok(!out.text.includes('not-a-tools-array'), 'aucune charge distante reflétée');
    assert.ok(!stub.calls.includes('callTool'));

    const events = await journalEvents(H_OWNER);
    const refusal = refusalByReason(events, 'MCP_REMOTE_TOOL_PREPARE_REFUSED', 'DISCOVERY_REFUSED');
    assertRefusalWhitelisted(refusal, 'DISCOVERY_REFUSED', ['reason'], 'C34-9');
  });

  /* ---- C34-10 : entrées invalides → refus INPUT_INVALID journalisés ---- */

  it('C34-10 entrées invalides (args non-objet, volume, confirmationId hors gabarit) → INPUT_INVALID journalisé, 0 réseau', async () => {
    const connectorId = await createReadyConnector('c34-10 input');

    // (a) call : arguments non-objet → 400 + CALL_REFUSED INPUT_INVALID.
    let stub = makeCallStub([MAIN_PAGE_S1]);
    setRuntimeForStub(stub);
    const badArgs = await call(CALL_PATH(connectorId), 'POST', H_OWNER, {
      confirmationId: 'c'.repeat(32), arguments: 'hello'
    });
    assert.equal(badArgs.status, 400);
    assert.equal(errorBody(badArgs).code, 'VALIDATION_ERROR');
    assert.equal(stub.calls.length, 0, 'AUCUN réseau pour une charge invalide');

    // (b) call : confirmationId hors gabarit → 400 + CALL_REFUSED INPUT_INVALID.
    stub = makeCallStub([MAIN_PAGE_S1]);
    setRuntimeForStub(stub);
    const badId = await call(CALL_PATH(connectorId), 'POST', H_OWNER, {
      confirmationId: 'bad;chars!', arguments: ARGS_A
    });
    assert.equal(badId.status, 400);
    assert.equal(stub.calls.length, 0);

    // (c) prepare : arguments canoniques hors bornes (> 16 KiB) → 400.
    stub = makeCallStub([MAIN_PAGE_S1]);
    setRuntimeForStub(stub);
    const bigArgs = await call(PREPARE_PATH(connectorId), 'POST', H_OWNER, {
      arguments: { blob: 'x'.repeat(20_000) }
    });
    assert.equal(bigArgs.status, 400);
    assert.equal(stub.calls.length, 0);

    const events = await journalEvents(H_OWNER);
    const callRefusal = refusalEvents(events, 'MCP_REMOTE_TOOL_CALL_REFUSED')
      .find((e) => String((e.metadata as Record<string, unknown> | null)?.reason) === 'INPUT_INVALID');
    assert.ok(callRefusal, 'le refus d’arguments du CALL est journalisé');
    const prepareRefusal = refusalEvents(events, 'MCP_REMOTE_TOOL_PREPARE_REFUSED')
      .find((e) => String((e.metadata as Record<string, unknown> | null)?.reason) === 'INPUT_INVALID');
    assert.ok(prepareRefusal, 'le refus d’arguments du PREPARE est journalisé');
    const idShapeRefusal = refusalEvents(events, 'MCP_REMOTE_TOOL_CALL_REFUSED')
      .find((e) => (e.metadata as Record<string, unknown> | null)?.confirmationIdShape === 'invalid');
    assert.ok(idShapeRefusal, 'le refus de confirmationId hors gabarit est journalisé');
  });

  /* ---- C34-11 : sanctuaire du journal TOUT entier ---- */

  it('C34-11 sanctuaire : canaries absentes ; toute ligne « _REFUSED » porte une raison fermée ⊆ whitelist', async () => {
    const events = await journalEvents(H_OWNER);
    assert.ok(events.length > 0, 'des événements sont présents');
    const text = JSON.stringify(events);
    assert.ok(!text.includes(SECRET_PLAINTEXT), 'jamais le secret');
    assert.ok(!text.includes(SECRET_ROTATED), 'jamais le second secret');
    assert.ok(!text.includes(ARG_CANARY), 'jamais le contenu des arguments');
    assert.ok(!text.includes(SCHEMA_MARKER), 'jamais de contenu de schéma');
    assert.ok(!text.includes(CANARY_DESC), 'jamais de description distante');
    assert.ok(!text.includes(STUB_RESULT_OK), 'jamais le contenu du résultat');

    const refusals = events.filter(
      (e) => e.action.endsWith('_REFUSED') || e.action.endsWith('DISCOVERY_REFUSED')
    );
    assert.ok(refusals.length >= 7, 'plusieurs refus ont été journalisés pendant la suite');
    for (const refusal of refusals) {
      assert.equal(refusal.status, 'FAILURE', 'un refus est TOUJOURS status FAILURE');
      const meta = refusal.metadata ?? {};
      assert.ok(
        typeof meta.reason === 'string' && CLOSED_REASONS.has(String(meta.reason)),
        `raison de la liste fermée (trouvé : ${String(meta.reason)})`
      );
      for (const key of Object.keys(meta)) {
        assert.ok(
          REFUSAL_META_KEYS.has(key),
          `métadonnée de refus hors union whitelistée (${key})`
        );
      }
    }
  });
});

/** PATCH libre du gabarit URL : les helpers de chemin des opérations d'outil. */
function PREPARE_APPROVE(connectorId: string): string {
  return `/api/v1/mcp-remote/connectors/${connectorId}/tools/outil_alpha/approve`;
}
function PREPARE_REVOKE(connectorId: string): string {
  return `/api/v1/mcp-remote/connectors/${connectorId}/tools/outil_alpha/revoke`;
}
