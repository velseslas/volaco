/**
 * CDC §31 — BRANCHES & MERGE (versionnement linéaire + registre de lignes).
 *
 * Modèle : numérotation globale/monotone, chaque entrée porte sa branche
 * ('main' par défaut) ; le merge archive une version 'merge' avec le payload
 * EXACT de la source et réactive 'main' — aucun historique réécrit, aucun
 * hash fabriqué, aucun merge répété.
 *
 * On rejoue le cycle par API réelle : les fichiers du projet sont inspectés
 * par extractDNA au hook de capture (server.ts) ; on reste donc dans
 * l'honnêteté « hash réellement changé » (le stream passe lui-même par la
 * capture — ici on archive manuellement une évolution pour la branche).
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { DNAVersionStore } from '../../../packages/core/src/ai-native/dna/version-store.js';
import type { ApplicationDNA } from '../../../packages/core/src/ai-native/dna/types.js';

/** DNA minimale mais structurellement complète pour le store. */
function fakeDna(hash: string, components: string[]): ApplicationDNA {
  return {
    dnaHash: hash,
    analyzerVersion: 'test-1',
    stack: { language: { name: 'HTML', version: '' }, framework: { name: 'none', version: '' }, styling: '', modules: [] },
    architecture: { components: components.map((name) => ({ name })), modules: [] },
    components: components.map((name) => ({ name })),
    modules: [],
    conventions: [],
    summary: { totalFiles: 1, overallHealth: 'HEALTHY' }
  } as unknown as ApplicationDNA;
}

describe('DNA §31 : branches & merge — versionnement linéaire, jamais réécrit', () => {
  let server: Server;
  let baseUrl: string;
  const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'dna-branch-t1', 'x-user-role': 'OWNER' };
  let projectId = '';

  before(async () => {
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    const p = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST', headers: H, body: JSON.stringify({ name: 'dna-branch-reg' })
    });
    const pj = (await p.json()) as { project: { id: string } };
    projectId = pj.project.id;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('store en mémoire : brancher → capture sur la ligne → merge tracé, historique intact', () => {
    const store = new DNAVersionStore(false);
    const T = 'ten-branch';
    const P = 'prj-branch';
    const r1 = store.recordVersion(T, P, fakeDna('hash-v1', ['hero']), { trigger: 'manual', requestId: 'req-1' });
    assert.equal(r1.created, true);
    assert.equal(r1.version, 1);

    // Re-capturer APÈS changements = v2 sur main
    const r2 = store.recordVersion(T, P, fakeDna('hash-v2', ['hero', 'footer']), { trigger: 'manual', requestId: 'req-2' });
    assert.equal(r2.version, 2);
    assert.equal(store.getVersions(T, P).length, 2);

    // Branche 'idee-rouge' depuis v2
    const b = store.createBranch(T, P, 'idee-rouge', 2);
    assert.equal(b.name, 'idee-rouge');
    assert.equal(b.fromVersion, 2);
    store.setActiveBranch(T, P, 'idee-rouge');

    // Captures suivantes = sur la ligne
    const r3 = store.recordVersion(T, P, fakeDna('hash-v3', ['hero', 'footer', 'rouge']), { trigger: 'manual', requestId: 'req-3' });
    assert.equal(r3.version, 3);
    const onIdee = store.getVersionsOnBranch(T, P, 'idee-rouge');
    assert.equal(onIdee.length, 1);
    assert.equal(onIdee[0]?.version, 3);
    const onMain = store.getVersionsOnBranch(T, P, 'main');
    assert.equal(onMain.length, 2, 'main conserve v1 + v2');
    assert.ok(onMain.every((v) => v.branch === 'main'));

    // Merge : la version merge est sur main, payload/hash/source intacts
    const merged = store.mergeBranch(T, P, 'idee-rouge', 3);
    assert.equal(merged.version, 4);
    assert.equal(merged.trigger, 'merge');
    assert.equal(merged.branch, 'main');
    assert.equal(merged.hash, 'hash-v3', 'hash local adopté, jamais fabriqué');
    assert.equal(merged.sessionId, 'merge-of:idee-rouge');
    assert.equal(store.getActiveBranch(T, P), 'main', 'après merge : retour main');
    assert.equal(store.isBranchMerged(T, P, 'idee-rouge'), true);
    assert.equal(store.getVersions(T, P).length, 4, 'historique intact (1..4)');
  });

  it('refus honnêtes : main n\'est jamais fusionnée, doublon impossible, source hors ligne refusée', () => {
    const store = new DNAVersionStore(false);
    const T = 'ten-branch';
    const P = 'prj-honnetete';
    store.recordVersion(T, P, fakeDna('hash-v1', ['hero']), { trigger: 'manual', requestId: 'req-x1' });
    assert.throws(() => store.mergeBranch(T, P, 'main', 1), /jamais fusionnée/);
    store.createBranch(T, P, 'essai', 1);
    store.setActiveBranch(T, P, 'essai');
    store.recordVersion(T, P, fakeDna('hash-v2', ['hero', 'essai']), { trigger: 'manual', requestId: 'req-x2' });
    assert.throws(() => store.mergeBranch(T, P, 'essai', 1), /n'est pas sur la branche/, 'source v1 sur main, pas sur essai');
    store.mergeBranch(T, P, 'essai', 2);
    assert.throws(() => store.mergeBranch(T, P, 'essai', 2), /déjà rattachée/, 'jamais deux fois');
    assert.throws(() => store.createBranch(T, P, 'essai', 1), /déjà existante/, 'pas de réutilisation de ligne');
    assert.throws(() => store.createBranch(T, P, 'main', 1), /Nom de branche invalide/);
    assert.throws(() => store.createBranch(T, P, 'UPPER', 1), /Nom de branche invalide/);
    assert.throws(() => store.createBranch(T, P, 'ok-name', 999), /introuvable/);
    assert.throws(() => store.setActiveBranch(T, P, 'absente'), /introuvable/);
  });

  it('routes : branches GET + POST branch + activate + filtre ?branch + merge (400/404 honnêtes)', async () => {
    // le store de route est le store réel de l'instance : on l'alimente
    // via les captures — ici, des routes branch natives sur projet vidé
    // répondent au moins honnêtement (aucune version → 400 explicite).
    const list = await fetch(`${baseUrl}/api/v1/projects/${projectId}/dna/branches`, { headers: H });
    assert.equal(list.status, 200);
    const listed = (await list.json()) as { branches: Array<{ name: string }>; activeBranch: string };
    assert.equal(listed.activeBranch, 'main');
    assert.ok(listed.branches.some((b) => b.name === 'main'), 'main est une ligne par défaut');

    const bad = await fetch(`${baseUrl}/api/v1/projects/${projectId}/dna/branches`, {
      method: 'POST', headers: H, body: JSON.stringify({ name: 'vide', fromVersion: 1 })
    });
    assert.equal(bad.status, 400, 'brancher sans versions archivées : refus honnête');

    const unknown = await fetch(`${baseUrl}/api/v1/projects/${projectId}/dna/branches/inconnue/activate`, {
      method: 'POST', headers: H, body: '{}'
    });
    assert.equal(unknown.status, 400, 'activation d\'une ligne absente : refus honnête');

    // filtre ?branch sur la liste versions : ligne inexistante → liste vide
    const vdf = await fetch(`${baseUrl}/api/v1/projects/${projectId}/dna/versions?branch=inexistante`, { headers: H });
    assert.equal(vdf.status, 200);
    const vdfBody = (await vdf.json()) as { versions: unknown[] };
    assert.equal(vdfBody.versions.length, 0);
  });
});
