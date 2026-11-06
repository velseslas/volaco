/**
 * LOT S4 — CHIFFREMENT AT-REST DES CLÉS PROVIDER/AGENT (audit sécurité, 04/11).
 *
 * Aucune clé n'est jamais écrite en clair : les fichiers ai-provider-keys.json
 * et ai-agent-keys.json portent des enveloppes AES-256-GCM (keyring dédié).
 * Sans keyring valide, l'écriture échoue explicitement (fail-closed).
 */

import './_agent-keys-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApiServer } from '../src/server.js';
import { resetStoredProviderKeys } from '../../../packages/core/src/ai/providers/provider-catalog.js';
import { resetAgentCredentialKeys, agentCredentialHints } from '../../../packages/core/src/ai/providers/agent-keys.js';

const EMAIL = `keys-enc-${Date.now().toString(36)}@volaco.test`;
const FAKE_KEY = 'sk-provider-secret-volaco-abcd9999';

describe('S4 : clés provider/agent chiffrées at-rest', () => {
  let server: Server;
  let baseUrl: string;
  let token = '';

  before(async () => {
    resetStoredProviderKeys();
    resetAgentCredentialKeys();
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: 'mot-de-passe-long', name: 'Enc Test' })
    });
    assert.equal(res.status, 201);
    token = ((await res.json()) as { token: string }).token;
    assert.ok(token.length > 10);
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      const dir = process.env.VOLACO_DATA_DIR as string;
      if (dir) rmSync(join(dir, 'ai-provider-keys.json'), { force: true });
      if (dir) rmSync(join(dir, 'ai-agent-keys.json'), { force: true });
    } catch {
      // best-effort
    }
  });

  it('POST provider key -> 200, fichier chiffré (jamais la clé en clair)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/providers/mistral/key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ apiKey: FAKE_KEY })
    });
    assert.equal(res.status, 200);
    const raw = await res.text();
    assert.ok(!raw.includes(FAKE_KEY), 'la clé ne fuit pas dans la réponse');
    const dir = process.env.VOLACO_DATA_DIR as string;
    const file = join(dir, 'ai-provider-keys.json');
    assert.ok(existsSync(file), 'le fichier de clés existe');
    const content = readFileSync(file, 'utf8');
    assert.ok(!content.includes(FAKE_KEY), 'la clé n’est jamais écrite en clair');
    assert.ok(content.includes('ciphertext') && content.includes('iv') && content.includes('authTag'), 'enveloppe AES-GCM présente');
    assert.ok(content.includes('keyId'), 'keyId non secret présent');
  });

  it('GET providers expose seulement le hint masqué, jamais la clé', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/providers`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    const raw = await res.text();
    assert.ok(!raw.includes(FAKE_KEY));
    const data = JSON.parse(raw) as { providers: Array<{ providerId: string; keyHint: string | null; keyStored: boolean }> };
    const mistral = data.providers.find((p) => p.providerId === 'mistral');
    assert.ok(mistral && mistral.keyStored);
    assert.equal(mistral.keyHint, '••••9999');
  });

  it('POST agent key -> 200, fichier chiffré', async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/agent-keys/agent-ui-specialist/slot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ slot: 'primary', providerId: 'mistral', apiKey: FAKE_KEY })
    });
    assert.equal(res.status, 200);
    const raw = await res.text();
    assert.ok(!raw.includes(FAKE_KEY));
    const dir = process.env.VOLACO_DATA_DIR as string;
    const file = join(dir, 'ai-agent-keys.json');
    assert.ok(existsSync(file));
    const content = readFileSync(file, 'utf8');
    assert.ok(!content.includes(FAKE_KEY), 'la clé agent n’est jamais écrite en clair');
    assert.ok(content.includes('apiKeyEnc'), 'enveloppe chiffrée présente');
    const hint = agentCredentialHints('agent-ui-specialist');
    assert.ok(hint.primary && hint.primary.hint === '••••9999');
  });
});
