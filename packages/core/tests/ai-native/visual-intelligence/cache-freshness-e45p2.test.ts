/**
 * ÉTAPE 45 Phase 2 — fraîcheur du cache Visual Intelligence.
 *
 * Avant correction, la clé de cache (`tenant:project:page:viewport`) ignorait
 * le contenu : après édition du même projet, `analyzeVisuals` resservait le
 * snapshot stale (LRU sans TTL, `clearCache()` sans appelant production).
 * La clé inclut désormais une empreinte SHA-256 déterministe du htmlContent.
 *
 * Tests déterministes : aucun serveur, aucun navigateur, aucun réseau.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VisualIntelligenceService } from '../../../src/index.js';
import type { VisualAnalysisRequest } from '../../../src/index.js';

// V1 — thème sombre bleu, 3 boutons
const V1 = `<!DOCTYPE html><html><head><title>V1</title></head>
<body style="background:#0b1220;color:#f1f5f9"><h1 style="color:#7dd3fc">Version Un</h1>
<button style="height:40px;background:#3b82f6;border-radius:6px">Un</button>
<button style="height:40px;background:#3b82f6;border-radius:6px">Deux</button>
<button style="height:40px;background:#3b82f6;border-radius:6px">Trois</button></body></html>`;

// V2 — même tenant/project/page/viewport, design radicalement différent
const V2 = `<!DOCTYPE html><html><head><title>V2</title></head>
<body style="background:#fef2f2;color:#7f1d1d"><h1 style="color:#dc2626">Version Deux</h1>
<button style="height:40px;background:#dc2626;border-radius:24px">Un</button>
<button style="height:40px;background:#dc2626;border-radius:24px">Deux</button>
<button style="height:40px;background:#dc2626;border-radius:24px">Trois</button>
<input style="height:36px;background:#ffffff"></body></html>`;

function request(html: string): VisualAnalysisRequest {
  return { tenantId: 't_e45p2', projectId: 'p_e45p2', htmlContent: html, requestId: 'req_e45p2' };
}

describe('ÉTAPE 45 Phase 2 — fraîcheur du cache Visual Intelligence', () => {
  it('A: même projet, contenu V1 puis V2 → chaque analyse reflète SON contenu (jamais le snapshot stale)', async () => {
    const svc = new VisualIntelligenceService();
    const r1 = await svc.analyzeVisuals(request(V1), 'ENGINEER');
    const r2 = await svc.analyzeVisuals(request(V2), 'ENGINEER');

    // Chaque analyse porte les couleurs de son propre contenu
    const colors1 = r1.snapshot.extractedColors;
    const colors2 = r2.snapshot.extractedColors;
    assert.ok(colors1.includes('#3b82f6') && colors1.includes('#7dd3fc'), 'V1 : palette bleue analysée');
    assert.ok(colors2.includes('#dc2626') && colors2.includes('#fef2f2'), 'V2 : palette rouge analysée');
    assert.ok(!colors2.includes('#3b82f6'), 'V2 ne contient aucune couleur de V1 (pas de snapshot stale)');
    assert.ok(!colors1.includes('#dc2626'), 'V1 ne contient aucune couleur de V2 (pas de fuite croisée)');
    assert.notDeepEqual(colors1, colors2, 'palettes distinctes');
  });

  it('B: même contenu → le cache reste actif (second appel = CACHED, snapshot identique)', async () => {
    const svc = new VisualIntelligenceService();
    const first = await svc.analyzeVisuals(request(V1), 'ENGINEER');
    assert.equal(first.executionMeta.source, 'HEADLESS_HTML', 'première analyse : calcul réel');
    const second = await svc.analyzeVisuals(request(V1), 'ENGINEER');
    assert.equal(second.executionMeta.source, 'CACHED', 'contenu identique → cache utilisé');
    assert.deepEqual(second.snapshot, first.snapshot, 'snapshot identique pour un contenu identique');
    // Revenir à V1 après une autre analyse ressert aussi le cache (clé par contenu)
    await svc.analyzeVisuals(request(V2), 'ENGINEER');
    const again = await svc.analyzeVisuals(request(V1), 'ENGINEER');
    assert.equal(again.executionMeta.source, 'CACHED', 'V1 recacheté après V2 (clé par contenu)');
    assert.deepEqual(again.snapshot, first.snapshot);
  });

  it('C: déterminisme — deux instances indépendantes produisent des mesures identiques pour le même HTML', async () => {
    const svcA = new VisualIntelligenceService();
    const svcB = new VisualIntelligenceService();
    const a = await svcA.analyzeVisuals(request(V1), 'ENGINEER');
    const b = await svcB.analyzeVisuals(request(V1), 'ENGINEER');
    assert.deepEqual(a.snapshot.extractedColors, b.snapshot.extractedColors);
    assert.deepEqual(a.snapshot.extractedFonts, b.snapshot.extractedFonts);
    assert.equal(a.snapshot.totalElementsCount, b.snapshot.totalElementsCount);
    assert.equal(a.snapshot.snapshotHash, b.snapshot.snapshotHash, 'hash de snapshot déterministe');
  });
});
