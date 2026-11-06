/**
 * C3.2-B2 — Tests d'intégration des routes de DÉCOUVERTE & d'APPROBATION :
 *   GET  /api/v1/mcp-remote/connectors/:id/tools            (tools/list borné)
 *   POST /api/v1/mcp-remote/connectors/:id/tools/:t/approve (hash canonique
 *        recalculé SERVEUR — source exclusive : serveur distant ré-interrogé)
 *   POST /api/v1/mcp-remote/connectors/:id/tools/:t/revoke
 *
 * OBLIGATIONS COUVERTES :
 *   - découverte réussie & serveur inaccessible (502/504 normalisés) ;
 *   - outil inconnu (404) & schéma invalide (400, AUCUNE écriture) ;
 *   - approbation explicite, idempotence de révocation, 404 sans politique ;
 *   - hash stable, dérive du schéma détectée (drift), ré-approbation possible ;
 *   - le corps du navigateur n'est JAMAIS une preuve (schema envoyé → ignoré) ;
 *   - isolation inter-tenant (404 indiscernable) + matrice RBAC stricte
 *     (TENANT_MANAGE = OWNER seul : ADMIN/ENGINEER/VIEWER → 403) ;
 *   - changement d'URL → révocation (D3, niveau routes) ;
 *   - TOCTOU : mutation d'URL commise PENDANT la demande → 409 sans écriture ;
 *   - connecteur désactivé : découverte/approbation permises (D5) sans l'activer ;
 *   - pagination bornée (pages/outils → refus 502 fail-closed) ;
 *   - schéma volumineux : affichage borné, hash/approbation SUR le schéma
 *     complet (l'approbation ne dépend jamais de la borne d'affichage) ;
 *   - AUCUN tools/call jamais émis (stub qui throw si invoqué) ;
 *   - journal : aucun secret, aucun schéma, aucune description distante.
 *
 * Harnais identique à B1 : serveur HTTP réel (port 0), repli dev en en-têtes,
 * client MCP STUB injecté (aucun réseau réel), VOLACO_DATA_DIR temporaire fixé
 * AVANT l'import dynamique de server.js.
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

/** MCP-TEST-ISOLATION-001 : DATA_DIR = répertoire mkdtemp neuf fourni par le
 * module d'isolement (importé en premier) — VOLACO_DATA_DIR y est déjà fixé à
 * ce stade. Le rmSync final (after) reste inchangé. */
const DATA_DIR = isolatedVolacoDataDir;

const T_MAIN = 'studio-b2-main';
const T_FOREIGN = 'tenant-b2-etranger';

const H_OWNER = { 'Content-Type': 'application/json', 'x-tenant-id': T_MAIN, 'x-user-role': 'OWNER' };
const H_ADMIN = { 'Content-Type': 'application/json', 'x-tenant-id': T_MAIN, 'x-user-role': 'ADMIN' };
const H_ENGINEER = { 'Content-Type': 'application/json', 'x-tenant-id': T_MAIN, 'x-user-role': 'ENGINEER' };
const H_VIEWER = { 'Content-Type': 'application/json', 'x-tenant-id': T_MAIN, 'x-user-role': 'VIEWER' };
const H_FOREIGN = { 'Content-Type': 'application/json', 'x-tenant-id': T_FOREIGN, 'x-user-role': 'OWNER' };

const URL_MAIN = 'https://api-b2.example.org/mcp';
const URL_ALT = 'https://api-b2-alt.example.org/mcp';

/** Jeton texte présent UNIQUEMENT dans les réponses de découverte — jamais dans le journal. */
const CANARY_DESC = 'CANARY-B2-journal-DEFENDU';
/** Marqueur inséré DANS un schéma distant — jamais dans le journal. */
const SCHEMA_MARKER = 'MARKER_SCHEMA_B2-' + randomBytes(4).toString('hex');
/** Secret porteur (vérifié au plumb, interdit en journal). */
const SECRET_PLAINTEXT = 'tok_' + randomBytes(16).toString('hex') + '_b2secret';

/** Schéma S1 (outil_alpha) — Peu profond, avec marqueur unique. */
const S1: Record<string, unknown> = {
  type: 'object',
  properties: { q: { type: 'string', description: SCHEMA_MARKER } },
  required: ['q']
};
/** Schéma S2 (dérive : champ OBLIGATOIRE ajouté). */
const S2: Record<string, unknown> = {
  type: 'object',
  properties: { q: { type: 'string', description: SCHEMA_MARKER }, flag: { type: 'boolean' } },
  required: ['q', 'flag']
};
/** Schéma FK envoyé par le NAVIGATEUR dans un corps de requête (DOIT être ignoré). */
const S_FAKE_BROWSER: Record<string, unknown> = {
  type: 'string',
  description: 'FAUX-CORPS-NAVIGATEUR-B2'
};
/** Schéma du second (concurrence TOCTOU). */
const S_RACE: Record<string, unknown> = {
  type: 'object',
  properties: { turn: { type: 'integer' } },
  required: ['turn']
};
/** Schéma volumineux (> 8192 octets canoniques) — affichage borné, hash complet. */
function buildBigSchema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (let i = 0; i < 400; i++) {
    properties[`filler_${String(i).padStart(3, '0')}`] = { type: 'string' };
  }
  return { type: 'object', description: 'schéma volumineux', populated: properties, _minProperties: 0, typical: 'ENT' };
}
const S_BIG = buildBigSchema();

const HASH_S1 = remoteMcpCanonicalSha256(S1);
const HASH_S2 = remoteMcpCanonicalSha256(S2);
const HASH_S_FAKE = remoteMcpCanonicalSha256(S_FAKE_BROWSER);
const HASH_S_RACE = remoteMcpCanonicalSha256(S_RACE);
const HASH_S_BIG = remoteMcpCanonicalSha256(S_BIG);

let baseUrl = '';
let server: Server | undefined;
let b2Store: RemoteMcpConnectorStore;
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

interface StubToolDef {
  name: string;
  title: string | null;
  description: string | null;
  inputSchema: unknown;
}

interface StubPage { tools: StubToolDef[]; nextCursor: string | null }

/** Stub tools/list paginé : enregistre les méthodes, throw sur callTool (INTERDIT ici). */
interface ToolsStub {
  calls: string[];
  client: RemoteMcpHttpClient;
  setPages(pages: StubPage[]): void;
}

function makeToolsStub(): ToolsStub {
  const calls: string[] = [];
  let pages: StubPage[] = [];
  let index = 0;
  const client = {
    initialize: async () => {
      calls.push('initialize');
      return {
        protocolVersion: '2025-03-26',
        serverName: 'stub-b2-discovery',
        serverVersion: '1.0.0',
        capabilities: {},
        sessionId: 'sess-b2-stub'
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
      throw new Error('callTool est INTERDIT en B2 (stub) — aucune invocation attendue');
    }
  } as unknown as RemoteMcpHttpClient;
  return { calls, client, setPages: (next) => { pages = next; index = 0; } };
}

function useStub(stub: ToolsStub): void {
  setMcpRemoteRuntimeForTests({
    connectorStore: () => b2Store,
    clientFactory: (options) => {
      capturedOptions.push(options);
      return stub.client;
    }
  });
}

function stubTool(name: string, inputSchema: unknown, description: string | null = null): StubToolDef {
  return { name, title: null, description, inputSchema };
}

describe('C3.2-B2 : découverte & approbation /api/v1/mcp-remote', () => {
  before(async () => {
    b2Store = new RemoteMcpConnectorStore(
      new RemoteMcpSecretCipher(createRemoteMcpKeyRing({ active: { keyId: 'b2', key: randomBytes(32) } }))
    );
    setMcpRemoteRuntimeForTests({ connectorStore: () => b2Store });
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

  let cMain = '';
  let raceId = '';

  /* ---- B2-1 : découverte réussie, AUCUNE auto-approbation, aucun callTool ---- */

  it('B2-1 découverte : outils listés, hash canoniques SERVEUR, aucune approbation auto, aucun tools/call', async () => {
    const created = await call('/api/v1/mcp-remote/connectors', 'POST', H_OWNER, {
      name: 'b2 principal',
      url: URL_MAIN,
      secret: SECRET_PLAINTEXT
    });
    assert.equal(created.status, 201);
    assert.equal((created.body as { connector: { enabled: boolean } }).connector.enabled, false, 'création fail-closed : désactivé par défaut');
    cMain = String((created.body as { connector: { connectorId: string } }).connector.connectorId);
    const activated = await call(`/api/v1/mcp-remote/connectors/${cMain}`, 'PATCH', H_OWNER, { enabled: true });
    assert.equal(activated.status, 200);

    const stub = makeToolsStub();
    stub.setPages([
      {
        tools: [
          stubTool('outil_alpha', S1, `Alpha ${CANARY_DESC}`),
          stubTool('outil_beta', {}, `Beta ${CANARY_DESC}`)
        ],
        nextCursor: null
      }
    ]);
    capturedOptions.length = 0;
    useStub(stub);

    const out = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools`, 'GET', H_OWNER);
    assert.equal(out.status, 200);
    const payload = out.body as {
      connector: { connectorId: string; name: string; enabled: boolean };
      tools: Array<{
        toolName: string; description: string | null; inputSchema: unknown;
        schemaSha256: string | null; schemaStatus: string;
        approval: { status: string; approvedSchemaSha256: string | null; drift: boolean };
      }>;
      schemaInvalidCount: number;
      displayTruncatedCount: number;
      requestId: string;
    };
    assert.equal(payload.tools.length, 2);
    assert.equal(payload.connector.enabled, true);
    const alpha = payload.tools.find((t) => t.toolName === 'outil_alpha');
    assert.ok(alpha);
    assert.equal(alpha.schemaStatus, 'OK');
    assert.equal(alpha.schemaSha256, HASH_S1, 'hash canonique calculé SERVEUR sur le schéma du distant');
    assert.deepEqual(alpha.approval, { status: 'NONE', approvedSchemaSha256: null, drift: false });
    const beta = payload.tools.find((t) => t.toolName === 'outil_beta');
    assert.ok(beta);
    assert.equal(beta.schemaSha256, remoteMcpCanonicalSha256({}));
    // La description distante EST dans la réponse (donnée d'affichage non fiable),
    // mais JAMAIS journalisée (vérification du journal en B2-16).
    assert.ok(out.text.includes(CANARY_DESC));
    // Plomberie : bearer décrypté fourni au client, URL du connecteur courant.
    assert.equal(capturedOptions.length, 1);
    const wireDiscovery = capturedOptions[0];
    assert.ok(wireDiscovery, 'options client capturées');
    assert.equal(wireDiscovery.url, URL_MAIN);
    assert.equal(wireDiscovery.bearerToken, SECRET_PLAINTEXT);
    // AUCUNE approbation automatique : le store reste sans politique.
    assert.equal(b2Store.listToolPolicies(T_MAIN, cMain).length, 0);
    // AUCUNE invocation d'outil.
    assert.ok(!stub.calls.includes('callTool'), 'callTool interdit pendant la découverte');
    assert.ok(stub.calls.includes('listTools'));
    // Journal de découverte : compteurs seuls.
    const journal = await call('/api/v1/mcp-remote/journal', 'GET', H_OWNER);
    const events = (journal.body as { events: Array<{ action: string; metadata: Record<string, unknown> | null }> }).events;
    const discovered = events.find((event) => event.action === 'MCP_REMOTE_TOOLS_DISCOVERED');
    assert.ok(discovered);
    assert.deepEqual(discovered.metadata, { toolCount: 2, schemaInvalidCount: 0, displayTruncatedCount: 0 });
  });

  /* ---- B2-2 : serveur inaccessible / timeout ---- */

  it('B2-2 découverte : CONNECT_ERROR → 502 MCP_REMOTE_UNREACHABLE ; TIMEOUT → 504 MCP_REMOTE_TIMEOUT', async () => {
    setMcpRemoteRuntimeForTests({
      connectorStore: () => b2Store,
      clientFactory: () => {
        throw new RemoteMcpClientError('Connexion refusée (stub b2)', 'CONNECT_ERROR');
      }
    });
    const refused = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools`, 'GET', H_OWNER);
    assert.equal(refused.status, 502);
    assert.equal(errorBody(refused).code, 'MCP_REMOTE_UNREACHABLE');

    setMcpRemoteRuntimeForTests({
      connectorStore: () => b2Store,
      clientFactory: () => {
        throw new RemoteMcpClientError('Délai dépassé (stub b2)', 'TIMEOUT');
      }
    });
    const slow = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools`, 'GET', H_OWNER);
    assert.equal(slow.status, 504);
    assert.equal(errorBody(slow).code, 'MCP_REMOTE_TIMEOUT');
  });

  /* ---- B2-3 : outil inconnu ---- */

  it('B2-3 approbation outil INCONDUIT (absent du tools/list) → 404, aucune politique', async () => {
    const stub = makeToolsStub();
    stub.setPages([{ tools: [stubTool('outil_alpha', S1, `Alpha ${CANARY_DESC}`)], nextCursor: null }]);
    useStub(stub);
    const out = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/outil_absent/approve`, 'POST', H_OWNER, {});
    assert.equal(out.status, 404);
    assert.equal(errorBody(out).code, 'NOT_FOUND');
    assert.ok(!out.text.includes('outil_absent'), 'aucun écho hostile du contenu demandé dans le corps');
    assert.equal(b2Store.listToolPolicies(T_MAIN, cMain).length, 0);
  });

  /* ---- B2-4 : schéma invalide (chaîne / absent) ---- */

  it('B2-4 schémas invalides → 400 fail-closed, AUCUNE écriture de politique', async () => {
    const stub = makeToolsStub();
    stub.setPages([
      {
        tools: [
          stubTool('outil_alpha', S1, `Alpha ${CANARY_DESC}`),
          stubTool('outil_brokenschema', 'chaine-non-objet', 'schema corrompu'),
          stubTool('outil_sansschema', undefined, 'schema absent')
        ],
        nextCursor: null
      }
    ]);
    useStub(stub);
    for (const tool of ['outil_brokenschema', 'outil_sansschema']) {
      const out = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/${tool}/approve`, 'POST', H_OWNER, {});
      assert.equal(out.status, 400, `refus ${tool}`);
      assert.equal(errorBody(out).code, 'VALIDATION_ERROR');
    }
    assert.equal(b2Store.listToolPolicies(T_MAIN, cMain).length, 0, 'aucune politique écrite');
  });

  /* ---- B2-5 : approbation explicite + preuve de provenance + révocation ---- */

  it('B2-5 approbation OWNER : hash exact, ligne APPROVED, journal strict, révocation idempotente', async () => {
    const stub = makeToolsStub();
    stub.setPages([{ tools: [stubTool('outil_alpha', S1, `Alpha ${CANARY_DESC}`)], nextCursor: null }]);
    useStub(stub);
    capturedOptions.length = 0;

    const approved = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/outil_alpha/approve`, 'POST', H_OWNER, {});
    assert.equal(approved.status, 200);
    const approval = (approved.body as { approval: { toolName: string; schemaSha256: string; status: string; approvedBy: string } }).approval;
    assert.equal(approval.toolName, 'outil_alpha');
    assert.equal(approval.schemaSha256, HASH_S1);
    assert.equal(approval.status, 'APPROVED');
    assert.equal(approval.approvedBy, 'OWNER', 'contexte dev : identité = rôle (aucun userId fabriqué)');
    // Le bearer déchiffré a plombé le client (provenance bien authentifiée).
    assert.equal(capturedOptions.length, 1);
    const wireApprove = capturedOptions[0];
    assert.ok(wireApprove, 'options client capturées');
    assert.equal(wireApprove.bearerToken, SECRET_PLAINTEXT);
    // Ligne APPROVED visible du store (hash exact).
    const policy = b2Store.getToolApproval(T_MAIN, cMain, 'outil_alpha', HASH_S1);
    assert.ok(policy);
    assert.equal(policy.status, 'APPROVED');
    // Journal : métadonnées EXACTES (nom + empreinte seulement).
    const journal = await call('/api/v1/mcp-remote/journal', 'GET', H_OWNER);
    const events = (journal.body as { events: Array<{ action: string; metadata: Record<string, unknown> | null }> }).events;
    const logged = events.find((event) => event.action === 'MCP_REMOTE_TOOL_APPROVED');
    assert.ok(logged);
    assert.deepEqual(logged.metadata, { toolName: 'outil_alpha', schemaSha256: HASH_S1 });

    // Révocation : ligne passe REVOKED (conservée), getToolApproval null.
    const revoked = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/outil_alpha/revoke`, 'POST', H_OWNER, {});
    assert.equal(revoked.status, 200);
    assert.equal((revoked.body as { revocation: { toolName: string; status: string } }).revocation.status, 'REVOKED');
    assert.equal(b2Store.getToolApproval(T_MAIN, cMain, 'outil_alpha', HASH_S1), null);
    const policies = b2Store.listToolPolicies(T_MAIN, cMain);
    assert.equal(policies.length, 1);
    const revokedRow = policies[0];
    assert.ok(revokedRow);
    assert.equal(revokedRow.status, 'REVOKED');
    // Révocation IDEMPOTENTE (ligne toujours présente), et 404 pour un outil jamais approuvé.
    const revokedAgain = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/outil_alpha/revoke`, 'POST', H_OWNER, {});
    assert.equal(revokedAgain.status, 200);
    const revokedUnknown = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/outil_mort/revoke`, 'POST', H_OWNER, {});
    assert.equal(revokedUnknown.status, 404);
  });

  /* ---- B2-6 : le schéma du navigateur n'est JAMAIS une preuve ---- */

  it('B2-6 corps navigateur avec schéma FABRIQUÉ → totalement ignoré (hash = distant ré-interrogé)', async () => {
    const stub = makeToolsStub();
    stub.setPages([{ tools: [stubTool('outil_alpha', S1, `Alpha ${CANARY_DESC}`)], nextCursor: null }]);
    useStub(stub);
    const out = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/outil_alpha/approve`, 'POST', H_OWNER, {
      inputSchema: S_FAKE_BROWSER,
      toolName: 'atomique',
      schemaSha256: HASH_S_FAKE,
      oui: 'définit le corps entier comme non-fiable'
    });
    assert.equal(out.status, 200);
    const saved = b2Store.listToolPolicies(T_MAIN, cMain).find((p) => p.toolName === 'outil_alpha');
    assert.ok(saved);
    assert.equal(saved.schemaSha256, HASH_S1, "hash issu du tools/list du DISTANT, jamais du corps");
    assert.equal(saved.status, 'APPROVED');
    assert.ok(!stub.calls.includes('callTool'));
  });

  /* ---- B2-7 : hash stable & dérive du schéma ---- */

  it('B2-7 dérive : schéma change → discovery drift true, ligne inchangée ; ré-approbation possible', async () => {
    let stub = makeToolsStub();
    stub.setPages([{ tools: [stubTool('outil_alpha', S1, `Alpha ${CANARY_DESC}`)], nextCursor: null }]);
    useStub(stub);
    // Approbation sur S1 (re-approbation après B2-5 révoke → redevient APPROVED sur S1).
    const reapproved = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/outil_alpha/approve`, 'POST', H_OWNER, {});
    assert.equal(reapproved.status, 200);
    assert.equal(b2Store.getToolApproval(T_MAIN, cMain, 'outil_alpha', HASH_S1)?.status, 'APPROVED');

    // Dérive : le distant déclare désormais S2 pour le même nom.
    stub = makeToolsStub();
    stub.setPages([{ tools: [stubTool('outil_alpha', S2, `Alpha v2`)], nextCursor: null }]);
    useStub(stub);
    const drift = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools`, 'GET', H_OWNER);
    assert.equal(drift.status, 200);
    const alpha = (drift.body as {
      tools: Array<{ toolName: string; schemaSha256: string | null; approval: { status: string; approvedSchemaSha256: string | null; drift: boolean } }>;
    }).tools.find((t) => t.toolName === 'outil_alpha');
    assert.ok(alpha);
    assert.equal(alpha.schemaSha256, HASH_S2, 'hash courant recalculé sur S2');
    assert.equal(alpha.approval.status, 'APPROVED');
    assert.equal(alpha.approval.approvedSchemaSha256, HASH_S1, 'empreinte approuvée inchangée');
    assert.equal(alpha.approval.drift, true, 'dérive explicitement exposée');
    // La ligne du store n'a PAS été modifiée par simple consultation.
    assert.equal(b2Store.getToolApproval(T_MAIN, cMain, 'outil_alpha', HASH_S1)?.status, 'APPROVED');
    assert.equal(b2Store.getToolApproval(T_MAIN, cMain, 'outil_alpha', HASH_S2), null);

    // Stabilité : re-discovery sur S2 — hash identique, pas d'effet de bord.
    const again = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools`, 'GET', H_OWNER);
    assert.equal(again.status, 200);
    const alpha2 = (again.body as { tools: Array<{ toolName: string; schemaSha256: string | null }> }).tools.find((t) => t.toolName === 'outil_alpha');
    assert.equal(alpha2?.schemaSha256, HASH_S2, 'hash stable run en run');

    // Ré-approbation = nouvel engagement explicite du OWNER sur S2 (recovery path).
    const rebound = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/outil_alpha/approve`, 'POST', H_OWNER, {});
    assert.equal(rebound.status, 200);
    assert.equal(((rebound.body as { approval: { schemaSha256: string } }).approval).schemaSha256, HASH_S2);
    assert.equal(b2Store.getToolApproval(T_MAIN, cMain, 'outil_alpha', HASH_S2)?.status, 'APPROVED');
  });

  /* ---- B2-8 : RBAC — TENANT_MANAGE = OWNER seul ---- */

  it('B2-8 RBAC : ADMIN/ENGINEER/VIEWER refusés sur découverte/approbation/révocation (403)', async () => {
    for (const headers of [H_ADMIN, H_ENGINEER, H_VIEWER]) {
      const discovered = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools`, 'GET', headers);
      assert.equal(discovered.status, 403, `découverte ${headers['x-user-role']}`);
      const approved = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/outil_alpha/approve`, 'POST', headers, {});
      assert.equal(approved.status, 403, `approbation ${headers['x-user-role']}`);
      const revoked = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/outil_alpha/revoke`, 'POST', headers, {});
      assert.equal(revoked.status, 403, `révocation ${headers['x-user-role']}`);
    }
  });

  /* ---- B2-9 : isolation inter-tenant (404 indiscernable) ---- */

  it('B2-9 autre tenant : découverte/approbation/révocation → 404, politiques inchangées', async () => {
    const before = b2Store.listToolPolicies(T_MAIN, cMain).length;
    const discovered = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools`, 'GET', H_FOREIGN);
    assert.equal(discovered.status, 404);
    const approved = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/outil_alpha/approve`, 'POST', H_FOREIGN, {});
    assert.equal(approved.status, 404);
    const revoked = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/outil_alpha/revoke`, 'POST', H_FOREIGN, {});
    assert.equal(revoked.status, 404);
    assert.equal(b2Store.listToolPolicies(T_MAIN, cMain).length, before, 'aucune externalisation cross-tenant');
  });

  /* ---- B2-10 : changement d'URL → révocation (D3, niveau routes) ---- */

  it('B2-10 PATCH url → approbations révoquées (D3)', async () => {
    const created = await call('/api/v1/mcp-remote/connectors', 'POST', H_OWNER, { name: 'b2 revoke url', url: URL_MAIN });
    assert.equal(created.status, 201);
    const cid = String((created.body as { connector: { connectorId: string } }).connector.connectorId);

    const stub = makeToolsStub();
    stub.setPages([{ tools: [stubTool('outil_d3', S1, null)], nextCursor: null }]);
    useStub(stub);
    const approved = await call(`/api/v1/mcp-remote/connectors/${cid}/tools/outil_d3/approve`, 'POST', H_OWNER, {});
    assert.equal(approved.status, 200);
    assert.ok(b2Store.getToolApproval(T_MAIN, cid, 'outil_d3', HASH_S1));

    const patched = await call(`/api/v1/mcp-remote/connectors/${cid}`, 'PATCH', H_OWNER, { url: URL_ALT });
    assert.equal(patched.status, 200);
    const revokedNames = (patched.body as { revokedToolNames?: string[] }).revokedToolNames;
    assert.deepEqual(revokedNames, ['outil_d3'], 'révocation atomique rapportée');
    assert.equal(b2Store.getToolApproval(T_MAIN, cid, 'outil_d3', HASH_S1), null);
  });

  /* ---- B2-11 : TOCTOU — mutation d'URL PENDANT l'approbation ---- */

  it('B2-11 concurrence : URL commise PENDANT la demande → 409 MCP_REMOTE_DRIFT, aucune politique ; ré-approbation ensuite OK', async () => {
    const created = await call('/api/v1/mcp-remote/connectors', 'POST', H_OWNER, { name: 'b2 race', url: URL_MAIN });
    assert.equal(created.status, 201);
    raceId = String((created.body as { connector: { connectorId: string } }).connector.connectorId);

    const calls: string[] = [];
    setMcpRemoteRuntimeForTests({
      connectorStore: () => b2Store,
      clientFactory: () => {
        calls.length = 0;
        return {
          initialize: async () => {
            calls.push('initialize');
            return { protocolVersion: '2025-03-26', serverName: 'stub-race', serverVersion: '1.0.0', capabilities: {}, sessionId: null };
          },
          listTools: async () => {
            calls.push('listTools');
            // Mutation COMMISE pendant la demande (simulation de course, sans threads).
            b2Store.setConnectorUrlRevokingPolicies(T_MAIN, raceId, URL_ALT);
            // Le distant (ancienne URL) répond ensuite.
            return { tools: [stubTool('outil_race', S_RACE, null)], nextCursor: null };
          },
          callTool: async () => {
            calls.push('callTool');
            throw new Error('callTool est INTERDIT en B2 (stub)');
          }
        } as unknown as RemoteMcpHttpClient;
      }
    });
    const refusée = await call(`/api/v1/mcp-remote/connectors/${raceId}/tools/outil_race/approve`, 'POST', H_OWNER, {});
    assert.equal(refusée.status, 409, 'TOCTOU gardé : refus sans écriture');
    assert.equal(errorBody(refusée).code, 'MCP_REMOTE_DRIFT');
    assert.equal(b2Store.listToolPolicies(T_MAIN, raceId).length, 0, 'AUCUNE politique créée pour un hash obsolète');
    assert.equal(b2Store.getConnector(T_MAIN, raceId)?.url, URL_ALT, 'le changement concurrent a bien été commis');
    assert.ok(!calls.includes('callTool'), 'aucun tools/call pendant la course');

    // Re-approbation (conflit disparu) : le hash vient de la ré-interrogation en cours.
    const stub = makeToolsStub();
    stub.setPages([{ tools: [stubTool('outil_race', S_RACE, null)], nextCursor: null }]);
    useStub(stub);
    const rebound = await call(`/api/v1/mcp-remote/connectors/${raceId}/tools/outil_race/approve`, 'POST', H_OWNER, {});
    assert.equal(rebound.status, 200);
    assert.equal(b2Store.getToolApproval(T_MAIN, raceId, 'outil_race', HASH_S_RACE)?.status, 'APPROVED');
    assert.ok(!stub.calls.includes('callTool'));
  });

  /* ---- B2-12 : pagination bornée & cap d'outils ---- */

  it('B2-12 pagination : 3 pages au plus lues ; 5 pages sans curseur terminal → 502 ; 201 outils → 502', async () => {
    const created = await call('/api/v1/mcp-remote/connectors', 'POST', H_OWNER, { name: 'b2 pages', url: URL_MAIN });
    assert.equal(created.status, 201);
    const cid = String((created.body as { connector: { connectorId: string } }).connector.connectorId);

    // 3 pages successives infinies au curseur terminal.
    let stub = makeToolsStub();
    stub.setPages([
      { tools: [stubTool('outil_p1a', S1, null), stubTool('outil_p1b', S1, null)], nextCursor: 'pg2' },
      { tools: [stubTool('outil_p2a', S1, null)], nextCursor: 'pg3' },
      { tools: [stubTool('outil_p3a', S1, null)], nextCursor: null }
    ]);
    useStub(stub);
    const ok = await call(`/api/v1/mcp-remote/connectors/${cid}/tools`, 'GET', H_OWNER);
    assert.equal(ok.status, 200);
    assert.equal((ok.body as { tools: unknown[] }).tools.length, 4, 'les trois pages sont parcourues');
    assert.deepEqual(stub.calls, ['listTools', 'listTools(cursor)', 'listTools(cursor)']);

    // Pagination interminable : 5 pages, chaque nextCursor='cont' → refus fail-closed.
    stub = makeToolsStub();
    stub.setPages(
      Array.from({ length: 5 }, () => ({ tools: [], nextCursor: 'cont' }))
    );
    useStub(stub);
    const endless = await call(`/api/v1/mcp-remote/connectors/${cid}/tools`, 'GET', H_OWNER);
    assert.equal(endless.status, 502);
    assert.equal(errorBody(endless).code, 'MCP_REMOTE_UNREACHABLE');
    assert.equal(stub.calls.length, 5, 'limite de pages respectée côté client de la route');

    // Cap d'outils : une seule page de 201 outils → refus.
    stub = makeToolsStub();
    stub.setPages([{
      nextCursor: null,
      tools: Array.from({ length: 201 }, (_, i) => stubTool(`outil_flood_${String(i).padStart(3, '0')}`, S1, null))
    }]);
    useStub(stub);
    const flood = await call(`/api/v1/mcp-remote/connectors/${cid}/tools`, 'GET', H_OWNER);
    assert.equal(flood.status, 502);
    assert.equal(errorBody(flood).code, 'MCP_REMOTE_UNREACHABLE');
    assert.ok(!flood.text.includes('outil_flood'), 'aucun contenu distant dans le message de refus');
  });

  /* ---- B2-13 : connecteur désactivé (D5) ---- */

  it('B2-13 connecteur désactivé : découverte & approbation OK, réactivation JAMAIS automatique', async () => {
    const created = await call('/api/v1/mcp-remote/connectors', 'POST', H_OWNER, { name: 'b2 off', url: URL_MAIN });
    assert.equal(created.status, 201);
    const cid = String((created.body as { connector: { connectorId: string } }).connector.connectorId);
    // Aucune activation : le connecteur est désactivé DÈS LA CRÉATION (fail-closed).

    const stub = makeToolsStub();
    stub.setPages([{ tools: [stubTool('outil_off', S1, null)], nextCursor: null }]);
    useStub(stub);
    const discovered = await call(`/api/v1/mcp-remote/connectors/${cid}/tools`, 'GET', H_OWNER);
    assert.equal(discovered.status, 200);
    assert.equal((discovered.body as { connector: { enabled: boolean } }).connector.enabled, false, 'découverte ne touche PAS à enabled') ;
    const approved = await call(`/api/v1/mcp-remote/connectors/${cid}/tools/outil_off/approve`, 'POST', H_OWNER, {});
    assert.equal(approved.status, 200);
    assert.ok(b2Store.getToolApproval(T_MAIN, cid, 'outil_off', HASH_S1));
    const final = await call(`/api/v1/mcp-remote/connectors/${cid}`, 'GET', H_OWNER);
    assert.equal((final.body as { connector: { enabled: boolean } }).connector.enabled, false, 'reste désactivé');
  });

  /* ---- B2-14 : schéma volumineux — affichage borné, hash SUR le schéma complet ---- */

  it('B2-14 schéma >8 KiB : affichage omis (flag), hash et approbation SUR le schéma COMPLET', async () => {
    const stub = makeToolsStub();
    stub.setPages([
      { tools: [stubTool('outil_alpha', S2, `Alpha ${CANARY_DESC}`), stubTool('outil_volumineux', S_BIG, null)], nextCursor: null }
    ]);
    useStub(stub);
    const out = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools`, 'GET', H_OWNER);
    assert.equal(out.status, 200);
    const payload = out.body as {
      tools: Array<{ toolName: string; inputSchema: unknown; schemaSha256: string | null; schemaStatus: string }>;
      displayTruncatedCount: number;
    };
    assert.equal(payload.displayTruncatedCount, 1);
    const big = payload.tools.find((t) => t.toolName === 'outil_volumineux');
    assert.ok(big);
    assert.equal(big.schemaStatus, 'DISPLAY_TRUNCATED');
    assert.equal(big.inputSchema, null, 'contenu trop volumineux : NON affiché');
    assert.equal(big.schemaSha256, HASH_S_BIG, 'mais le hash RESTE celui du schéma COMPLET');
    const small = payload.tools.find((t) => t.toolName === 'outil_alpha');
    assert.equal(small?.schemaStatus, 'OK');
    assert.deepEqual(small?.inputSchema, S2, 'petit schéma : affiché tel quel');

    // Approbation possible : le hash lié est celui du schéma complet.
    const approved = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/outil_volumineux/approve`, 'POST', H_OWNER, {});
    assert.equal(approved.status, 200);
    assert.equal(b2Store.getToolApproval(T_MAIN, cMain, 'outil_volumineux', HASH_S_BIG)?.status, 'APPROVED');
  });

  /* ---- B2-15 : méthodes/périples non couverts → 404 central ---- */

  it('B2-15 méthodes à tort : GET sur approve, DELETE sur revoke, PUT sur tools → 404', async () => {
    const getApprove = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/outil_alpha/approve`, 'GET', H_OWNER);
    assert.equal(getApprove.status, 404);
    const deleteRevoke = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools/outil_alpha/revoke`, 'DELETE', H_OWNER);
    assert.equal(deleteRevoke.status, 404);
    const putTools = await call(`/api/v1/mcp-remote/connectors/${cMain}/tools`, 'PUT', H_OWNER);
    assert.equal(putTools.status, 404);
  });

  /* ---- B2-16 : journal global sans contenu distant, sans secret ---- */

  it('B2-16 journal : NI description distante (CANARY), NI schéma, NI secret, NI corps navigateur', async () => {
    const journal = await call('/api/v1/mcp-remote/journal', 'GET', H_OWNER);
    assert.equal(journal.status, 200);
    assert.ok(!journal.text.includes(CANARY_DESC), 'jamais de description distante');
    assert.ok(!journal.text.includes(SCHEMA_MARKER), 'jamais de contenu de schéma');
    assert.ok(!journal.text.includes(SECRET_PLAINTEXT), 'jamais de secret');
    assert.ok(!journal.text.includes('FAUX-CORPS-NAVIGATEUR-B2'), 'jamais le corps du navigateur');
    assert.ok(!journal.text.includes('outil_flood'), 'jamais de noms distants du cap de découverte');
    // Actions whitelistées attendues pour B2 uniquement ici :
    const actions = new Set((journal.body as { events: Array<{ action: string }> }).events.map((e) => e.action));
    for (const action of ['MCP_REMOTE_TOOLS_DISCOVERED', 'MCP_REMOTE_TOOL_APPROVED', 'MCP_REMOTE_TOOL_REVOKED']) {
      assert.ok(actions.has(action), `${action} présent`);
    }
    // Revocation log sans schemaSha256 (seul le nom suffit).
    const revokedEvent = (journal.body as {
      events: Array<{ action: string; metadata: Record<string, unknown> | null }>;
    }).events.find((event) => event.action === 'MCP_REMOTE_TOOL_REVOKED' && event.metadata?.toolName === 'outil_alpha');
    assert.ok(revokedEvent);
    assert.deepEqual(revokedEvent.metadata, { toolName: 'outil_alpha' });
  });
});
