/**
 * ÉTAPE 48 Phase 4 (J-6) — tracking des attempts IA.
 *
 * Sémantique vérifiée : chaque appel provider réel émet EXACTEMENT
 *   1 START (coût 0, dès le démarrage — visible même en cas de crash)
 *   + EXACTEMENT 1 terminal (SUCCESS avec coût réel / ERROR sans coût /
 *     ABORTED pour un stream interrompu).
 * Les retries/repair sont des appels distincts → des START distincts
 * (chaque appel consomme réellement des tokens).
 * Anti-double-comptage : le START ne porte jamais de coût ni de tokens —
 * les totaux du summary ne comptent que le réel.
 *
 * Les adapters acceptent un fetch injecté (aucun réseau).
 */

process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MistralProviderAdapter } from '../../../packages/core/src/ai/providers/mistral-adapter.js';
import { GeminiProviderAdapter } from '../../../packages/core/src/ai/providers/gemini-adapter.js';
import { aiUsageTracker } from '../../../packages/core/src/ai/usage.js';
import type { AIProviderGenerateRequest } from '../../../packages/core/src/ai/providers/index.js';

// NOTE : l'isolation de persistance est fournie par VOLACO_DATA_DIR du runner
// (scripts/run-tests.mjs). Chaque test utilise un tenant unique — les
// assertions filtrent par tenant, insensibles aux records d'autres tests.

const MISTRAL_OK = {
  choices: [{ message: { content: 'Bonjour du provider' } }],
  usage: { prompt_tokens: 100, completion_tokens: 130, total_tokens: 230 }
};

const GEMINI_OK = {
  candidates: [{ content: { parts: [{ text: 'Bonjour du provider' }] } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 130, totalTokenCount: 230 }
};

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function errResponse(status: number): Response {
  return new Response(JSON.stringify({ message: 'erreur provider simulée', error: { message: 'erreur provider simulée' } }), { status });
}

function genRequest(requestId: string, prompt: string, tenantId = 'tenant_sec'): AIProviderGenerateRequest {
  return { tenantId, projectId: 'proj_sec', prompt, requestId } as unknown as AIProviderGenerateRequest;
}

const CREDS = { tenantId: 'tenant_sec', providerId: 'fake', apiKey: 'fake-key-sec-0123456789' };

describe('ÉTAPE 48 Phase 4 — tracking des attempts IA (J-6)', () => {
  it('A: generate succès → exactement START puis SUCCESS (coût sur SUCCESS seulement)', async () => {
    const tenant = 'tenant_attempt_a';
    const adapter = new MistralProviderAdapter(async () => okResponse(MISTRAL_OK));
    const res = await adapter.generate(genRequest('req-A', 'un prompt de test', tenant), CREDS);
    assert.equal(res.text, 'Bonjour du provider');

    const records = aiUsageTracker.getRecordsFor(tenant);
    assert.equal(records.length, 2, 'exactement 2 événements (START + SUCCESS)');
    assert.equal(records[0]!.kind, 'START');
    assert.equal(records[0]!.provider, 'mistral');
    assert.equal(records[0]!.estimatedCostUsd, 0, 'le START ne porte aucun coût');
    assert.equal(records[0]!.totalTokens, 0, 'le START ne porte aucun token');
    assert.equal(records[1]!.kind, 'SUCCESS');
    assert.equal(records[1]!.totalTokens, 230, 'le SUCCESS porte le coût réel en tokens');
    assert.ok(records[1]!.estimatedCostUsd > 0);
    // Corrélation : même requestId sur les deux événements
    assert.equal(records[0]!.requestId, 'req-A');
    assert.equal(records[1]!.requestId, 'req-A');
  });

  it('B: generate erreur → START puis ERROR (usage inconnu, coût 0, jamais de SUCCESS)', async () => {
    const tenant = 'tenant_attempt_b';
    const adapter = new MistralProviderAdapter(async () => errResponse(500));
    await assert.rejects(
      adapter.generate(genRequest('req-B', 'un prompt de test', tenant), CREDS),
      /erreur provider simulée/
    );
    const records = aiUsageTracker.getRecordsFor(tenant);
    assert.equal(records.length, 2, 'exactement 2 événements (START + ERROR)');
    assert.equal(records[0]!.kind, 'START');
    assert.equal(records[1]!.kind, 'ERROR');
    assert.ok((records[1]!.error || '').length > 0, 'le terminal ERROR porte le motif sanitisé');
    assert.ok(!records.some((r) => r.kind === 'SUCCESS'), 'aucun faux succès');
    // Anti-double-comptage : les totaux ne comptent que le réel (0 ici)
    const summary = aiUsageTracker.getUsageSummary(tenant);
    assert.equal(summary.totalTokens, 0);
    assert.equal(summary.totalCostUsd, 0);
    assert.equal(summary.recordCount, 2, 'les events de tracking sont comptés comme événements');
  });

  it('C: generateStream succès → START puis terminal SUCCESS sans coût inventé (J-6b différé)', async () => {
    const tenant = 'tenant_attempt_c';
    const sse = 'data: {"choices":[{"delta":{"content":"Sali"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"ut !"}}]}\n\n' +
      'data: [DONE]\n\n';
    const adapter = new MistralProviderAdapter(async () => new Response(sse, { status: 200 }));
    const req = { tenantId: tenant, projectId: 'proj_sec', prompt: 'stream test', requestId: 'req-C', maxTokens: 10 } as unknown as AIProviderGenerateRequest;
    let out = '';
    for await (const chunk of adapter.generateStream!(req, CREDS)) out += chunk;
    assert.equal(out, 'Saliut !');

    const records = aiUsageTracker.getRecordsFor(tenant);
    assert.deepEqual(records.map((r) => r.kind), ['START', 'SUCCESS'], 'START + terminal SUCCESS');
    // J-6b différé : le stream ne prétend aucun usage ni coût
    for (const r of records) {
      assert.equal(r.totalTokens, 0, 'aucun token inventé');
      assert.equal(r.estimatedCostUsd, 0, 'aucun coût inventé');
    }
  });

  it('C-bis: generateStream erreur → START puis ERROR (et pas deux terminaux)', async () => {
    const tenant = 'tenant_attempt_cb';
    const adapter = new MistralProviderAdapter(async () => errResponse(500));
    const req = { tenantId: tenant, projectId: 'proj_sec', prompt: 'stream en échec', requestId: 'req-Cb', maxTokens: 10 } as unknown as AIProviderGenerateRequest;
    await assert.rejects(async () => {
      for await (const _ of adapter.generateStream!(req, CREDS)) { /* ne devrait rien Yielder */ }
    }, /erreur provider simulée/);
    const records = aiUsageTracker.getRecordsFor(tenant);
    const kinds = records.map((r) => r.kind);
    assert.deepEqual(kinds, ['START', 'ERROR'], 'exactement un terminal ERROR, jamais deux');
  });

  it('G: deux retries avec le même requestId → 2 START distincts (comptabilité exacte)', async () => {
    const tenant = 'tenant_attempt_g';
    let call = 0;
    const adapter = new MistralProviderAdapter(async () => {
      call += 1;
      if (call === 1) return errResponse(500); // attempt 1 → ERROR
      return okResponse(MISTRAL_OK);           // attempt 2 → SUCCESS
    });
    // Deux appels provider réels avec le MÊME requestId (= retry)
    await assert.rejects(adapter.generate(genRequest('req-G', 'premier essai', tenant), CREDS), /erreur provider simulée/);
    await adapter.generate(genRequest('req-G', 'deuxième essai', tenant), CREDS);

    const records = aiUsageTracker.getRecordsFor(tenant);
    const kinds = records.map((r) => r.kind);
    assert.deepEqual(kinds, ['START', 'ERROR', 'START', 'SUCCESS'],
      'retry = deux appels réels = deux dépenses potentielles = deux attempts');
    assert.ok(records.every((r) => r.requestId === 'req-G'), 'corrélation par requestId conservée');
  });

  it('anti-double-comptage: START/ERROR portent 0 — les totaux ne comptent que le réel', async () => {
    const tenant = 'tenant_attempt_ndc';
    const adapter = new MistralProviderAdapter(async () => okResponse(MISTRAL_OK));
    await adapter.generate(genRequest('req-NDC', 'test anti double comptage', tenant), CREDS);
    const summary = aiUsageTracker.getUsageSummary(tenant);
    // 1 appel = 2 événements, mais les totaux ne reflètent que la réponse réelle
    assert.equal(summary.totalTokens, 230, 'tokens comptés une seule fois');
    assert.ok(summary.totalCostUsd > 0 && summary.totalCostUsd < 1, 'coût réel compté une seule fois');
  });

  it('H: gemini — même sémantique (START/SUCCESS et START/ERROR)', async () => {
    const adapter = new GeminiProviderAdapter(async () => okResponse(GEMINI_OK));
    await adapter.generate(genRequest('req-H-ok', 'prompt gemini', 'tenant_attempt_h'), CREDS);
    const okRecords = aiUsageTracker.getRecordsFor('tenant_attempt_h').map((r) => r.kind);
    assert.deepEqual(okRecords, ['START', 'SUCCESS']);
    assert.ok(okRecords[0] === 'START');

    const adapterErr = new GeminiProviderAdapter(async () => errResponse(500));
    await assert.rejects(
      adapterErr.generate(genRequest('req-H-err', 'prompt gemini erreur', 'tenant_attempt_h_err'), CREDS),
      /erreur provider simulée/
    );
    const errRecords = aiUsageTracker.getRecordsFor('tenant_attempt_h_err').map((r) => r.kind);
    assert.deepEqual(errRecords, ['START', 'ERROR']);
  });
});
