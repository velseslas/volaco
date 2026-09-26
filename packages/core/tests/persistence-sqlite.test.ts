/**
 * Tests ÉTAPE 3 — persistance SQLite (node:sqlite) derrière json-disk-cache
 *
 * Points vérifiés :
 * 1. roundtrip SQLite (le fichier .json hérité ne doit PAS être créé) ;
 * 2. migration transparente d'un fichier JSON hérité ;
 * 3. sessions de conversation durables à travers deux instances du service ;
 * 4. audit persistant à travers deux instances du store.
 *
 * Ce fichier utilise un VOLACO_DATA_DIR isolé (répertoire temporaire unique)
 * afin de ne jamais toucher la vraie base du serveur.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// L'env doit être posé AVANT les imports (les singletons se construisent à l'import)
process.env.VOLACO_DATA_DIR = mkdtempSync(join(tmpdir(), 'volaco-persist-'));

const { dataFilePath, readJsonFile, writeJsonFileSync } = await import('../src/persistence/json-disk-cache.js');
const { isSqliteAvailable } = await import('../src/persistence/sqlite-backend.js');
const { ConversationIntelligenceService } = await import('../src/ai-native/conversation-intelligence/service.js');
const { AuditStore } = await import('../src/observability/audit.js');
const { AiUsageTracker } = await import('../src/ai/usage.js');

describe('ÉTAPE 3 : persistance SQLite', () => {
  it('1. roundtrip via SQLite : écriture/lecture, sans fichier .json hérité créé', () => {
    assert.equal(isSqliteAvailable(), true, 'node:sqlite doit être disponible');
    const path = dataFilePath('persistence-test-doc1');
    writeJsonFileSync(path, { hello: 'sqlite', n: 42 });
    const back = readJsonFile<{ hello: string; n: number }>(path, null as unknown as { hello: string; n: number });
    assert.deepEqual(back, { hello: 'sqlite', n: 42 });
    assert.ok(!existsSync(path), 'Aucun fichier JSON ne doit être créé en mode SQLite');
    assert.ok(existsSync(join(process.env.VOLACO_DATA_DIR!, 'volaco.db')), 'La base volaco.db doit exister');
  });

  it('2. migration transparente d\'un fichier JSON hérité', () => {
    const path = dataFilePath('persistence-test-doc2');
    writeFileSync(path, JSON.stringify({ legacy: true }), 'utf8');
    const back = readJsonFile<{ legacy: boolean }>(path, null as unknown as { legacy: boolean });
    assert.deepEqual(back, { legacy: true }, 'Le contenu hérité doit être importé et servi');
  });

  it('3. sessions de conversation durables à travers deux instances du service', async () => {
    const service1 = new ConversationIntelligenceService();
    const session = service1.createSession({ tenantId: 'ten-persist', projectId: 'proj-persist-1' }, 'OWNER', 'req-p1');

    // Nouvelle instance (simule un redémarrage du serveur)
    const service2 = new ConversationIntelligenceService();
    const reloaded = service2.getSession('ten-persist', 'proj-persist-1', session.sessionId, 'OWNER', 'req-p2');
    assert.ok(reloaded, 'La session doit survivre à une nouvelle instance (redémarrage)');
    assert.equal(reloaded!.sessionId, session.sessionId);
  });

  it('4. audit et usage IA persistants à travers deux instances', () => {
    // persist: true = comportement du singleton de production
    const audit1 = new AuditStore({ persist: true });
    const event = audit1.record({
      tenantId: 'ten-persist',
      userId: 'test',
      action: 'PERSIST_TEST',
      resourceType: 'TEST',
      resourceId: 'r1',
      status: 'SUCCESS',
      requestId: 'req-p3'
    });

    const audit2 = new AuditStore({ persist: true });
    const found = audit2.query('ten-persist', { action: 'PERSIST_TEST' });
    assert.ok(found.some((e) => e.id === event.id), 'L\'événement d\'audit doit survivre à une nouvelle instance');

    const usage1 = new AiUsageTracker();
    usage1.recordUsage('ten-persist', 'proj-persist-1', 'codestral-latest', 100, 50, 'req-p4');
    const usage2 = new AiUsageTracker();
    const summary = usage2.getUsageSummary('ten-persist', 'proj-persist-1');
    assert.ok(summary.recordCount >= 1, 'L\'usage IA doit survivre à une nouvelle instance');
    assert.ok(summary.totalTokens >= 150);
  });
});
