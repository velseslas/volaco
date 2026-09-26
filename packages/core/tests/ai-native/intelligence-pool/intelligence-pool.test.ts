/**
 * VibeCode Core - Intelligence Pool Unit Tests
 * Phase 9.5
 *
 * Scénarios :
 *  - PriorityScorer : calcule un score 0-100 avec breakdown
 *  - EvidenceRanker : trie par authority * confidence
 *  - LruCache : eviction oldest-first
 *  - canonical : deepFreeze + computeHash déterministe
 *  - AnalystRegistry.analyzeAll : agrège 4 analysts
 *  - StrategyAnalyst : détecte les fichiers > 500 LOC
 *  - EvolutionAnalyst : détecte les patterns legacy (var, require)
 *  - FeatureAnalyst : détecte les TODO/FIXME
 *  - UnderstandingAnalyst : détecte la stack (React, etc.)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PriorityScorer, DEFAULT_WEIGHTS, createScorer } from '../../../src/ai-native/intelligence-pool/priority-scorer.js';
import { EvidenceRanker } from '../../../src/ai-native/intelligence-pool/evidence-ranker.js';
import { IntelligenceLruCache } from '../../../src/ai-native/intelligence-pool/lru-cache.js';
import { deepFreeze, computeHash } from '../../../src/ai-native/intelligence-pool/canonical.js';
import { AnalystRegistry } from '../../../src/ai-native/intelligence-pool/analysts/index.js';
import { StrategyAnalyst } from '../../../src/ai-native/intelligence-pool/analysts/strategy-analyst.js';
import { EvolutionAnalyst } from '../../../src/ai-native/intelligence-pool/analysts/evolution-analyst.js';
import { FeatureAnalyst } from '../../../src/ai-native/intelligence-pool/analysts/feature-analyst.js';
import { UnderstandingAnalyst } from '../../../src/ai-native/intelligence-pool/analysts/understanding-analyst.js';
import type { AnalystContext, Evidence } from '../../../src/ai-native/intelligence-pool/types.js';

function makeContext(files: Array<{ path: string; content: string }> = []): AnalystContext {
  return {
    projectId: 'proj_test',
    tenantId: 'tenant_test',
    files
  };
}

const LONG_FILE_CONTENT = '// ' + 'x'.repeat(50) + '\n'.repeat(550);

describe('PHASE 9.5 — Intelligence Pool', () => {
  describe('PriorityScorer', () => {
    it('doit calculer un score entre 0 et 100', () => {
      const scorer = new PriorityScorer();
      const breakdown = scorer.score({
        userValue: 80,
        strategicAlignment: 70,
        evidence: [],
        expectedValue: 60,
        urgency: 50,
        riskReduction: 40
      });
      assert.ok(breakdown.total >= 0 && breakdown.total <= 100);
      assert.ok(breakdown.rationale.includes('total='));
    });

    it('doit accepter des poids personnalisés via createScorer', () => {
      const scorer = createScorer({ userValue: 0.5 });
      const weights = scorer.getWeights();
      assert.equal(weights.userValue, 0.5);
      assert.equal(weights.strategicAlignment, DEFAULT_WEIGHTS.strategicAlignment);
    });

    it('doit produire un breakdown avec tous les composants', () => {
      const scorer = new PriorityScorer();
      const b = scorer.score({
        userValue: 100,
        strategicAlignment: 100,
        evidence: [],
        expectedValue: 100,
        urgency: 100,
        riskReduction: 100
      });
      assert.ok(b.userValue > 0);
      assert.ok(b.strategicAlignment > 0);
      assert.ok(b.expectedValue > 0);
      assert.ok(b.urgency > 0);
      assert.ok(b.riskReduction > 0);
    });
  });

  describe('EvidenceRanker', () => {
    it('doit trier par score décroissant = authority * confidence', () => {
      const ranker = new EvidenceRanker();
      const ev: Evidence[] = [
        { id: '1', source: 'low', description: 'low', type: 'HYPOTHESIS', confidence: 0.5, authorityWeight: 0.5 },
        { id: '2', source: 'high', description: 'high', type: 'FACT', confidence: 0.95, authorityWeight: 0.9 },
        { id: '3', source: 'mid', description: 'mid', type: 'CORRELATION', confidence: 0.8, authorityWeight: 0.7 }
      ];
      const ranked = ranker.rank(ev);
      assert.equal(ranked[0]?.id, '2');
      assert.equal(ranked[1]?.id, '3');
      assert.equal(ranked[2]?.id, '1');
    });

    it('weightedConfidence doit retourner 0 sur tableau vide', () => {
      const ranker = new EvidenceRanker();
      assert.equal(ranker.weightedConfidence([]), 0);
    });

    it('topN doit retourner N elements', () => {
      const ranker = new EvidenceRanker();
      const ev: Evidence[] = [
        { id: '1', source: 'a', description: 'a', type: 'FACT', confidence: 0.5, authorityWeight: 0.5 },
        { id: '2', source: 'b', description: 'b', type: 'FACT', confidence: 0.9, authorityWeight: 0.9 },
        { id: '3', source: 'c', description: 'c', type: 'FACT', confidence: 0.7, authorityWeight: 0.7 }
      ];
      assert.equal(ranker.topN(ev, 2).length, 2);
    });
  });

  describe('IntelligenceLruCache', () => {
    it('doit évicter le plus ancien en cas de dépassement de capacité', () => {
      const cache = new IntelligenceLruCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      assert.equal(cache.has('a'), false);
      assert.equal(cache.has('b'), true);
      assert.equal(cache.has('c'), true);
    });

    it('doit mettre à jour LRU sur get', () => {
      const cache = new IntelligenceLruCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.get('a'); // a est maintenant le plus récent
      cache.set('c', 3); // doit évicter b (le plus ancien)
      assert.equal(cache.has('a'), true);
      assert.equal(cache.has('b'), false);
      assert.equal(cache.has('c'), true);
    });

    it('doit exposer des métriques', () => {
      const cache = new IntelligenceLruCache<string, number>(5);
      cache.set('a', 1);
      cache.get('a');
      cache.get('x'); // miss
      const m = cache.metrics;
      assert.ok(m.hits >= 1);
      assert.ok(m.misses >= 1);
      assert.equal(m.maxEntries, 5);
    });
  });

  describe('canonical', () => {
    it('deepFreeze doit rendre l objet immuable', () => {
      const obj = deepFreeze({ a: 1, b: { c: 2 } });
      assert.throws(() => {
        (obj as { a: number }).a = 999;
      });
    });

    it('computeHash doit être déterministe', () => {
      const a = { x: 1, y: 2 };
      const b = { y: 2, x: 1 }; // mêmes données, ordre différent
      assert.equal(computeHash(a), computeHash(b));
    });

    it('computeHash doit différer pour des données différentes', () => {
      const a = { x: 1 };
      const b = { x: 2 };
      assert.notEqual(computeHash(a), computeHash(b));
    });
  });

  describe('StrategyAnalyst', () => {
    it('doit détecter les fichiers > 500 LOC', async () => {
      const analyst = new StrategyAnalyst();
      const recs = await analyst.analyze(makeContext([
        { path: 'big.ts', content: LONG_FILE_CONTENT }
      ]));
      const bigFileRec = recs.find((r) => r.title.includes('big.ts'));
      assert.ok(bigFileRec, 'Should detect big file');
      assert.equal(bigFileRec.source, 'strategy');
      assert.equal(bigFileRec.estimatedEffort, 'HIGH');
    });
  });

  describe('EvolutionAnalyst', () => {
    it('doit détecter var declarations', async () => {
      const analyst = new EvolutionAnalyst();
      const recs = await analyst.analyze(makeContext([
        { path: 'legacy.js', content: 'var x = 1; var y = 2;' }
      ]));
      const varRec = recs.find((r) => r.title.includes('var declarations'));
      assert.ok(varRec, 'Should detect var declarations');
    });

    it('doit détecter require() CommonJS', async () => {
      const analyst = new EvolutionAnalyst();
      const recs = await analyst.analyze(makeContext([
        { path: 'old.js', content: "const fs = require('fs');" }
      ]));
      const reqRec = recs.find((r) => r.title.includes('require()'));
      assert.ok(reqRec, 'Should detect CommonJS require()');
    });
  });

  describe('FeatureAnalyst', () => {
    it('doit détecter les TODO', async () => {
      const analyst = new FeatureAnalyst();
      const recs = await analyst.analyze(makeContext([
        { path: 'app.ts', content: 'function foo() {\n  // TODO: implement this\n}\n' }
      ]));
      const todoRec = recs.find((r) => r.title.includes('TODO'));
      assert.ok(todoRec, 'Should detect TODO comments');
    });

    it('doit détecter FIXME', async () => {
      const analyst = new FeatureAnalyst();
      const recs = await analyst.analyze(makeContext([
        { path: 'buggy.ts', content: 'function bar() {\n  // FIXME: this is broken\n}\n' }
      ]));
      const fixmeRec = recs.find((r) => r.title.includes('TODO'));
      assert.ok(fixmeRec, 'Should detect FIXME comments');
    });
  });

  describe('UnderstandingAnalyst', () => {
    it('doit détecter la stack React', async () => {
      const analyst = new UnderstandingAnalyst();
      const recs = await analyst.analyze(makeContext([
        { path: 'App.tsx', content: "import { useState } from 'react';" }
      ]));
      const stackRec = recs.find((r) => r.title.includes('Detected stack'));
      assert.ok(stackRec, 'Should detect stack');
      assert.ok(stackRec.title.includes('React'), `Expected title to include React, got: ${stackRec?.title}`);
    });

    it('doit détecter la structure de dossiers', async () => {
      const analyst = new UnderstandingAnalyst();
      const recs = await analyst.analyze(makeContext([
        { path: 'src/App.ts', content: 'export const A = 1;' },
        { path: 'src/utils.ts', content: 'export const U = 2;' },
        { path: 'tests/t1.ts', content: 'export const T = 3;' }
      ]));
      const structRec = recs.find((r) => r.title.includes('Directory structure'));
      assert.ok(structRec, 'Should detect directory structure');
    });
  });

  describe('AnalystRegistry', () => {
    it('doit enregistrer les 4 analysts par défaut', () => {
      const reg = new AnalystRegistry();
      const list = reg.list();
      assert.equal(list.length, 4);
      const ids = list.map((a) => a.id);
      assert.ok(ids.includes('strategy'));
      assert.ok(ids.includes('evolution'));
      assert.ok(ids.includes('feature'));
      assert.ok(ids.includes('understanding'));
    });

    it('analyzeAll doit exécuter tous les analysts et agréger', async () => {
      const reg = new AnalystRegistry();
      const recs = await reg.analyzeAll(makeContext([
        { path: 'big.ts', content: LONG_FILE_CONTENT },
        { path: 'legacy.js', content: 'var x = 1;' },
        { path: 'app.ts', content: "// TODO: implement\nimport { useState } from 'react';" }
      ]));
      assert.ok(recs.length > 0, 'Should produce recommendations');
      // Tri par score décroissant
      for (let i = 1; i < recs.length; i++) {
        assert.ok((recs[i - 1]?.score ?? 0) >= (recs[i]?.score ?? 0), 'Should be sorted by score desc');
      }
    });

    it('analyzeOne doit exécuter un seul analyst', async () => {
      const reg = new AnalystRegistry();
      const recs = await reg.analyzeOne('strategy', makeContext([
        { path: 'big.ts', content: LONG_FILE_CONTENT }
      ]));
      assert.ok(recs.length > 0);
      for (const r of recs) {
        assert.equal(r.source, 'strategy');
      }
    });

    it('analyzeOne doit retourner [] pour un analyst inconnu', async () => {
      const reg = new AnalystRegistry();
      const recs = await reg.analyzeOne('nonexistent' as never, makeContext([]));
      assert.equal(recs.length, 0);
    });
  });
});
