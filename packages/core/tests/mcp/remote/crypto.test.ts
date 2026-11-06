/**
 * C3.1 — Tests du chiffrement AES-256-GCM des secrets de connecteurs MCP.
 * Aucune clé par défaut, AAD lié au couple (tenant, connecteur), rotation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  createRemoteMcpKeyRing,
  loadRemoteMcpKeyringFromEnv,
  RemoteMcpCryptoError,
  RemoteMcpSecretCipher,
  sha256Hex
} from '../../../src/mcp/remote/crypto.js';
import type { RemoteMcpKeyRingEntry } from '../../../src/mcp/remote/crypto.js';

function freshEntry(keyId: string): RemoteMcpKeyRingEntry {
  return { keyId, key: randomBytes(32) };
}

describe('C3.1 : crypto — clé AES-256-GCM + keyring', () => {
  it('crée un keyring valable (active + précédente, ids et clés distincts)', () => {
    const active = freshEntry('v1');
    const previous = freshEntry('v0');
    const ring = createRemoteMcpKeyRing({ active, previous });
    assert.equal(ring.active.keyId, 'v1');
    assert.equal(ring.previous?.keyId, 'v0');
  });

  it('refuse les entrées de keyring invalides (id, taille, zéros, doublons)', () => {
    assert.throws(
      () => createRemoteMcpKeyRing({ active: { keyId: 'id invalide', key: randomBytes(32) } }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'INVALID_KEY'
    );
    assert.throws(
      () => createRemoteMcpKeyRing({ active: { keyId: 'v1', key: randomBytes(31) } }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'INVALID_KEY'
    );
    const zeroKey = Buffer.alloc(32);
    assert.throws(
      () => createRemoteMcpKeyRing({ active: { keyId: 'v1', key: zeroKey } }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'INVALID_KEY'
    );
  });

  it('refuse un keyring doublonné (id identique ou clé identique)', () => {
    const active = freshEntry('v1');
    assert.throws(
      () => createRemoteMcpKeyRing({ active, previous: { keyId: 'v1', key: randomBytes(32) } }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'KEY_ID_REUSE'
    );
    assert.throws(
      () =>
        createRemoteMcpKeyRing({
          active,
          previous: { keyId: 'v0', key: Buffer.from(active.key) }
        }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'KEY_ID_REUSE'
    );
  });
});

describe('C3.1 : crypto — AES-256-GCM avec AAD tenant/connecteur', () => {
  const cipher = new RemoteMcpSecretCipher(createRemoteMcpKeyRing({ active: freshEntry('v1') }));

  it('chiffre puis déchiffre dans le même contexte', () => {
    const envelope = cipher.encrypt({ tenantId: 'tenant_a', connectorId: 'conn_1' }, 'mot-de-passe-remote');
    assert.equal(envelope.keyId, 'v1');
    assert.equal(cipher.decrypt(envelope, { tenantId: 'tenant_a', connectorId: 'conn_1' }), 'mot-de-passe-remote');
  });

  it('refuse un ciphertext réutilisé sur un autre couple (AAD)', () => {
    const envelope = cipher.encrypt({ tenantId: 'tenant_a', connectorId: 'conn_1' }, 'valeur');
    assert.throws(
      () => cipher.decrypt(envelope, { tenantId: 'tenant_b', connectorId: 'conn_1' }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'DECRYPT_FAILED'
    );
    assert.throws(
      () => cipher.decrypt(envelope, { tenantId: 'tenant_a', connectorId: 'conn_2' }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'DECRYPT_FAILED'
    );
  });

  it('keyring séparé: keyId inconnu', () => {
    const envelope = cipher.encrypt({ tenantId: 'tenant_a', connectorId: 'conn_1' }, 'valeur');
    const other = new RemoteMcpSecretCipher(createRemoteMcpKeyRing({ active: freshEntry('v9') }));
    assert.throws(
      () => other.decrypt(envelope, { tenantId: 'tenant_a', connectorId: 'conn_1' }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'UNKNOWN_KEY_ID'
    );
  });

  it('données corrompues refusées par GCM', () => {
    const envelope = cipher.encrypt({ tenantId: 'tenant_a', connectorId: 'conn_1' }, 'valeur');
    const flipLastByte = (value: string): string => {
      const bytes = Buffer.from(value, 'base64');
      const last = bytes.length - 1;
      const previous = bytes.readUInt8(last);
      bytes.writeUInt8(previous ^ 0x01, last);
      return bytes.toString('base64');
    };
    const brokenCipher = { ...envelope, ciphertext: flipLastByte(envelope.ciphertext) };
    assert.throws(
      () => cipher.decrypt(brokenCipher, { tenantId: 'tenant_a', connectorId: 'conn_1' }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'DECRYPT_FAILED'
    );
    const brokenTag = { ...envelope, authTag: flipLastByte(envelope.authTag) };
    assert.throws(
      () => cipher.decrypt(brokenTag, { tenantId: 'tenant_a', connectorId: 'conn_1' }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'DECRYPT_FAILED'
    );
  });

  it('IV trop courte refusée au déchiffrement', () => {
    const envelope = cipher.encrypt({ tenantId: 'tenant_a', connectorId: 'conn_1' }, 'valeur');
    assert.throws(
      () => cipher.decrypt({ ...envelope, iv: Buffer.from([1, 2, 3]).toString('base64') }, { tenantId: 'tenant_a', connectorId: 'conn_1' }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'INVALID_KEY'
    );
  });

  it('deux chiffrements produisent des IV et ciphertexts distincts', () => {
    const a = cipher.encrypt({ tenantId: 'tenant_a', connectorId: 'conn_1' }, 'appel-identique');
    const b = cipher.encrypt({ tenantId: 'tenant_a', connectorId: 'conn_1' }, 'appel-identique');
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ciphertext, b.ciphertext);
  });
});

describe('C3.1 : crypto — keyring depuis environnement (rotation + AUTH_SECRET)', () => {
  it('charge active + précédente', () => {
    const key = freshEntry('v2').key;
    const prevKey = freshEntry('v1').key;
    const ring = loadRemoteMcpKeyringFromEnv({
      VOLACO_MCP_REMOTE_KEY_ID: 'v2',
      VOLACO_MCP_REMOTE_KEY: key.toString('base64'),
      VOLACO_MCP_REMOTE_PREVIOUS_KEY_ID: 'v1',
      VOLACO_MCP_REMOTE_PREVIOUS_KEY: prevKey.toString('base64')
    });
    assert.equal(ring.active.keyId, 'v2');
    assert.equal(ring.previous?.keyId, 'v1');
  });

  it('refuse si KEY_ID ou KEY absente (aucune clé par défaut)', () => {
    assert.throws(
      () => loadRemoteMcpKeyringFromEnv({}),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'INVALID_KEY' &&
        /VOLACO_MCP_REMOTE_KEY_ID/.test(error.message)
    );
    assert.throws(
      () => loadRemoteMcpKeyringFromEnv({ VOLACO_MCP_REMOTE_KEY_ID: 'v1' }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'INVALID_KEY' &&
        /VOLACO_MCP_REMOTE_KEY/.test(error.message) &&
        !/PREVIOUS/.test(error.message)
    );
  });

  it('refuse base64 invalide ou clé trop courte', () => {
    assert.throws(
      () =>
        loadRemoteMcpKeyringFromEnv({
          VOLACO_MCP_REMOTE_KEY_ID: 'v1',
          VOLACO_MCP_REMOTE_KEY: 'pas-du-base64!!'
        }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'INVALID_KEY'
    );
    assert.throws(
      () =>
        loadRemoteMcpKeyringFromEnv({
          VOLACO_MCP_REMOTE_KEY_ID: 'v1',
          VOLACO_MCP_REMOTE_KEY: randomBytes(16).toString('base64')
        }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'INVALID_KEY'
    );
  });

  it('refuse la réutilisation de AUTH_SECRET (valeur brute ou octets)', () => {
    const key = freshEntry('v1').key;
    const sameBase64 = key.toString('base64');
    assert.throws(
      () =>
        loadRemoteMcpKeyringFromEnv({
          AUTH_SECRET: sameBase64,
          VOLACO_MCP_REMOTE_KEY_ID: 'v1',
          VOLACO_MCP_REMOTE_KEY: sameBase64
        }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'AUTH_SECRET_REUSE'
    );
    // AUTH_SECRET distinct (pas du base64 de la clé) mais dont les octets utf8
    // correspondent exactement aux 32 octets de la clé: interdit aussi.
    const ascii32 = 'abcdefgh23456789abcdefgh23456789';
    const asciiKey = Buffer.from(ascii32, 'utf8');
    assert.throws(
      () =>
        loadRemoteMcpKeyringFromEnv({
          AUTH_SECRET: ascii32,
          VOLACO_MCP_REMOTE_KEY_ID: 'v1',
          VOLACO_MCP_REMOTE_KEY: asciiKey.toString('base64')
        }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'AUTH_SECRET_REUSE'
    );
  });

  it('AUTH_SECRET différent non invalide: le keyring se charge quand même', () => {
    const key = freshEntry('v1').key;
    const other = randomBytes(32).toString('base64');
    const ring = loadRemoteMcpKeyringFromEnv({
      AUTH_SECRET: other,
      VOLACO_MCP_REMOTE_KEY_ID: 'v1',
      VOLACO_MCP_REMOTE_KEY: key.toString('base64')
    });
    assert.equal(ring.active.keyId, 'v1');
  });

  it('refuse des entrées actives/précédentes identiques', () => {
    const key = freshEntry('v1').key;
    const same = key.toString('base64');
    assert.throws(
      () =>
        loadRemoteMcpKeyringFromEnv({
          VOLACO_MCP_REMOTE_KEY_ID: 'v1',
          VOLACO_MCP_REMOTE_KEY: same,
          VOLACO_MCP_REMOTE_PREVIOUS_KEY_ID: 'v1',
          VOLACO_MCP_REMOTE_PREVIOUS_KEY: same
        }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'KEY_ID_REUSE'
    );
    assert.throws(
      () =>
        loadRemoteMcpKeyringFromEnv({
          VOLACO_MCP_REMOTE_KEY_ID: 'v1',
          VOLACO_MCP_REMOTE_KEY: same,
          VOLACO_MCP_REMOTE_PREVIOUS_KEY_ID: 'v2',
          VOLACO_MCP_REMOTE_PREVIOUS_KEY: same
        }),
      (error: unknown) =>
        error instanceof RemoteMcpCryptoError && error.code === 'KEY_ID_REUSE'
    );
  });
});

describe('C3.1 : crypto — empreintes SHA-256', () => {
  it('produit un digest hexadécimal minuscule stable de 64 caractères', () => {
    const digest = sha256Hex('schema-doutil-v1');
    assert.equal(digest, createHash('sha256').update('schema-doutil-v1', 'utf8').digest('hex'));
    assert.equal(digest, digest.toLowerCase());
    assert.equal(digest.length, 64);
  });
});
