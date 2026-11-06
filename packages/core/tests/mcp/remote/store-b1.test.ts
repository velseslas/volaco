/**
 * C3.2-B1 — Tests des additions au store des connecteurs MCP distants :
 *   - setConnectorName (renommage atomique) ;
 *   - setConnectorUrlRevokingPolicies (décision D3 : changement d'URL +
 *     révocation de TOUTES les approbations dans UNE transaction).
 * Fichiers C3.1 existants NON modifiés ; harnais identique (SQLite temporaire).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { RemoteMcpSecretCipher, createRemoteMcpKeyRing } from '../../../src/mcp/remote/crypto.js';
import { RemoteMcpConnectorStore, RemoteMcpStoreError } from '../../../src/mcp/remote/store.js';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'volaco-mcp-remote-b1-store-'));
process.env.VOLACO_DATA_DIR = DATA_DIR;

const TENANT = 'tenant_b1_store';
const OTHER_TENANT = 'tenant_b1_autre';
const URL_1 = 'https://mcp-one.b1.invalid/api';
const URL_2 = 'https://mcp-two.b1.invalid/api';
const SCHEMA_A = 'a'.repeat(64);
const SCHEMA_B = 'b'.repeat(64);

const cipher = new RemoteMcpSecretCipher(
  createRemoteMcpKeyRing({ active: { keyId: 'b1', key: randomBytes(32) } })
);
const store = new RemoteMcpConnectorStore(cipher);

describe('C3.2-B1 store : setConnectorName', () => {
  let connectorId: string;

  before(() => {
    const record = store.createConnector({ tenantId: TENANT, name: 'ancien', url: URL_1 });
    connectorId = record.connectorId;
  });

  it('1. renommage : nom mis à jour, les autres champs inchangés', () => {
    const record = store.setConnectorName(TENANT, connectorId, '  nouveau nom  ');
    assert.equal(record.name, 'nouveau nom');
    assert.equal(record.url, URL_1);
    assert.equal(record.enabled, false);
  });

  it('2. nom invalide → INVALID_INPUT, sans modification', () => {
    assert.throws(
      () => store.setConnectorName(TENANT, connectorId, ''),
      (error: unknown) => error instanceof RemoteMcpStoreError && error.code === 'INVALID_INPUT'
    );
    assert.throws(
      () => store.setConnectorName(TENANT, connectorId, 'x'.repeat(65)),
      (error: unknown) => error instanceof RemoteMcpStoreError && error.code === 'INVALID_INPUT'
    );
    const record = store.getConnector(TENANT, connectorId);
    assert.ok(record);
    assert.equal(record.name, 'nouveau nom');
  });

  it('3. connecteur inconnu / autre tenant → NOT_FOUND', () => {
    assert.throws(
      () => store.setConnectorName(TENANT, 'id-inexistant-' + 'x'.repeat(20), 'nom'),
      (error: unknown) => error instanceof RemoteMcpStoreError && error.code === 'NOT_FOUND'
    );
    // Isolation : le même id vu depuis un autre tenant est introuvable.
    assert.throws(
      () => store.setConnectorName(OTHER_TENANT, connectorId, 'nom'),
      (error: unknown) => error instanceof RemoteMcpStoreError && error.code === 'NOT_FOUND'
    );
  });
});

describe('C3.2-B1 store : setConnectorUrlRevokingPolicies (D3)', () => {
  let connectorId: string;

  before(() => {
    const record = store.createConnector({ tenantId: TENANT, name: 'duplex', url: URL_1 });
    connectorId = record.connectorId;
    store.setConnectorSecret(TENANT, connectorId, 'tok_b1_' + randomBytes(8).toString('hex'));
    // Deux approbations distinctes (les lots B2 exposent ce flux ; ici, direct store).
    store.approveTool({
      tenantId: TENANT,
      connectorId,
      toolName: 'outil_deuxieme',
      schemaSha256: SCHEMA_A,
      approvedBy: 'test'
    });
    store.approveTool({
      tenantId: TENANT,
      connectorId,
      toolName: 'outil_premier',
      schemaSha256: SCHEMA_B,
      approvedBy: 'test'
    });
  });

  it('4. changement d URL valide : TOUTES les approbations révoquées dans un seul mouvement', () => {
    const outcome = store.setConnectorUrlRevokingPolicies(TENANT, connectorId, URL_2);
    assert.equal(outcome.record.url, URL_2);
    assert.deepEqual([...outcome.revokedToolNames], ['outil_deuxieme', 'outil_premier']);
    const after = store.getConnector(TENANT, connectorId);
    assert.ok(after);
    assert.equal(after.url, URL_2);
    for (const policy of after.toolPolicies) {
      assert.equal(policy.status, 'REVOKED');
    }
    // getToolApproval ne matche plus : le schéma exact d'avant est refusé.
    assert.equal(store.getToolApproval(TENANT, connectorId, 'outil_premier', SCHEMA_B), null);
    assert.equal(store.getToolApproval(TENANT, connectorId, 'outil_deuxieme', SCHEMA_A), null);
  });

  it('5. URL invalide → INVALID_INPUT et AUCUN changement (URL et politiques intactes)', () => {
    assert.throws(
      () => store.setConnectorUrlRevokingPolicies(TENANT, connectorId, 'http://127.0.0.1:8080/mcp'),
      (error: unknown) => error instanceof RemoteMcpStoreError && error.code === 'INVALID_INPUT'
    );
    const record = store.getConnector(TENANT, connectorId);
    assert.ok(record);
    assert.equal(record.url, URL_2, 'aucune réécriture partielle sur refus URL');
    const approved = record.toolPolicies.filter((policy) => policy.status === 'APPROVED');
    assert.equal(approved.length, 0, 'étape 4 a révoqué : état cohérent, inchangé');
  });

  it('6. ré-approbation sur la nouvelle URL puis nouvel échange d URL : cohérence transactionnelle', () => {
    store.approveTool({
      tenantId: TENANT,
      connectorId,
      toolName: 'outil_premier',
      schemaSha256: SCHEMA_B,
      approvedBy: 'test'
    });
    const outcome = store.setConnectorUrlRevokingPolicies(TENANT, connectorId, URL_1);
    assert.deepEqual([...outcome.revokedToolNames], ['outil_premier']);
    assert.equal(outcome.record.url, URL_1);
    assert.equal(store.getToolApproval(TENANT, connectorId, 'outil_premier', SCHEMA_B), null);
  });

  it('7. URL identique acceptée (informatif) : politiques révoquées quand même (D3 stricte)', () => {
    store.approveTool({
      tenantId: TENANT,
      connectorId,
      toolName: 'outil_troisieme',
      schemaSha256: SCHEMA_A,
      approvedBy: 'test'
    });
    const outcome = store.setConnectorUrlRevokingPolicies(TENANT, connectorId, URL_1);
    assert.deepEqual([...outcome.revokedToolNames], ['outil_troisieme']);
  });
});

after(() => {
  try {
    rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {
    // Windows : le fichier SQLite reste ouvert tant que node:sqlite est vivant
    // (répertoire temporaire système purgé par l'OS) — aucun échec de test.
  }
});
