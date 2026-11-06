/**
 * C3.1 — Tests du stockage SQLite des connecteurs MCP distants :
 * - isolation tenant stricte (aucune lecture/écriture inter-tenant) ;
 * - secrets chiffres AES-256-GCM, jamais de plaintext en base ni dans les
 *   enregistrements renvoyes ;
 * - rotation de cles transactionnelle (commit complet ou rien) ;
 * - politiques d outils liees au hash du schema d outil ;
 * - suppression en cascade (connecteur -> politiques -> confirmations).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  RemoteMcpCryptoError,
  RemoteMcpSecretCipher,
  createRemoteMcpKeyRing,
  sha256Hex
} from '../../../src/mcp/remote/crypto.js';
import {
  RemoteMcpConnectorStore,
  RemoteMcpStoreError
} from '../../../src/mcp/remote/store.js';
import { RemoteMcpConfirmationStore } from '../../../src/mcp/remote/confirmation.js';
import { sqliteDatabasePath } from '../../../src/persistence/sqlite-backend.js';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'volaco-mcp-remote-store-'));
process.env.VOLACO_DATA_DIR = DATA_DIR;

const TENANT_A = 'tenant_a_impl01';
const TENANT_B = 'tenant_b_impl01';
const URL_A = 'https://api.example.com/mcp';
const URL_B = 'https://b.example.org/other';

const KEY_V1 = randomBytes(32);
const KEY_V2 = randomBytes(32);
const KEY_V3 = randomBytes(32);

let store: RemoteMcpConnectorStore;
let confirmations: RemoteMcpConfirmationStore;
let rawDb: DatabaseSync;

function expectStoreError(fn: () => unknown, code: string): void {
  assert.throws(
    fn,
    (error: unknown) => error instanceof RemoteMcpStoreError && error.code === code
  );
}

function rawRowOf(
  tenantId: string,
  connectorId: string
): { secret_key_id: string | null; secret_iv: string | null; secret_ciphertext: string | null } | undefined {
  return rawDb
    .prepare(
      'SELECT secret_key_id, secret_iv, secret_ciphertext FROM mcp_remote_connectors WHERE tenant_id = ? AND connector_id = ?'
    )
    .get(tenantId, connectorId) as
    | { secret_key_id: string | null; secret_iv: string | null; secret_ciphertext: string | null }
    | undefined;
}

function readSqliteBytes(): Buffer {
  const dbFile = sqliteDatabasePath();
  const parts: Buffer[] = [];
  if (existsSync(dbFile)) parts.push(readFileSync(dbFile));
  const walFile = `${dbFile}-wal`;
  if (existsSync(walFile)) parts.push(readFileSync(walFile));
  return Buffer.concat(parts);
}

describe('C3.1 : store connecteurs distants (SQLite dedie)', () => {
  before(() => {
    const cipherV1 = new RemoteMcpSecretCipher(
      createRemoteMcpKeyRing({ active: { keyId: 'v1', key: KEY_V1 } })
    );
    store = new RemoteMcpConnectorStore(cipherV1);
    confirmations = new RemoteMcpConfirmationStore();
    rawDb = new DatabaseSync(sqliteDatabasePath());
    rawDb.exec('PRAGMA busy_timeout = 5000');
  });

  after(() => {
    rawDb.close();
  });

  it('1. cree un connecteur initial coherant', () => {
    const connectorA = store.createConnector({ tenantId: TENANT_A, name: 'worker-a', url: URL_A });
    assert.equal(connectorA.tenantId, TENANT_A);
    assert.equal(connectorA.connectorId.length, 36);
    assert.equal(connectorA.transport, 'url');
    assert.equal(connectorA.enabled, false);
    assert.equal(connectorA.secretMeta, null);
    assert.deepEqual(connectorA.toolPolicies, []);
    assert.equal(connectorA.url, URL_A);
  });

  it('2. refuse les identifiants ou noms invalides', () => {
    expectStoreError(
      () => store.createConnector({ tenantId: '../etc/passwd', name: 'x', url: URL_A }),
      'INVALID_INPUT'
    );
    expectStoreError(
      () => store.createConnector({ tenantId: TENANT_A, name: '', url: URL_A }),
      'INVALID_INPUT'
    );
    expectStoreError(
      () => store.createConnector({ tenantId: TENANT_A, name: 'x'.repeat(65), url: URL_A }),
      'INVALID_INPUT'
    );
  });

  it('3. refuse les URLs hors politique (http, IP privee, loopback, credentials)', () => {
    expectStoreError(
      () => store.createConnector({ tenantId: TENANT_A, name: 'n1', url: 'http://api.example.com/mcp' }),
      'INVALID_INPUT'
    );
    expectStoreError(
      () => store.createConnector({ tenantId: TENANT_A, name: 'n2', url: 'https://10.1.2.3/mcp' }),
      'INVALID_INPUT'
    );
    expectStoreError(
      () => store.createConnector({ tenantId: TENANT_A, name: 'n3', url: 'https://[::1]:443/' }),
      'INVALID_INPUT'
    );
    expectStoreError(
      () => store.createConnector({ tenantId: TENANT_A, name: 'n4', url: 'https://user@api.example.com/' }),
      'INVALID_INPUT'
    );
  });

  it('4. isole strictement les tenants (lecture, secret, ecriture, suppression)', () => {
    const connectorA = store.listConnectors(TENANT_A)[0];
    assert.ok(connectorA !== undefined);
    assert.equal(store.getConnector(TENANT_B, connectorA.connectorId), null);
    assert.deepEqual(store.listConnectors(TENANT_B), []);
    assert.equal(store.revealConnectorSecret(TENANT_B, connectorA.connectorId), null);
    assert.equal(store.deleteConnector(TENANT_B, connectorA.connectorId), false);
    expectStoreError(
      () => store.setConnectorEnabled(TENANT_B, connectorA.connectorId, true),
      'NOT_FOUND'
    );
    expectStoreError(
      () => store.setConnectorUrl(TENANT_B, connectorA.connectorId, URL_B),
      'NOT_FOUND'
    );
    expectStoreError(
      () => store.setConnectorSecret(TENANT_B, connectorA.connectorId, 'x'),
      'NOT_FOUND'
    );
    expectStoreError(
      () =>
        store.approveTool({
          tenantId: TENANT_B,
          connectorId: connectorA.connectorId,
          toolName: 'search',
          schemaSha256: sha256Hex('schema'),
          approvedBy: 'u1'
        }),
      'NOT_FOUND'
    );
    assert.equal(store.getConnector(TENANT_A, connectorA.connectorId)?.tenantId, TENANT_A);
    assert.equal(store.getConnector('tenant_inconnu', connectorA.connectorId), null);
  });

  it('5. chiffre les secrets: jamais de plaintext en base ni dans les records', () => {
    const connectorSecret = store.createConnector({ tenantId: TENANT_A, name: 'secret-c1', url: URL_A });
    const plaintext = `plaintext-sans-sens-${randomUUID()}`;
    store.setConnectorSecret(TENANT_A, connectorSecret.connectorId, plaintext);
    const meta1 = store.getConnector(TENANT_A, connectorSecret.connectorId)?.secretMeta;
    assert.equal(meta1?.keyId, 'v1');
    assert.equal(store.revealConnectorSecret(TENANT_A, connectorSecret.connectorId), plaintext);

    const row1 = rawRowOf(TENANT_A, connectorSecret.connectorId);
    assert.ok(row1 !== undefined);
    // reecriture: IV et ciphertext changent a chaque fois
    store.setConnectorSecret(TENANT_A, connectorSecret.connectorId, plaintext);
    const row2 = rawRowOf(TENANT_A, connectorSecret.connectorId);
    assert.ok(row2 !== undefined);
    assert.notEqual(row1.secret_iv, row2.secret_iv);
    assert.notEqual(row1.secret_ciphertext, row2.secret_ciphertext);

    const bytes = readSqliteBytes();
    assert.ok(bytes.length > 0);
    assert.equal(bytes.includes(Buffer.from(plaintext, 'utf8')), false);
    assert.equal(JSON.stringify(store.listConnectors(TENANT_A)).includes(plaintext), false);
  });

  it('6. rotation de cles: commit complet vers v2, aucun secret en v1 restant', () => {
    const cipherV2 = new RemoteMcpSecretCipher(
      createRemoteMcpKeyRing({
        active: { keyId: 'v2', key: KEY_V2 },
        previous: { keyId: 'v1', key: KEY_V1 }
      })
    );
    const rotateA = store.createConnector({ tenantId: TENANT_A, name: 'rot-a', url: URL_A });
    const rotateB = store.createConnector({ tenantId: TENANT_B, name: 'rot-b', url: URL_B });
    store.setConnectorSecret(TENANT_A, rotateA.connectorId, 'plain-A');
    store.setConnectorSecret(TENANT_B, rotateB.connectorId, 'plain-B');

    store.rotateSecretKeys(cipherV2);
    assert.equal(store.activeCipher().activeKeyId, 'v2');
    assert.equal(store.revealConnectorSecret(TENANT_A, rotateA.connectorId), 'plain-A');
    assert.equal(store.revealConnectorSecret(TENANT_B, rotateB.connectorId), 'plain-B');

    const ids = rawDb
      .prepare('SELECT DISTINCT secret_key_id FROM mcp_remote_connectors WHERE secret_key_id IS NOT NULL')
      .all() as Array<{ secret_key_id: string }>;
    assert.equal(ids.length, 1);
    assert.equal(ids[0]?.secret_key_id, 'v2');

    // un store attache a lancien keyring (v1 seul) ne peut plus dechiffrer
    const legacyCipher = new RemoteMcpSecretCipher(
      createRemoteMcpKeyRing({ active: { keyId: 'v1', key: KEY_V1 } })
    );
    const legacyStore = new RemoteMcpConnectorStore(legacyCipher);
    assert.throws(
      () => legacyStore.revealConnectorSecret(TENANT_A, rotateA.connectorId),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'UNKNOWN_KEY_ID'
    );
  });

  it('7. rotation corrompue: transaction rollback, rien ne bouge', () => {
    const cipherV3 = new RemoteMcpSecretCipher(
      createRemoteMcpKeyRing({
        active: { keyId: 'v3', key: KEY_V3 },
        previous: { keyId: 'v2', key: KEY_V2 }
      })
    );
    const good = store.createConnector({ tenantId: TENANT_A, name: 'rot-good', url: URL_A });
    const bad = store.createConnector({ tenantId: TENANT_A, name: 'rot-bad', url: URL_A });
    store.setConnectorSecret(TENANT_A, good.connectorId, 'valeur-saine');
    store.setConnectorSecret(TENANT_A, bad.connectorId, 'valeur-corrompue');
    rawDb
      .prepare(
        'UPDATE mcp_remote_connectors SET secret_ciphertext = ? WHERE tenant_id = ? AND connector_id = ?'
      )
      .run('!!!corrompu!!!', TENANT_A, bad.connectorId);

    assert.throws(
      () => store.rotateSecretKeys(cipherV3),
      (error: unknown) => error instanceof RemoteMcpCryptoError
    );
    // bonne ligne: toujours en v2 et dechiffrable
    const goodRow = rawRowOf(TENANT_A, good.connectorId);
    assert.equal(goodRow?.secret_key_id, 'v2');
    assert.equal(store.revealConnectorSecret(TENANT_A, good.connectorId), 'valeur-saine');
    // ligne corrompue: toujours corrompue, rotation abandonnee
    const badRow = rawRowOf(TENANT_A, bad.connectorId);
    assert.equal(badRow?.secret_key_id, 'v2');
    assert.equal(badRow?.secret_ciphertext, '!!!corrompu!!!');
    assert.equal(store.activeCipher().activeKeyId, 'v2');
  });

  it('8. politiques d outils: hash de schema obligatoire, nouvelle approbation apres changement', () => {
    const policyConn = store.createConnector({ tenantId: TENANT_A, name: 'policy-c1', url: URL_A });
    const schemaA = sha256Hex('schema-a');
    const schemaB = sha256Hex('schema-b');

    const approved = store.approveTool({
      tenantId: TENANT_A,
      connectorId: policyConn.connectorId,
      toolName: 'rechercher',
      schemaSha256: schemaA,
      approvedBy: 'utilisateur-1'
    });
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.schemaSha256, schemaA);
    assert.equal(
      store.getToolApproval(TENANT_A, policyConn.connectorId, 'rechercher', schemaA)?.toolName,
      'rechercher'
    );
    // hash different: aucune approbation active
    assert.equal(store.getToolApproval(TENANT_A, policyConn.connectorId, 'rechercher', schemaB), null);

    // re-approbation explicite apres changement de schema
    store.approveTool({
      tenantId: TENANT_A,
      connectorId: policyConn.connectorId,
      toolName: 'rechercher',
      schemaSha256: schemaB,
      approvedBy: 'utilisateur-1'
    });
    assert.equal(store.getToolApproval(TENANT_A, policyConn.connectorId, 'rechercher', schemaA), null);
    assert.equal(
      store.getToolApproval(TENANT_A, policyConn.connectorId, 'rechercher', schemaB)?.schemaSha256,
      schemaB
    );

    // revocation
    assert.equal(store.revokeTool(TENANT_A, policyConn.connectorId, 'rechercher'), true);
    assert.equal(store.getToolApproval(TENANT_A, policyConn.connectorId, 'rechercher', schemaB), null);
    const policies = store.listToolPolicies(TENANT_A, policyConn.connectorId);
    assert.equal(policies.length, 1);
    assert.equal(policies[0]?.status, 'REVOKED');
    assert.equal(
      store.getConnector(TENANT_A, policyConn.connectorId)?.toolPolicies.length,
      1
    );
    // aucun politque visible depuis un autre tenant
    assert.equal(store.listToolPolicies(TENANT_B, policyConn.connectorId).length, 0);
    assert.equal(
      store.getToolApproval(TENANT_B, policyConn.connectorId, 'rechercher', schemaB),
      null
    );

    // validation stricte
    expectStoreError(
      () =>
        store.approveTool({
          tenantId: TENANT_A,
          connectorId: policyConn.connectorId,
          toolName: 'a b',
          schemaSha256: schemaA,
          approvedBy: 'u1'
        }),
      'INVALID_INPUT'
    );
    expectStoreError(
      () =>
        store.approveTool({
          tenantId: TENANT_A,
          connectorId: policyConn.connectorId,
          toolName: 'ok',
          schemaSha256: schemaA.toUpperCase(),
          approvedBy: 'u1'
        }),
      'INVALID_INPUT'
    );
    expectStoreError(
      () =>
        store.approveTool({
          tenantId: TENANT_A,
          connectorId: 'inconnu',
          toolName: 'ok',
          schemaSha256: schemaA,
          approvedBy: 'u1'
        }),
      'NOT_FOUND'
    );
  });

  it('9. cycle de vie secret + URL + activation', () => {
    const life = store.createConnector({ tenantId: TENANT_B, name: 'life-c1', url: URL_B });
    assert.equal(store.revealConnectorSecret(TENANT_B, life.connectorId), null);
    store.setConnectorSecret(TENANT_B, life.connectorId, 'secret-bleu');
    assert.equal(store.removeConnectorSecret(TENANT_B, life.connectorId), true);
    assert.equal(store.getConnector(TENANT_B, life.connectorId)?.secretMeta, null);
    assert.equal(store.removeConnectorSecret(TENANT_B, life.connectorId), false);

    const updated = store.setConnectorUrl(TENANT_B, life.connectorId, 'https://upd.example.com/v2');
    assert.equal(updated.url, 'https://upd.example.com/v2');
    expectStoreError(
      () => store.setConnectorUrl(TENANT_B, life.connectorId, 'http://upd.example.com/'),
      'INVALID_INPUT'
    );
    expectStoreError(
      () => store.setConnectorUrl(TENANT_B, 'inconnu', 'https://upd.example.com/'),
      'NOT_FOUND'
    );
    assert.equal(store.setConnectorEnabled(TENANT_B, life.connectorId, true).enabled, true);
    assert.equal(store.setConnectorEnabled(TENANT_B, life.connectorId, false).enabled, false);
  });

  it('10. suppression en cascade (politiques + confirmations)', () => {
    const doomed = store.createConnector({ tenantId: TENANT_A, name: 'delete-c1', url: URL_A });
    store.approveTool({
      tenantId: TENANT_A,
      connectorId: doomed.connectorId,
      toolName: 'delete_tool',
      schemaSha256: sha256Hex('schema-delete'),
      approvedBy: 'utilisateur-1'
    });
    confirmations.issue({
      tenantId: TENANT_A,
      userId: 'utilisateur-1',
      connectorId: doomed.connectorId,
      toolName: 'delete_tool',
      schemaSha256: sha256Hex('schema-delete'),
      argsSha256: sha256Hex('{"args":{}}'),
      ttlMs: 60000
    });

    assert.equal(store.deleteConnector(TENANT_A, doomed.connectorId), true);
    assert.equal(store.getConnector(TENANT_A, doomed.connectorId), null);

    const remainingPolicies = rawDb
      .prepare(
        'SELECT COUNT(*) AS n FROM mcp_remote_tool_policies WHERE tenant_id = ? AND connector_id = ?'
      )
      .get(TENANT_A, doomed.connectorId) as { n: number | bigint };
    assert.equal(Number(remainingPolicies.n), 0);
    const remainingConfirmations = rawDb
      .prepare(
        'SELECT COUNT(*) AS n FROM mcp_remote_confirmations WHERE tenant_id = ? AND connector_id = ?'
      )
      .get(TENANT_A, doomed.connectorId) as { n: number | bigint };
    assert.equal(Number(remainingConfirmations.n), 0);
    assert.equal(store.deleteConnector(TENANT_A, doomed.connectorId), false);
  });
});
