/**
 * C3.1 — Tests des confirmations a usage unique (anti-rejeu) :
 * - liaison tenant/utilisateur/connecteur/outil/schema/arguments requise ;
 * - consommation UNIQUE atomique (rejeu refuse) ;
 * - expiration par horloge injectable (test deterministe) ;
 * - TTL plafonne ; isolation tenant stricte.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  RemoteMcpSecretCipher,
  createRemoteMcpKeyRing,
  sha256Hex
} from '../../../src/mcp/remote/crypto.js';
import {
  RemoteMcpConnectorStore,
  RemoteMcpStoreError
} from '../../../src/mcp/remote/store.js';
import {
  REMOTE_MCP_CONFIRMATION_MAX_TTL_MS,
  RemoteMcpConfirmationStore
} from '../../../src/mcp/remote/confirmation.js';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'volaco-mcp-remote-confirm-'));
process.env.VOLACO_DATA_DIR = DATA_DIR;

const TENANT_A = 'tenant_a_conf01';
const TENANT_B = 'tenant_b_conf01';
const USER_1 = 'utilisateur-1';
const USER_2 = 'utilisateur-2';
const TOOL = 'rechercher';
const SCHEMA = sha256Hex('schema-rechercher-v1');
const ARGS = sha256Hex('{"query":"hello"}');

let store: RemoteMcpConnectorStore;
let confirmations: RemoteMcpConfirmationStore;
let clockMs = 1_700_000_000_000;

function expectStoreError(fn: () => unknown, code: string): void {
  assert.throws(
    fn,
    (error: unknown) => error instanceof RemoteMcpStoreError && error.code === code
  );
}

describe('C3.1 : confirmations anti-rejeu', () => {
  before(() => {
    const cipher = new RemoteMcpSecretCipher(
      createRemoteMcpKeyRing({ active: { keyId: 'v1', key: randomBytes(32) } })
    );
    store = new RemoteMcpConnectorStore(cipher);
    confirmations = new RemoteMcpConfirmationStore(() => clockMs);
    store.createConnector({ tenantId: TENANT_A, name: 'conf-c1', url: 'https://api.example.com/mcp' });
  });

  after(() => {
    // aucune suppression: la base SQLite reste ouverte par le singleton du
    // processus, rmSync provoquerait EPERM sous Windows
    void DATA_DIR;
  });

  it('1. emet une confirmation liee a tous les champs', () => {
    const connectorId = store.listConnectors(TENANT_A)[0]?.connectorId ?? '';
    const issued = confirmations.issue({
      tenantId: TENANT_A,
      userId: USER_1,
      connectorId,
      toolName: TOOL,
      schemaSha256: SCHEMA,
      argsSha256: ARGS,
      ttlMs: 60_000
    });
    assert.equal(issued.tenantId, TENANT_A);
    assert.equal(issued.userId, USER_1);
    assert.equal(issued.toolName, TOOL);
    assert.equal(issued.schemaSha256, SCHEMA);
    assert.equal(issued.argsSha256, ARGS);
    assert.equal(issued.expiresAt, clockMs + 60_000);
    assert.equal(issued.consumedAt, null);
  });

  it('2. consomme exactement une fois puis rejette le rejeu', () => {
    const connectorId = store.listConnectors(TENANT_A)[0]?.connectorId ?? '';
    const issued = confirmations.issue({
      tenantId: TENANT_A,
      userId: USER_1,
      connectorId,
      toolName: TOOL,
      schemaSha256: SCHEMA,
      argsSha256: ARGS,
      ttlMs: 60_000
    });
    clockMs += 1_000;
    const first = confirmations.consume({
      tenantId: TENANT_A,
      userId: USER_1,
      confirmationId: issued.confirmationId,
      connectorId,
      toolName: TOOL,
      schemaSha256: SCHEMA,
      argsSha256: ARGS
    });
    assert.equal(first.consumed, true);
    if (first.consumed) assert.equal(first.record.consumedAt, clockMs);
    clockMs += 1_000;
    const second = confirmations.consume({
      tenantId: TENANT_A,
      userId: USER_1,
      confirmationId: issued.confirmationId,
      connectorId,
      toolName: TOOL,
      schemaSha256: SCHEMA,
      argsSha256: ARGS
    });
    assert.deepEqual(second, { consumed: false, reason: 'REPLAY' });
  });

  it('3. refuse toute modification de liaison (BINDING_MISMATCH)', () => {
    const connectorId = store.listConnectors(TENANT_A)[0]?.connectorId ?? '';
    const issued = confirmations.issue({
      tenantId: TENANT_A,
      userId: USER_1,
      connectorId,
      toolName: TOOL,
      schemaSha256: SCHEMA,
      argsSha256: ARGS,
      ttlMs: 60_000
    });
    const base = {
      tenantId: TENANT_A,
      userId: USER_1,
      confirmationId: issued.confirmationId,
      connectorId,
      toolName: TOOL,
      schemaSha256: SCHEMA,
      argsSha256: ARGS
    };
    const results = [
      confirmations.consume({ ...base, userId: USER_2 }),
      confirmations.consume({ ...base, toolName: 'autre_outil' }),
      confirmations.consume({ ...base, schemaSha256: sha256Hex('schema-modifie') }),
      confirmations.consume({ ...base, argsSha256: sha256Hex('{"query":"autre"}') })
    ];
    for (const result of results) assert.deepEqual(result, { consumed: false, reason: 'BINDING_MISMATCH' });
  });

  it('4. expire selon une horloge injectable', () => {
    const connectorId = store.listConnectors(TENANT_A)[0]?.connectorId ?? '';
    const issued = confirmations.issue({
      tenantId: TENANT_A,
      userId: USER_1,
      connectorId,
      toolName: TOOL,
      schemaSha256: SCHEMA,
      argsSha256: ARGS,
      ttlMs: 500
    });
    clockMs += 700;
    const result = confirmations.consume({
      tenantId: TENANT_A,
      userId: USER_1,
      confirmationId: issued.confirmationId,
      connectorId,
      toolName: TOOL,
      schemaSha256: SCHEMA,
      argsSha256: ARGS
    });
    assert.deepEqual(result, { consumed: false, reason: 'EXPIRED' });
  });

  it('5. plafonne le TTL et refuse les champs invalides', () => {
    const connectorId = store.listConnectors(TENANT_A)[0]?.connectorId ?? '';
    assert.equal(REMOTE_MCP_CONFIRMATION_MAX_TTL_MS, 900_000);
    confirmations.issue({
      tenantId: TENANT_A,
      userId: USER_1,
      connectorId,
      toolName: TOOL,
      schemaSha256: SCHEMA,
      argsSha256: ARGS,
      ttlMs: REMOTE_MCP_CONFIRMATION_MAX_TTL_MS
    });
    expectStoreError(
      () =>
        confirmations.issue({
          tenantId: TENANT_A,
          userId: USER_1,
          connectorId,
          toolName: TOOL,
          schemaSha256: SCHEMA,
          argsSha256: ARGS,
          ttlMs: REMOTE_MCP_CONFIRMATION_MAX_TTL_MS + 1
        }),
      'INVALID_INPUT'
    );
    expectStoreError(
      () =>
        confirmations.issue({
          tenantId: TENANT_A,
          userId: USER_1,
          connectorId,
          toolName: TOOL,
          schemaSha256: 'PAS_UN_HASH',
          argsSha256: ARGS,
          ttlMs: 60_000
        }),
      'INVALID_INPUT'
    );
    expectStoreError(
      () =>
        confirmations.issue({
          tenantId: TENANT_A,
          userId: USER_1,
          connectorId: 'connecteur-inexistant',
          toolName: TOOL,
          schemaSha256: SCHEMA,
          argsSha256: ARGS,
          ttlMs: 60_000
        }),
      'NOT_FOUND'
    );
  });

  it('6. isole strictement les tenants', () => {
    const connectorId = store.listConnectors(TENANT_A)[0]?.connectorId ?? '';
    const issued = confirmations.issue({
      tenantId: TENANT_A,
      userId: USER_1,
      connectorId,
      toolName: TOOL,
      schemaSha256: SCHEMA,
      argsSha256: ARGS,
      ttlMs: 60_000
    });
    const fromOtherTenant = confirmations.consume({
      tenantId: TENANT_B,
      userId: USER_1,
      confirmationId: issued.confirmationId,
      connectorId,
      toolName: TOOL,
      schemaSha256: SCHEMA,
      argsSha256: ARGS
    });
    assert.deepEqual(fromOtherTenant, { consumed: false, reason: 'NOT_FOUND' });
    // jamais expiree par un autre tenant: la confirmation A reste consommable
    const stillValid = confirmations.consume({
      tenantId: TENANT_A,
      userId: USER_1,
      confirmationId: issued.confirmationId,
      connectorId,
      toolName: TOOL,
      schemaSha256: SCHEMA,
      argsSha256: ARGS
    });
    assert.equal(stillValid.consumed, true);
  });

  it('7. deux consommations en concurrence: exactement une reussit', async () => {
    const connectorId = store.listConnectors(TENANT_A)[0]?.connectorId ?? '';
    const issued = confirmations.issue({
      tenantId: TENANT_A,
      userId: USER_1,
      connectorId,
      toolName: TOOL,
      schemaSha256: SCHEMA,
      argsSha256: ARGS,
      ttlMs: 60_000
    });
    clockMs += 1_000;
    const attempt = () =>
      Promise.resolve(
        confirmations.consume({
          tenantId: TENANT_A,
          userId: USER_1,
          confirmationId: issued.confirmationId,
          connectorId,
          toolName: TOOL,
          schemaSha256: SCHEMA,
          argsSha256: ARGS
        })
      );
    const [a, b] = await Promise.all([attempt(), attempt()]);
    const successes = [a, b].filter((r) => r.consumed).length;
    assert.equal(successes, 1);
    const losers = [a, b].filter((r) => !r.consumed);
    for (const loser of losers) assert.deepEqual(loser, { consumed: false, reason: 'REPLAY' });
  });
});
