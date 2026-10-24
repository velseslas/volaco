/**
 * V7-LOT6 — Preuve de bout en bout du parcours AINT-010 :
 *   /orchestrate (faux provider Mistral en mémoire)
 *     -> run WAITING_HUMAN_APPROVAL, artefacts réels non dégradés
 *     -> /preview (AINT-006 dry-run, aucune écriture, aucun faux commit)
 *     -> /apply confirmé (écriture réelle, hash identique, run COMPLETED)
 *
 * Aucun réseau, aucune clé réelle : l'adaptateur Mistral est un faux local.
 * Cette preuve ne remplace pas une génération avec un vrai provider ; elle
 * prouve le chaînage exécutable et l'honnêteté de l'audit.
 */

process.env.MISTRAL_API_KEY = 'fake-key-lot6-provider';
process.env.VOLACO_EXECUTION_TIMELINE = 'off';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { aiProviderRegistry } from '../../../packages/core/src/ai/providers/registry.js';
import type {
  AIProviderGenerateRequest,
  AIProviderGenerateResponse
} from '../../../packages/core/src/ai/providers/types.js';
import {
  auditStore,
  orchestrationRunStore,
  type AgentArtifact,
  type OrchestrationRun
} from '../../../packages/core/src/index.js';

const TENANT = 'v7-orchestrator-provider-execution';
const H = {
  'Content-Type': 'application/json',
  'x-tenant-id': TENANT,
  'x-user-role': 'ENGINEER'
};

const VALID_HTML = `<!DOCTYPE html>
<html lang="fr">
  <head><meta charset="utf-8"><title>Provider sandbox V7</title></head>
  <body>
    <main>
      <h1>Génération réelle par provider factice</h1>
      <p>Ce contenu a traversé l'orchestrateur, la sandbox dry-run puis l'application transactionnelle AINT-006.</p>
    </main>
  </body>
</html>
`;

class FakeMistralAdapter {
  public readonly descriptor = {
    providerId: 'mistral',
    providerName: 'Fake Mistral (V7-LOT6)',
    models: ['codestral-latest'],
    capabilities: [
      'FAST',
      'CODE_GENERATION',
      'STRUCTURED_OUTPUT',
      'STREAMING',
      'TOOL_CALLING'
    ] as const,
    contextWindow: 128000,
    structuredOutput: true,
    streaming: true,
    toolCalling: true,
    reasoning: false,
    vision: false,
    costMetadata: {},
    availability: 'AVAILABLE' as const,
    healthStatus: 'HEALTHY' as const
  };

  public calls = 0;

  public async generate(_request: AIProviderGenerateRequest): Promise<AIProviderGenerateResponse> {
    this.calls += 1;
    return {
      text: VALID_HTML,
      providerId: 'mistral',
      modelId: 'codestral-latest',
      latencyMs: 1,
      usage: { inputTokens: 20, outputTokens: 30, totalTokens: 50 },
      costUsd: 0.0001
    };
  }

  public async *generateStream(): AsyncGenerator<string> {
    yield VALID_HTML;
  }
}

function eventForRequest(action: string, requestId: string) {
  return auditStore.query(TENANT, { action }).filter((event) => event.requestId === requestId);
}

describe('V7-LOT6 — provider factice : orchestrer, sandboxer, appliquer', () => {
  let server: Server;
  let baseUrl: string;
  let projectId: string;
  let orchestrationId: string;
  let artifact: AgentArtifact | undefined;
  const adapter = new FakeMistralAdapter();

  before(async () => {
    aiProviderRegistry.register(
      adapter as unknown as Parameters<typeof aiProviderRegistry.register>[0]
    );
    const { createApiServer } = await import('../src/server.js');
    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolveListen) => {
      server.listen(0, () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolveListen();
      });
    });
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name: 'V7 LOT6 Provider Proof' })
    });
    assert.ok([200, 201].includes(res.status));
    const body = (await res.json()) as { project: { id: string } };
    projectId = body.project.id;
  });

  after(async () => {
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
    });
  });

  it('1. /orchestrate avec faux provider : run WAITING non dégradé, aucun fichier écrit', async () => {
    const plan = {
      planId: 'plan-lot6-provider',
      title: 'Page de preuve sandbox',
      summary: 'Générer une page HTML puis la sandboxer',
      planHash: 'hash-lot6-provider',
      status: 'APPROVED',
      steps: [
        {
          stepIndex: 0,
          title: 'Page HTML de preuve',
          description: 'Créer une page HTML valide pour la preuve sandbox',
          targetDomain: 'UI',
          targetFiles: ['sandbox/lot6-provider.html'],
          operation: 'CREATE',
          requiresApproval: false
        }
      ]
    };
    const intent = {
      category: 'CREATE',
      goal: 'Page HTML de preuve',
      requestedAction: 'Créer la page',
      entities: ['Page'],
      constraints: [],
      urgency: 'NORMAL',
      confidence: 0.95,
      ambiguities: []
    };

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/orchestrate`, {
      method: 'POST',
      headers: { ...H, 'x-request-id': 'req-lot6-provider-orchestrate' },
      body: JSON.stringify({ plan, intent })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { run: OrchestrationRun };
    const run = body.run;
    orchestrationId = run.orchestrationId;

    assert.equal(run.state, 'WAITING_HUMAN_APPROVAL');
    assert.equal(run.degradedCount, 0, 'le faux provider ne doit pas être dégradé');
    assert.ok(run.totalTokens > 0, 'les tokens du provider sont comptabilisés');
    assert.ok(adapter.calls >= 1, 'le faux provider a réellement été appelé');

    artifact = run.artifacts.find((item) => item.kind === 'PROPOSED_FILE_CHANGE');
    assert.ok(artifact, 'un artefact fichier a été produit');
    const payload = artifact.payload as { filePath: string; proposedContent: string };
    assert.equal(payload.filePath, 'sandbox/lot6-provider.html');
    assert.equal(payload.proposedContent, VALID_HTML, 'le contenu vient du provider');

    const fileRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent('sandbox/lot6-provider.html')}`,
      { headers: H }
    );
    assert.equal(fileRes.status, 404, 'aucune écriture pendant l’analyse');
  });

  it('2. /preview : dry-run, préflight PASS, aucun commit audit, fichier inchangé', async () => {
    assert.ok(orchestrationId);
    const previewRequestId = 'req-lot6-provider-preview';
    const res = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${orchestrationId}/preview`,
      { method: 'POST', headers: { ...H, 'x-request-id': previewRequestId } }
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      dryRun: boolean;
      appliedCount: number;
      preflight: Array<{ report: { passed: boolean; contentHash: string; verdict: string } }>;
      runtime: Array<{ report: { blocking: boolean; verdict: string } }>;
      transaction: { status: string };
      diffs: unknown[];
    };
    assert.equal(body.ok, true);
    assert.equal(body.dryRun, true);
    assert.equal(body.transaction.status, 'COMMITTED');
    assert.equal(body.appliedCount, 1);
    assert.equal(body.diffs.length, 1);
    assert.equal(body.preflight[0]?.report.passed, true);
    assert.equal(body.preflight[0]?.report.verdict, 'PASS');
    assert.equal(body.runtime.length, 1);
    assert.equal(body.runtime[0]?.report.blocking, false);

    const contentHash = createHash('sha256').update(VALID_HTML, 'utf8').digest('hex');
    assert.equal(body.preflight[0]?.report.contentHash, contentHash);

    const fileRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent('sandbox/lot6-provider.html')}`,
      { headers: H }
    );
    assert.equal(fileRes.status, 404, 'le dry-run ne doit pas écrire');

    const started = eventForRequest('MUTATION_STARTED', previewRequestId);
    assert.ok(started.length >= 1, 'le dry-run est audité comme démarré');
    assert.equal(started[0]?.metadata?.dryRun, true);
    assert.equal(
      eventForRequest('MUTATION_COMMITTED', previewRequestId).length,
      0,
      'aucun faux MUTATION_COMMITTED pendant le dry-run'
    );

    const run = orchestrationRunStore.get(TENANT, projectId, orchestrationId);
    assert.equal(run?.state, 'WAITING_HUMAN_APPROVAL', 'le run reste en revue après preview');
    assert.equal(run?.mutationTransactionId, undefined);
  });

  it('3. /apply confirmé : écriture réelle, hash identique, run COMPLETED et audit honnête', async () => {
    assert.ok(orchestrationId);
    const applyRequestId = 'req-lot6-provider-apply';
    const res = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${orchestrationId}/apply`,
      {
        method: 'POST',
        headers: { ...H, 'x-request-id': applyRequestId },
        body: JSON.stringify({ confirm: true, acceptRisk: true, acceptBreaking: true })
      }
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      dryRun: boolean;
      run: OrchestrationRun;
      transaction: { transactionId: string; status: string };
      preflight: Array<{ report: { contentHash: string; passed: boolean } }>;
      runtime: Array<{ report: { blocking: boolean; verdict: string } }>;
      diffs: unknown[];
    };
    assert.equal(body.ok, true);
    assert.equal(body.dryRun, false);
    assert.equal(body.run.state, 'COMPLETED');
    assert.equal(body.run.mutationTransactionId, body.transaction.transactionId);
    assert.equal(body.transaction.status, 'COMMITTED');
    assert.equal(body.preflight[0]?.report.passed, true);
    assert.equal(body.runtime[0]?.report.blocking, false);
    assert.equal(body.diffs.length, 1);

    const fileRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent('sandbox/lot6-provider.html')}`,
      { headers: H }
    );
    assert.equal(fileRes.status, 200);
    const fileBody = (await fileRes.json()) as { file: { content: string } };
    assert.equal(fileBody.file.content, VALID_HTML);
    const actualHash = createHash('sha256').update(fileBody.file.content, 'utf8').digest('hex');
    assert.equal(actualHash, body.preflight[0]?.report.contentHash, 'hash écrit = hash préflighté');

    const committed = eventForRequest('MUTATION_COMMITTED', applyRequestId);
    assert.equal(committed.length, 1, 'un vrai commit est audité une seule fois');
    assert.equal(committed[0]?.resourceId, body.transaction.transactionId);
    assert.equal(eventForRequest('MUTATION_COMMITTED', 'req-lot6-provider-preview').length, 0);

    const persisted = orchestrationRunStore.get(TENANT, projectId, orchestrationId);
    assert.equal(persisted?.state, 'COMPLETED');
    assert.equal(persisted?.mutationTransactionId, body.transaction.transactionId);
  });
});
