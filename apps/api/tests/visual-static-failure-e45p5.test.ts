/**
 * ÉTAPE 45 Phase 5 (F9) — marquage de l'échec de l'analyse statique.
 *
 * Avant correction, si `analyzeVisuals` échouait dans `analyzeProjectVisual`,
 * la réponse restait indistinguable d'une analyse complète (score sans
 * contexte, `renderAvailable=true`). Un finding explicite
 * « Analyse statique indisponible » est désormais poussé, en miroir du
 * marquage « Rendu réel indisponible » existant.
 *
 * La simulation utilise un patch de prototype runtime (restauré dans
 * `finally`) — aucun fichier de production n'est modifié pour provoquer
 * l'échec.
 */

import './_lot-b-legacy-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { VisualIntelligenceService } from '../../../packages/core/src/ai-native/visual-intelligence/index.js';

const tenant = 'tenant_e45p5f9';
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'x-tenant-id': tenant, 'x-user-role': 'ENGINEER' };
const HTML = '<!DOCTYPE html><html><body style="background:#0b1220;color:#f1f5f9"><h1 style="color:#7dd3fc">Titre</h1><button style="height:40px;background:#3b82f6">A</button></body></html>';

describe('ÉTAPE 45 Phase 5 — marquage de l échec statique (F9)', () => {
  let server: Server;
  let baseUrl: string;
  let projectId = '';

  before(async () => {
    const { createApiServer } = await import('../src/server.js');
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    const pres = await fetch(`${baseUrl}/api/v1/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'E45 F9' }) });
    projectId = ((await pres.json()) as { project?: { id?: string } }).project!.id!;
    await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content`, {
      method: 'PUT', headers, body: JSON.stringify({ path: 'index.html', content: HTML })
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  const analyze = async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/visual/analyze`, { method: 'POST', headers });
    assert.equal(res.status, 200);
    return (await res.json()) as {
      score: number;
      findings: Array<{ severity: string; source: string; title: string }>;
      renderAvailable: boolean;
    };
  };

  it('normal: aucune mention d analyse statique indisponible quand tout fonctionne', async () => {
    const r = await analyze();
    assert.ok(!r.findings.some((f) => f.title === 'Analyse statique indisponible'));
  });

  it('échec statique simulé → finding explicite « Analyse statique indisponible » (renderAvailable inchangé)', async () => {
    const original = VisualIntelligenceService.prototype.analyzeVisuals;
    VisualIntelligenceService.prototype.analyzeVisuals = async () => {
      throw new Error('SIMULATION — analyse statique indisponible');
    };
    try {
      const r = await analyze();
      const marker = r.findings.find((f) => f.title === 'Analyse statique indisponible');
      assert.ok(marker, 'le marquage de dégradation statique est présent dans les findings');
      assert.equal(marker!.severity, 'LOW');
      assert.equal(marker!.source, 'DESIGN');
      assert.ok(r.renderAvailable, 'renderAvailable décrit toujours le rendu, pas l analyse statique');
      // La dégradation est visible : le score n est plus un 100 sans contexte
      assert.ok(r.score < 100, 'la pénalité LOW (2 points) rend l échec visible dans le score');
    } finally {
      VisualIntelligenceService.prototype.analyzeVisuals = original;
    }
    // Restauration vérifiée : l'appel suivant redevient normal
    const restored = await analyze();
    assert.ok(!restored.findings.some((f) => f.title === 'Analyse statique indisponible'));
  });
});
