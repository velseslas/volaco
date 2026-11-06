/**
 * C3.2-B3 — Test store : INVALIDATION des confirmations au changement d'URL
 * (condition d'audit A-01 / GO §3).
 *
 * INVARIANT TESTÉ : `setConnectorUrlRevokingPolicies` invalide les
 * confirmations ANTI-REJEU du connecteur DANS LA MÊME transaction que le
 * changement d'URL et la révocation des politiques :
 *   - les confirmations en cours d'un connecteur voient leur `consumed_at`
 *     posé (marquées consommées, ligne conservée pour l'inspection) ;
 *   - toute consommation ultérieure échoue avec REPLAY (fail-closed) — une
 *     confirmation préparée sur l'ancienne URL ne peut JAMAIS exécuter un
 *     outil sur la nouvelle ;
 *   - le compteur `invalidatedConfirmations` est exact (0 quand rien à
 *     invalider, N quand N lignes en cours) ;
 *   - l'isolation inter-tenant est préservée (les confirmations d'un AUTRE
 *     connecteur/tenant restent consommables) ;
 *   - une URL refusée (échec AVANT transaction) ne touche RIEN.
 *
 * Harnais identique à store-b1 (SQLite temporaire, VOLACO_DATA_DIR dédié).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { RemoteMcpSecretCipher, createRemoteMcpKeyRing } from '../../../src/mcp/remote/crypto.js';
import { RemoteMcpConnectorStore, RemoteMcpStoreError } from '../../../src/mcp/remote/store.js';
import { RemoteMcpConfirmationStore } from '../../../src/mcp/remote/confirmation.js';
import type { RemoteMcpConfirmationRecord } from '../../../src/mcp/remote/types.js';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'volaco-mcp-remote-b3-store-'));
process.env.VOLACO_DATA_DIR = DATA_DIR;

const TENANT_A = 'tenant_b3_store';
const TENANT_B = 'tenant_b3_autre';
const URL_1 = 'https://mcp-one.b3.invalid/api';
const URL_2 = 'https://mcp-two.b3.invalid/api';

const cipher = new RemoteMcpSecretCipher(
  createRemoteMcpKeyRing({ active: { keyId: 'b3', key: randomBytes(32) } })
);
const store = new RemoteMcpConnectorStore(cipher);
const confirmations = new RemoteMcpConfirmationStore();

const SCHEMA = 'a'.repeat(64);
const ARGS_A = 'b'.repeat(64);
const ARGS_B = 'c'.repeat(64);

let connectorA = '';
let connectorB = '';

function issueFor(
  tenantId: string,
  connectorId: string,
  argsSha256: string,
  userId = 'usr_store_b3'
): RemoteMcpConfirmationRecord {
  return confirmations.issue({
    tenantId,
    userId,
    connectorId,
    toolName: 'outil_alpha',
    schemaSha256: SCHEMA,
    argsSha256,
    ttlMs: 60_000
  });
}

function consume(record: RemoteMcpConfirmationRecord) {
  return confirmations.consume({
    tenantId: record.tenantId,
    userId: record.userId,
    confirmationId: record.confirmationId,
    connectorId: record.connectorId,
    toolName: record.toolName,
    schemaSha256: record.schemaSha256,
    argsSha256: record.argsSha256
  });
}

describe('C3.2-B3 store : invalidation des confirmations au changement d URL (D3 + GO §3)', () => {
  before(() => {
    connectorA = store.createConnector({ tenantId: TENANT_A, name: 'duplex-a', url: URL_1 }).connectorId;
    connectorB = store.createConnector({ tenantId: TENANT_B, name: 'duplex-b', url: URL_1 }).connectorId;
  });

  it('1. un connecteur DU tenant : confirmations invalidées DANS la transaction, autres tenants intacts', () => {
    const confA1 = issueFor(TENANT_A, connectorA, ARGS_A);
    const confA2 = issueFor(TENANT_A, connectorA, ARGS_B);
    const confB = issueFor(TENANT_B, connectorB, ARGS_A);

    const outcome = store.setConnectorUrlRevokingPolicies(TENANT_A, connectorA, URL_2);
    assert.equal(outcome.record.url, URL_2);
    assert.deepEqual([...outcome.revokedToolNames], []);
    assert.equal(outcome.invalidatedConfirmations, 2, 'les 2 confirmations en cours du connecteur A');

    // Les confirmations du connecteur A sont hospitalisées : REPLAY garanti.
    assert.deepEqual(consume(confA1), { consumed: false, reason: 'REPLAY' });
    assert.deepEqual(consume(confA2), { consumed: false, reason: 'REPLAY' });

    // Isolation : la confirmation du connecteur B (autre tenant) reste CONSOMMABLE.
    const aliveB = consume(confB);
    assert.ok(aliveB.consumed, 'la confirmation du tenant B ne doit PAS être touchée');
    if (aliveB.consumed) {
      assert.equal(aliveB.record.confirmationId, confB.confirmationId);
      assert.ok(aliveB.record.consumedAt !== null);
    } else {
      assert.fail('confirmation du tenant B refusée à tort');
    }
  });

  it('2. second changement d URL : compteur à 0 (rien à invalider), AUCUNE récursion', () => {
    const outcome = store.setConnectorUrlRevokingPolicies(TENANT_A, connectorA, URL_1);
    assert.equal(outcome.record.url, URL_1);
    assert.equal(outcome.invalidatedConfirmations, 0, 'les confirmations sont déjà marquées consommées');
  });

  it('3. URL refusée (échec AVANT transaction) : confirmations INTACTES, rollback total', () => {
    const confA = issueFor(TENANT_A, connectorA, ARGS_A);
    assert.throws(
      () => store.setConnectorUrlRevokingPolicies(TENANT_A, connectorA, 'http://127.0.0.1:8080/mcp'),
      (error: unknown) => error instanceof RemoteMcpStoreError && error.code === 'INVALID_INPUT'
    );
    const alive = consume(confA);
    assert.ok(alive.consumed, 'aucune invalidation ne doit avoir eu lieu');
    if (alive.consumed) {
      assert.equal(alive.record.confirmationId, confA.confirmationId);
    } else {
      assert.fail('confirmation refusée à tort après rollback d URL refusée');
    }
  });

  it('4. chemin nominal inchangé : issue puis consume réussi sur connecteur sans PATCH', () => {
    const confA = issueFor(TENANT_A, connectorA, ARGS_B);
    const consumed = consume(confA);
    assert.ok(consumed.consumed, 'exécution nominale (sans PATCH intermédiaire) doit réussir');
    if (consumed.consumed) {
      assert.equal(consumed.record.confirmationId, confA.confirmationId);
      assert.ok(consumed.record.consumedAt !== null);
    } else {
      assert.fail('unreachable : narrowing ci-dessus');
    }
    // Empreintes liées : une consume avec d'autres args échoue sans consommer.
    const other = issueFor(TENANT_A, connectorA, ARGS_A);
    const mismatch = confirmations.consume({
      tenantId: other.tenantId,
      userId: other.userId,
      confirmationId: other.confirmationId,
      connectorId: other.connectorId,
      toolName: other.toolName,
      schemaSha256: other.schemaSha256,
      argsSha256: ARGS_B
    });
    assert.deepEqual(mismatch, { consumed: false, reason: 'BINDING_MISMATCH' });
  });

  after(() => {
    try {
      rmSync(DATA_DIR, { recursive: true, force: true });
    } catch {
      // Windows : SQLite encore ouvert — répertoire temporaire OS.
    }
  });
});
