/**
 * MCP-C3.1-CONFIG-STORE — Épreuve de conformité du store des configurations de
 * serveurs MCP appartenant à un tenant (lot C3.1), tel qu'existant dans le dépôt :
 * `src/mcp/remote/store.ts` (aucun second store ; voir rapport de mission).
 *
 * Chaque configuration = connecteur tenant persisté en SQLite dédiée
 * (`mcp_remote_connectors`), isolation stricte par couple (tenant_id, connector_id),
 * permissions d'outils refusées par défaut (aucune règle = refus), delta C3.1 :
 * persistance NON secrète du résultat du dernier test (`last_test_*`).
 *
 * Modes d'exécution (variable d'environnement C31_PERSIST_MODE) :
 *  - 'standard' (défaut) : checklist complète in-process, répertoire de données
 *                          neuf créé sous os.tmpdir() (jamais dans le dépôt) ;
 *  - 'create'            : création de fixtures dans C31_PERSIST_DIR + manifeste ;
 *  - 'verify'            : re-vérification de ces fixtures dans un AUTRE
 *                          processus (other process) → preuve de persistance réelle sur disque ;
 *  - 'migrate'           : simule une base préexistante au schéma d'ORIGINE
 *                          (sans les colonnes last_test_*), initialisation du
 *                          schéma delta, contrôle de non-perte de données.
 *
 * Aucun réseau : URLs conformes à la politique du store (https publics), fetch
 * jamais invoqué. Aucune clé réelle : keyring de test aléatoire jetable. Aucune
 * donnée de développement touchée. Le point « repli JSON » est volontairement
 * non testé : ce repli n'existe PAS (STORAGE_UNAVAILABLE fail-closed, choix
 * documenté du store C3.1) — voir rapport de livraison.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { RemoteMcpConnectorStore, RemoteMcpStoreError } from '../src/mcp/remote/store.js';
import type { RemoteMcpStoreErrorCode } from '../src/mcp/remote/store.js';
import type { RemoteMcpLastTestStatus } from '../src/mcp/remote/types.js';
import { RemoteMcpSecretCipher, createRemoteMcpKeyRing } from '../src/mcp/remote/crypto.js';
import { REMOTE_MCP_URL_MAX_LENGTH } from '../src/mcp/remote/url-policy.js';
import { sqliteDatabasePath } from '../src/persistence/sqlite-backend.js';

const MODE = (process.env.C31_PERSIST_MODE ?? 'standard').trim();
const PERSIST_DIR = (process.env.C31_PERSIST_DIR ?? '').trim();

const TENANT_A = 'c31_tenant_a';
const TENANT_B = 'c31_tenant_b';
const URL_A = 'https://a.example-c31.org/mcp';
const URL_B = 'https://b.example-c31.org/other';
const MANIFEST_NAME = 'c31-manifest.json';
const LAST_TEST_DETAIL = 'probe inter-processus: echec reseau controle (detail borne)';

function makeCipher(): RemoteMcpSecretCipher {
  return new RemoteMcpSecretCipher(
    createRemoteMcpKeyRing({ active: { keyId: 'c31-probe', key: randomBytes(32) } })
  );
}

function expectStoreError(fn: () => unknown, code: RemoteMcpStoreErrorCode): void {
  assert.throws(
    fn,
    (error: unknown) => error instanceof RemoteMcpStoreError && error.code === code
  );
}

interface C31Manifest {
  aId: string;
  bId: string;
  cId: string;
  dId: string;
  listsA: number;
  listsD: number;
}

if (MODE !== 'standard' && MODE !== 'create' && MODE !== 'verify' && MODE !== 'migrate') {
  throw new Error(`Mode C31_PERSIST_MODE inconnu : ${MODE}`);
}

if (MODE === 'standard') {
  const DATA_DIR = mkdtempSync(join(tmpdir(), 'volaco-c31-standard-'));
  process.env.VOLACO_DATA_DIR = DATA_DIR;

  let store!: RemoteMcpConnectorStore;
  let idA = '';
  let idB = '';
  let idC = '';

  describe('C3.1 conformité du store de configurations MCP tenant (in-process)', () => {
    before(() => {
      store = new RemoteMcpConnectorStore(makeCipher());
    });

    it('1. crée et relit une configuration tenant avec défauts strictement restreints', () => {
      const rec = store.createConnector({ tenantId: TENANT_A, name: 'config-a', url: URL_A });
      idA = rec.connectorId;
      assert.equal(rec.tenantId, TENANT_A);
      assert.equal(rec.connectorId.length, 36);
      assert.equal(rec.name, 'config-a');
      assert.equal(rec.url, URL_A);
      assert.equal(rec.transport, 'url'); // transport unique vivant (MCP sur URL HTTP(S))
      assert.equal(rec.enabled, false); // AUCUNE activation implicite
      assert.equal(rec.secretMeta, null); // modèle C3.1 sans champ secret
      assert.deepEqual(rec.toolPolicies, []); // AUCUN outil autorisé implicitement
      assert.ok(Number.isFinite(Date.parse(rec.createdAt)));
      assert.ok(Number.isFinite(Date.parse(rec.updatedAt)));
      const reread = store.getConnector(TENANT_A, idA);
      assert.ok(reread !== null);
      assert.deepEqual(reread, rec);
    });

    it('2. persiste après recréation de l instance du store', () => {
      const store2 = new RemoteMcpConnectorStore(makeCipher());
      const reread = store2.getConnector(TENANT_A, idA);
      assert.ok(reread !== null);
      assert.equal(reread.connectorId, idA);
      assert.equal(reread.name, 'config-a');
      assert.equal(
        store2.listConnectors(TENANT_A).some((one) => one.connectorId === idA),
        true
      );
    });

    it('3. persiste enabled=false après recréation du store (true puis false explicites)', () => {
      assert.equal(store.setConnectorEnabled(TENANT_A, idA, true).enabled, true);
      assert.equal(store.setConnectorEnabled(TENANT_A, idA, false).enabled, false);
      const store3 = new RemoteMcpConnectorStore(makeCipher());
      const afterRecreation = store3.getConnector(TENANT_A, idA);
      assert.ok(afterRecreation !== null);
      assert.equal(afterRecreation.enabled, false);
    });

    it('4. limite la liste au tenant demandé', () => {
      const recB = store.createConnector({ tenantId: TENANT_B, name: 'config-b', url: URL_B });
      idB = recB.connectorId;
      const listA = store.listConnectors(TENANT_A);
      assert.ok(listA.length >= 1);
      assert.ok(listA.every((one) => one.tenantId === TENANT_A));
      assert.ok(listA.some((one) => one.connectorId === idA));
      assert.ok(!listA.some((one) => one.connectorId === idB));
      const listB = store.listConnectors(TENANT_B);
      assert.ok(listB.some((one) => one.connectorId === idB));
      assert.ok(!listB.some((one) => one.connectorId === idA));
    });

    it('5. refuse la lecture inter-tenant (indétectable)', () => {
      assert.equal(store.getConnector(TENANT_B, idA), null);
      assert.equal(store.getConnector(TENANT_A, idB), null);
      assert.equal(store.getLastTest(TENANT_B, idA), null);
    });

    it('6. refuse les mises à jour inter-tenant sans mutation', () => {
      const before = store.getConnector(TENANT_A, idA);
      assert.ok(before !== null);
      const beforeName = before.name;
      const beforeUpdatedAt = before.updatedAt;
      expectStoreError(() => store.setConnectorEnabled(TENANT_B, idA, true), 'NOT_FOUND');
      expectStoreError(() => store.setConnectorName(TENANT_B, idA, 'hijack'), 'NOT_FOUND');
      expectStoreError(
        () => store.setConnectorUrlRevokingPolicies(TENANT_B, idA, URL_B),
        'NOT_FOUND'
      );
      const after = store.getConnector(TENANT_A, idA);
      assert.ok(after !== null);
      assert.equal(after.name, beforeName);
      assert.equal(after.enabled, false);
      assert.equal(after.updatedAt, beforeUpdatedAt);
    });

    it('7. refuse la suppression inter-tenant', () => {
      assert.equal(store.deleteConnector(TENANT_B, idA), false);
      assert.ok(store.getConnector(TENANT_A, idA) !== null);
      assert.equal(store.getLastTest(TENANT_B, idA), null);
    });

    it('8. supprime par le bon tenant (et refuse la suppression double)', () => {
      assert.equal(store.deleteConnector(TENANT_A, idA), true);
      assert.equal(store.getConnector(TENANT_A, idA), null);
      assert.equal(store.deleteConnector(TENANT_A, idA), false);
    });

    it('9. rejette un identifiant ou un tenant vide / non conforme', () => {
      expectStoreError(
        () => store.createConnector({ tenantId: '', name: 'x', url: URL_A }),
        'INVALID_INPUT'
      );
      expectStoreError(
        () => store.createConnector({ tenantId: '../etc/passwd', name: 'x', url: URL_A }),
        'INVALID_INPUT'
      );
      expectStoreError(() => store.getConnector(TENANT_A, ''), 'INVALID_INPUT');
      expectStoreError(() => store.deleteConnector(TENANT_A, ''), 'INVALID_INPUT');
      expectStoreError(() => store.getLastTest('', 'x'), 'INVALID_INPUT');
      expectStoreError(
        () => store.recordLastTest(TENANT_A, '', { status: 'OK' }),
        'INVALID_INPUT'
      );
    });

    it('10. n autorise qu un seul transport (les serveurs intégrés restent gérés par KNOWN_MCP_SERVERS)', () => {
      assert.equal(
        store.listConnectors(TENANT_B).every((one) => one.transport === 'url'),
        true
      );
      // Aucune surface d'API de création ne reçoit de champ de transport : le
      // modèle impose une valeur unique. Les serveurs stdio intégrés de la
      // plateforme (`project`, `browser`) ne vivent PAS dans ce store.
    });

    it('11. rejette les URLs invalides ou avec identifiants intégrés', () => {
      expectStoreError(
        () => store.createConnector({ tenantId: TENANT_B, name: 'n1', url: 'http://a.example-c31.org/mcp' }),
        'INVALID_INPUT'
      );
      expectStoreError(
        () => store.createConnector({ tenantId: TENANT_B, name: 'n2', url: 'https://user:secret@a.example-c31.org/mcp' }),
        'INVALID_INPUT'
      );
      expectStoreError(
        () => store.createConnector({ tenantId: TENANT_B, name: 'n3', url: 'https://[::1]:443/mcp' }),
        'INVALID_INPUT'
      );
      expectStoreError(
        () => store.createConnector({ tenantId: TENANT_B, name: 'n4', url: 'https://127.0.0.1/mcp' }),
        'INVALID_INPUT'
      );
      expectStoreError(
        () => store.createConnector({ tenantId: TENANT_B, name: 'n5', url: 'not-a-url' }),
        'INVALID_INPUT'
      );
      expectStoreError(
        () => store.createConnector({ tenantId: TENANT_B, name: 'n6', url: `https://${'x'.repeat(4096)}.example-c31.org/mcp` }),
        'INVALID_INPUT'
      );
      expectStoreError(
        () => store.createConnector({ tenantId: TENANT_B, name: 'n7', url: `https://a.example-c31.org/${'y'.repeat(4096)}` }),
        'INVALID_INPUT'
      );
      // https public non contrôré : accepté (URL C3.1 valide)
      const okRec = store.createConnector({ tenantId: TENANT_B, name: 'n8', url: URL_B });
      assert.equal(okRec.url, URL_B);
    });

    it('12. refuse tout outil par défaut ; l approbation explicite reste la seule voie', () => {
      const recC = store.createConnector({ tenantId: TENANT_A, name: 'config-c', url: URL_A });
      idC = recC.connectorId;
      assert.deepEqual(recC.toolPolicies, []);
      const sha = randomBytes(32).toString('hex');
      const policy = store.approveTool({
        tenantId: TENANT_A,
        connectorId: idC,
        toolName: 'search_web',
        schemaSha256: sha,
        approvedBy: 'c31-test'
      });
      assert.equal(policy.status, 'APPROVED');
      assert.equal(policy.toolName, 'search_web');
      assert.equal(policy.schemaSha256, sha);
      const reread = store.getConnector(TENANT_A, idC);
      assert.ok(reread !== null);
      assert.equal(reread.toolPolicies.length, 1);
      assert.equal(reread.toolPolicies[0]?.toolName, 'search_web');
    });

    it('13. rejette les permissions mal formées (outil / hash de schéma / tenant)', () => {
      const sha = randomBytes(32).toString('hex');
      expectStoreError(
        () =>
          store.approveTool({
            tenantId: TENANT_A,
            connectorId: idC,
            toolName: 'bad name!',
            schemaSha256: sha,
            approvedBy: 'c31-test'
          }),
        'INVALID_INPUT'
      );
      expectStoreError(
        () =>
          store.approveTool({
            tenantId: TENANT_A,
            connectorId: idC,
            toolName: '',
            schemaSha256: sha,
            approvedBy: 'c31-test'
          }),
        'INVALID_INPUT'
      );
      expectStoreError(
        () =>
          store.approveTool({
            tenantId: TENANT_A,
            connectorId: idC,
            toolName: 'search_web',
            schemaSha256: 'deadbeef',
            approvedBy: 'c31-test'
          }),
        'INVALID_INPUT'
      );
      expectStoreError(
        () =>
          store.approveTool({
            tenantId: TENANT_A,
            connectorId: idC,
            toolName: 'search_web',
            schemaSha256: 'A'.repeat(64), // hash non minuscule refusé
            approvedBy: 'c31-test'
          }),
        'INVALID_INPUT'
      );
      expectStoreError(
        () =>
          store.approveTool({
            tenantId: TENANT_B,
            connectorId: idC,
            toolName: 'search_web',
            schemaSha256: sha,
            approvedBy: 'c31-test'
          }),
        'NOT_FOUND'
      );
    });

    it('14. (delta C3.1) persiste le dernier test : cycle de vie, borne du détail, isolation', () => {
      assert.equal(store.getLastTest(TENANT_A, idC), null);
      const ok = store.recordLastTest(TENANT_A, idC, { status: 'OK' });
      assert.equal(ok.status, 'OK');
      assert.ok(Number.isFinite(Date.parse(ok.at)));
      assert.equal(ok.detail, null);
      assert.ok(store.getLastTest(TENANT_A, idC) !== null);
      const failure = store.recordLastTest(TENANT_A, idC, {
        status: 'FAILED',
        detail: `échec réseau contrôlé\n\t${'x'.repeat(600)}`
      });
      assert.equal(failure.status, 'FAILED');
      assert.ok(failure.detail !== null);
      assert.ok(!/[\u0000-\u001f\u007f]/.test(failure.detail));
      assert.ok(failure.detail.length > 0 && failure.detail.length <= 512);
      const stored = store.getLastTest(TENANT_A, idC);
      assert.ok(stored !== null);
      assert.equal(stored.status, 'FAILED');
      assert.equal(stored.detail, failure.detail);
      const weird = 'WEIRD' as unknown as RemoteMcpLastTestStatus;
      expectStoreError(
        () => store.recordLastTest(TENANT_A, idC, { status: weird }),
        'INVALID_INPUT'
      );
      expectStoreError(() => store.recordLastTest(TENANT_B, idC, { status: 'OK' }), 'NOT_FOUND');
      assert.equal(store.getLastTest(TENANT_B, idC), null);
    });
  });
} else if (MODE === 'create') {
  if (PERSIST_DIR.length === 0) {
    throw new Error('C31_PERSIST_DIR requis pour le mode create');
  }
  mkdirSync(PERSIST_DIR, { recursive: true });
  process.env.VOLACO_DATA_DIR = PERSIST_DIR;

  describe('C3.1 inter-processus : création des fixtures', () => {
    let store!: RemoteMcpConnectorStore;
    before(() => {
      store = new RemoteMcpConnectorStore(makeCipher());
    });

    it('crée des fixtures couvrant enabled true/false et un dernier test', () => {
      const a = store.createConnector({ tenantId: TENANT_A, name: 'config-a', url: URL_A }); // false par défaut
      const b = store.createConnector({ tenantId: TENANT_A, name: 'config-b', url: URL_A });
      assert.equal(store.setConnectorEnabled(TENANT_A, b.connectorId, true).enabled, true);
      const c = store.createConnector({ tenantId: TENANT_A, name: 'config-c', url: URL_A });
      assert.equal(store.setConnectorEnabled(TENANT_A, c.connectorId, true).enabled, true);
      assert.equal(store.setConnectorEnabled(TENANT_A, c.connectorId, false).enabled, false);
      store.recordLastTest(TENANT_A, a.connectorId, {
        status: 'FAILED',
        detail: LAST_TEST_DETAIL
      });
      const d = store.createConnector({ tenantId: TENANT_B, name: 'config-d', url: URL_B });
      const manifest: C31Manifest = {
        aId: a.connectorId,
        bId: b.connectorId,
        cId: c.connectorId,
        dId: d.connectorId,
        listsA: 3,
        listsD: 1
      };
      writeFileSync(join(PERSIST_DIR, MANIFEST_NAME), JSON.stringify(manifest, null, 2), 'utf8');
      assert.equal(store.listConnectors(TENANT_A).length, 3);
      assert.equal(store.listConnectors(TENANT_B).length, 1);
    });
  });
} else if (MODE === 'verify') {
  if (PERSIST_DIR.length === 0) {
    throw new Error('C31_PERSIST_DIR requis pour le mode verify');
  }
  process.env.VOLACO_DATA_DIR = PERSIST_DIR;
  const manifest = JSON.parse(
    readFileSync(join(PERSIST_DIR, MANIFEST_NAME), 'utf8')
  ) as C31Manifest;

  describe('C3.1 inter-processus : persistance réelle dans un autre processus', () => {
    let store!: RemoteMcpConnectorStore;
    before(() => {
      store = new RemoteMcpConnectorStore(makeCipher());
    });

    it('conserve identité, nom, URL, transport, enabled et dates', () => {
      const a = store.getConnector(TENANT_A, manifest.aId);
      assert.ok(a !== null);
      assert.equal(a.tenantId, TENANT_A);
      assert.equal(a.name, 'config-a');
      assert.equal(a.url, URL_A);
      assert.equal(a.transport, 'url');
      assert.equal(a.enabled, false); // false par défaut persisté
      const b = store.getConnector(TENANT_A, manifest.bId);
      assert.ok(b !== null);
      assert.equal(b.enabled, true); // true persisté
      const c = store.getConnector(TENANT_A, manifest.cId);
      assert.ok(c !== null);
      assert.equal(c.enabled, false); // retour explicite à false persisté
      const d = store.getConnector(TENANT_B, manifest.dId);
      assert.ok(d !== null);
      assert.equal(d.tenantId, TENANT_B);
      assert.equal(d.name, 'config-d');
      assert.equal(d.url, URL_B);
    });

    it('conserve le dernier test persisté (delta C3.1 lastTest)', () => {
      const last = store.getLastTest(TENANT_A, manifest.aId);
      assert.ok(last !== null);
      assert.equal(last.status, 'FAILED');
      assert.equal(last.detail, LAST_TEST_DETAIL);
      assert.equal(store.getLastTest(TENANT_A, manifest.bId), null);
    });

    it('l isolation tenant reste stricte d un processus à l autre', () => {
      assert.equal(store.getConnector(TENANT_B, manifest.aId), null);
      assert.equal(store.getConnector(TENANT_A, manifest.dId), null);
      assert.equal(store.getLastTest(TENANT_A, manifest.dId), null);
      assert.equal(store.listConnectors(TENANT_A).length, manifest.listsA);
      assert.equal(store.listConnectors(TENANT_B).length, manifest.listsD);
    });
  });
} else {
  // MODE 'migrate' — base préexistante au schéma d'ORIGINE
  const DATA_DIR = mkdtempSync(join(tmpdir(), 'volaco-c31-migrate-'));
  process.env.VOLACO_DATA_DIR = DATA_DIR;

  // DDL hérité — copie fidèle du schéma pré-delta (avant l'addition des
  // colonnes last_test_*) ; simule une réelle base déjà en production.
  const LEGACY_DDL = `
    CREATE TABLE IF NOT EXISTS mcp_remote_connectors (
      tenant_id TEXT NOT NULL CHECK(length(tenant_id) <= 64),
      connector_id TEXT NOT NULL CHECK(length(connector_id) <= 64),
      name TEXT NOT NULL CHECK(length(name) <= 64),
      url TEXT NOT NULL CHECK(length(url) <= ${REMOTE_MCP_URL_MAX_LENGTH}),
      transport TEXT NOT NULL CHECK(transport = 'url'),
      enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
      secret_key_id TEXT,
      secret_iv TEXT,
      secret_ciphertext TEXT,
      secret_tag TEXT,
      secret_created_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, connector_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_remote_connectors_tenant
      ON mcp_remote_connectors (tenant_id);
  `;

  describe('C3.1 migration non destructive (base préexistante sans colonnes last_test_*)', () => {
    const legacyId = randomUUID();
    const legacyCreated = new Date().toISOString();

    before(() => {
      // Base pré-delta écrite AVANT toute initialisation du store : DDL
      // d'origine + une ligne existante (sans les colonnes last_test_*).
      const raw = new DatabaseSync(sqliteDatabasePath());
      try {
        raw.exec(LEGACY_DDL);
        raw
          .prepare(
            `INSERT INTO mcp_remote_connectors
               (tenant_id, connector_id, name, url, transport, enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'url', 1, ?, ?)`
          )
          .run(TENANT_A, legacyId, 'legacy-config', URL_A, legacyCreated, legacyCreated);
      } finally {
        raw.close();
      }
    });

    it("aucune donnée préexistante n'est perdue à l'initialisation du schéma (ALTER non destructif)", () => {
      const store = new RemoteMcpConnectorStore(makeCipher());
      const rec = store.getConnector(TENANT_A, legacyId);
      assert.ok(rec !== null);
      assert.equal(rec.name, 'legacy-config');
      assert.equal(rec.url, URL_A);
      assert.equal(rec.transport, 'url');
      assert.equal(rec.enabled, true); // état conservé intact
      assert.equal(rec.createdAt, legacyCreated);
      assert.equal(rec.updatedAt, legacyCreated); // tout PAS ré-bauché par la migration
      assert.deepEqual(rec.toolPolicies, []);
      assert.deepEqual(
        store.listConnectors(TENANT_A).map((one) => ({
          id: one.connectorId,
          name: one.name,
          enabled: one.enabled
        })),
        [{ id: legacyId, name: 'legacy-config', enabled: true }]
      );
      // Les colonnes nouvellement ajoutées visent NULL pour les lignes préexistantes.
      assert.equal(store.getLastTest(TENANT_A, legacyId), null);
    });

    it('le delta lastTest opère immédiatement sur la base migrée', () => {
      const store = new RemoteMcpConnectorStore(makeCipher());
      const result = store.recordLastTest(TENANT_A, legacyId, {
        status: 'OK',
        detail: 'migration ok'
      });
      assert.equal(result.status, 'OK');
      assert.equal(result.detail, 'migration ok');
      const reread = store.getLastTest(TENANT_A, legacyId);
      assert.ok(reread !== null);
      assert.equal(reread.status, 'OK');
      assert.equal(reread.detail, 'migration ok');
      // La ligne n'a pas été recréée : identité et nom inchangés.
      const rec = store.getConnector(TENANT_A, legacyId);
      assert.ok(rec !== null);
      assert.equal(rec.name, 'legacy-config');
    });
  });
}
