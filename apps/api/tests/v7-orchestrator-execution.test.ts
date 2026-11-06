/**
 * V7-LOT6 — exécution sandbox/apply d'un run AINT-010 via HTTP.
 *
 * Le run d'analyse est persisté (comme un vrai run WAITING_HUMAN_APPROVAL),
 * puis :
 *  - POST .../preview passe réellement par AINT-006 en dry-run et n'écrit rien ;
 *  - POST .../apply exige confirm + accord de risque, écrit via AINT-006 et
 *    persiste le run COMPLETED avec son transactionId ;
 *  - un HTML invalide est bloqué par le préflight avant toute écriture ;
 *  - un run dégradé, déjà appliqué ou d'un autre tenant est refusé.
 *
 * Aucun provider IA n'est nécessaire : ces tests ciblent la couche d'exécution
 * des artefacts, pas la génération. La preuve live provider reste distincte.
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import {
  OrchestrationRunStore,
  orchestrationRunStore,
  isBrowserSandboxAvailable,
  type AgentArtifact,
  type OrchestrationRun
} from '../../../packages/core/src/index.js';

const TENANT = 'v7-orchestrator-execution';
const H = {
  'Content-Type': 'application/json',
  'x-tenant-id': TENANT,
  'x-user-role': 'ENGINEER'
};
const VIEWER_H = { ...H, 'x-user-role': 'VIEWER' };

const VALID_HTML = `<!DOCTYPE html>
<html lang="fr">
  <head><meta charset="utf-8"><title>Exécution V7</title></head>
  <body>
    <main>
      <h1>Exécution sandbox V7</h1>
      <p>Document candidat suffisamment long pour le préflight, écrit uniquement après confirmation humaine.</p>
      <button type="button" onclick="void 0">Action</button>
    </main>
  </body>
</html>
`;

function artifactFor(
  path: string,
  content: string,
  operation: 'CREATE' | 'UPDATE' = 'CREATE'
): AgentArtifact {
  return {
    id: `art-${path.replace(/[^a-z0-9]/gi, '-')}`,
    taskId: 'task-lot6-api',
    agentId: 'agent-ui-specialist',
    domain: 'UI',
    kind: 'PROPOSED_FILE_CHANGE',
    targetFiles: [path],
    payload: {
      filePath: path,
      operation,
      proposedContent: content,
      reason: 'Preuve API V7-LOT6'
    },
    confidence: 0.95,
    summary: `Artefact ${path}`,
    hash: createHash('sha256').update(content, 'utf8').digest('hex'),
    createdAt: new Date().toISOString()
  };
}

function runFor(
  orchestrationId: string,
  projectId: string,
  artifacts: readonly AgentArtifact[],
  overrides?: Partial<OrchestrationRun>
): OrchestrationRun {
  return {
    orchestrationId,
    tenantId: TENANT,
    projectId,
    planId: 'plan-lot6-api',
    state: 'WAITING_HUMAN_APPROVAL',
    taskGraph: {
      graphId: 'graph-lot6-api',
      planId: 'plan-lot6-api',
      tasks: [],
      rootTaskIds: [],
      graphHash: 'graph-hash-lot6-api',
      isAcyclic: true
    },
    completedTaskIds: [],
    artifacts,
    conflicts: [],
    traces: [],
    totalCostUsd: 0,
    totalTokens: 0,
    degradedCount: 0,
    repairCycles: 0,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides
  };
}

describe('V7-LOT6 — exécution sandbox/apply AINT-010 via HTTP', () => {
  let server: Server;
  let baseUrl: string;
  let projectId: string;

  before(async () => {
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
      body: JSON.stringify({ name: 'V7 LOT6 Orchestrateur exécutable' })
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

  it('1. preview : dry-run réel, aucune écriture, diffs et préflight restitués', async () => {
    const path = 'sandbox/lot6-preview.html';
    const run = runFor('orch-lot6preview01', projectId, [artifactFor(path, VALID_HTML)]);
    orchestrationRunStore.save(run);

    const res = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/preview`,
      { method: 'POST', headers: H }
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      dryRun: boolean;
      diffs: unknown[];
      preflight: Array<{ path: string; report: { passed: boolean; verdict: string; contentHash: string } }>;
      runtime: Array<{
        path: string;
        report: {
          verdict: string;
          passed: boolean;
          blocking: boolean;
          metrics: { domNodes: number; screenshotBytes: number };
          pageErrors: string[];
        };
      }>;
      runtimeSkipped: number;
      functionalTests: {
        verdict: string;
        blocking: boolean;
        total: number;
        passedCount: number;
        failedCount: number;
        warningCount: number;
        skippedCount: number;
        documents: Array<{
          path: string;
          report: {
            verdict: string;
            scenarios: Array<{ kind: string; status: string; message?: string }>;
          };
        }>;
      };
      transaction: { status: string; transactionId: string };
      appliedCount: number;
    };
    assert.equal(body.ok, true);
    assert.equal(body.dryRun, true);
    assert.equal(body.transaction.status, 'COMMITTED');
    assert.equal(body.diffs.length, 1);
    assert.equal(body.appliedCount, 1);
    assert.equal(body.preflight.length, 1);
    assert.equal(body.preflight[0]?.path, path);
    assert.equal(body.preflight[0]?.report.passed, true);
    assert.match(body.preflight[0]?.report.contentHash || '', /^[a-f0-9]{64}$/);
    assert.equal(body.runtime.length, 1);
    assert.equal(body.runtimeSkipped, 0);
    assert.equal(body.runtime[0]?.path, path);
    assert.equal(body.runtime[0]?.report.blocking, false);
    assert.ok(body.functionalTests, 'agrégat des tests fonctionnels attendu');
    assert.equal(body.functionalTests.blocking, false);
    if (await isBrowserSandboxAvailable()) {
      assert.notEqual(body.runtime[0]?.report.verdict, 'UNAVAILABLE');
      assert.ok((body.runtime[0]?.report.metrics.domNodes ?? 0) > 5);
      assert.ok((body.runtime[0]?.report.metrics.screenshotBytes ?? 0) > 0);
      assert.ok(
        body.functionalTests.verdict === 'PASS' || body.functionalTests.verdict === 'PASS_WITH_WARNINGS',
        body.functionalTests.verdict
      );
      assert.ok(body.functionalTests.total >= 3);
      assert.equal(body.functionalTests.documents.length, 1);
      assert.ok(body.functionalTests.documents[0]?.report.scenarios.some((scenario) =>
        scenario.kind === 'INTERACTION' && scenario.status === 'PASS'
      ));
    }

    const fileRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
      { headers: H }
    );
    assert.equal(fileRes.status, 404, 'le sandbox ne doit rien écrire');

    const detail = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}`,
      { headers: H }
    );
    assert.equal(detail.status, 200);
    const detailBody = (await detail.json()) as { run: { state: string; mutationTransactionId?: string } };
    assert.equal(detailBody.run.state, 'WAITING_HUMAN_APPROVAL');
    assert.equal(detailBody.run.mutationTransactionId, undefined);
  });

  it('2. apply sans confirmation : 409, aucune écriture', async () => {
    const path = 'sandbox/lot6-noconfirm.html';
    const run = runFor('orch-lot6noconfirm1', projectId, [artifactFor(path, VALID_HTML)]);
    orchestrationRunStore.save(run);

    const res = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/apply`,
      { method: 'POST', headers: H, body: JSON.stringify({}) }
    );
    assert.equal(res.status, 409);
    const body = (await res.json()) as { ok: boolean; code: string };
    assert.equal(body.ok, false);
    assert.equal(body.code, 'CONFIRMATION_REQUIRED');

    const fileRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
      { headers: H }
    );
    assert.equal(fileRes.status, 404);
  });

  it('3. apply confirmé : écriture réelle, run COMPLETED persisté, transaction tracée', async () => {
    const path = 'sandbox/lot6-applied.html';
    const run = runFor('orch-lot6applied001', projectId, [artifactFor(path, VALID_HTML)]);
    orchestrationRunStore.save(run);

    const res = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/apply`,
      {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ confirm: true, acceptRisk: true, acceptBreaking: true })
      }
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      dryRun: boolean;
      run: { state: string; mutationTransactionId?: string; traces: Array<{ event: string }> };
      transaction: { transactionId: string; status: string };
      diff: unknown;
      diffs: unknown[];
      appliedCount: number;
    };
    assert.equal(body.ok, true);
    assert.equal(body.dryRun, false);
    assert.equal(body.run.state, 'COMPLETED');
    assert.equal(body.run.mutationTransactionId, body.transaction.transactionId);
    assert.equal(body.transaction.status, 'COMMITTED');
    assert.equal(body.appliedCount, 1);
    assert.equal(body.diffs.length, 1);
    assert.ok(body.run.traces.some((trace) => trace.event.includes('Application confirmée')));

    const fileRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
      { headers: H }
    );
    assert.equal(fileRes.status, 200);
    const fileBody = (await fileRes.json()) as { file: { content: string; hash: string } };
    assert.equal(fileBody.file.content, VALID_HTML);

    const persisted = new OrchestrationRunStore({ persist: true }).get(
      TENANT,
      projectId,
      run.orchestrationId
    );
    assert.ok(persisted, 'le run appliqué doit survivre au redémarrage du store');
    assert.equal(persisted.state, 'COMPLETED');
    assert.equal(persisted.mutationTransactionId, body.transaction.transactionId);

    const replay = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/apply`,
      {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ confirm: true, acceptRisk: true, acceptBreaking: true })
      }
    );
    assert.equal(replay.status, 409);
    const replayBody = (await replay.json()) as { code: string };
    assert.equal(replayBody.code, 'RUN_ALREADY_EXECUTED');
  });

  it('4. HTML invalide : préflight 422 avant toute écriture', async () => {
    const path = 'sandbox/lot6-invalid.html';
    const invalid = '<div>trop court</div>';
    const run = runFor('orch-lot6invalid001', projectId, [artifactFor(path, invalid)]);
    orchestrationRunStore.save(run);

    const preview = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/preview`,
      { method: 'POST', headers: H }
    );
    assert.equal(preview.status, 422);
    const previewBody = (await preview.json()) as { ok: boolean; code: string; preflight: Array<{ report: { passed: boolean } }> };
    assert.equal(previewBody.ok, false);
    assert.equal(previewBody.code, 'PREFLIGHT_FAILED');
    assert.equal(previewBody.preflight[0]?.report.passed, false);

    const apply = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/apply`,
      { method: 'POST', headers: H, body: JSON.stringify({ confirm: true }) }
    );
    assert.equal(apply.status, 422);

    const fileRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
      { headers: H }
    );
    assert.equal(fileRes.status, 404, 'aucune écriture après un préflight FAIL');
  });

  it('5. run dégradé : 409 avant transaction', async () => {
    const path = 'sandbox/lot6-degraded.html';
    const run = runFor('orch-lot6degraded01', projectId, [artifactFor(path, VALID_HTML)], {
      degradedCount: 1
    });
    orchestrationRunStore.save(run);

    const res = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/preview`,
      { method: 'POST', headers: H }
    );
    assert.equal(res.status, 409);
    const body = (await res.json()) as { code: string };
    assert.equal(body.code, 'DEGRADED_ARTIFACTS');
  });

  it('6. RBAC : VIEWER peut sandboxer mais pas appliquer', async () => {
    const path = 'sandbox/lot6-rbac.html';
    const run = runFor('orch-lot6rbac000001', projectId, [artifactFor(path, VALID_HTML)]);
    orchestrationRunStore.save(run);

    const preview = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/preview`,
      { method: 'POST', headers: VIEWER_H }
    );
    assert.equal(preview.status, 200);

    const apply = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/apply`,
      { method: 'POST', headers: VIEWER_H, body: JSON.stringify({ confirm: true }) }
    );
    assert.equal(apply.status, 403);
  });

  it('7. isolation multi-tenant : run invisible et non applicable', async () => {
    const path = 'sandbox/lot6-tenant.html';
    const run = runFor('orch-lot6tenant00001', projectId, [artifactFor(path, VALID_HTML)]);
    orchestrationRunStore.save(run);
    const otherH = { ...H, 'x-tenant-id': 'v7-orchestrator-execution-other' };

    const preview = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/preview`,
      { method: 'POST', headers: otherH }
    );
    assert.equal(preview.status, 404);

    const apply = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/apply`,
      { method: 'POST', headers: otherH, body: JSON.stringify({ confirm: true }) }
    );
    assert.equal(apply.status, 404);
  });

  it('8. apply avec corps JSON non-objet : 400, aucune écriture', async () => {
    const path = 'sandbox/lot6-bad-body.html';
    const run = runFor('orch-lot6badbody001', projectId, [artifactFor(path, VALID_HTML)]);
    orchestrationRunStore.save(run);

    const res = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/apply`,
      { method: 'POST', headers: H, body: 'null' }
    );
    assert.equal(res.status, 400);
    const fileRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
      { headers: H }
    );
    assert.equal(fileRes.status, 404);
  });

  it('9. erreur JS : sandbox navigateur RUNTIME_FAILED 422, aucune écriture', async (t) => {
    if (!(await isBrowserSandboxAvailable())) {
      t.skip('Chromium/playwright-core indisponible sur cette machine');
      return;
    }
    const path = 'sandbox/lot7-js-error.html';
    const failingHtml = VALID_HTML.replace(
      '</main>',
      '</main><script>throw new Error("boom-api-lot7");</script>'
    );
    const run = runFor('orch-lot7jsfail0001', projectId, [artifactFor(path, failingHtml)]);
    orchestrationRunStore.save(run);

    const preview = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/preview`,
      { method: 'POST', headers: H }
    );
    assert.equal(preview.status, 422);
    const previewBody = (await preview.json()) as {
      ok: boolean;
      code: string;
      message: string;
      runtime: Array<{ report: { verdict: string; blocking: boolean; pageErrors: string[]; blockers: string[] } }>;
    };
    assert.equal(previewBody.ok, false);
    assert.equal(previewBody.code, 'RUNTIME_FAILED');
    assert.match(previewBody.message, /boom-api-lot7/);
    assert.equal(previewBody.runtime[0]?.report.verdict, 'FAIL');
    assert.equal(previewBody.runtime[0]?.report.blocking, true);
    assert.ok(previewBody.runtime[0]?.report.pageErrors.some((entry) => entry.includes('boom-api-lot7')));

    const fileRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
      { headers: H }
    );
    assert.equal(fileRes.status, 404, 'un échec runtime ne doit rien écrire');

    const apply = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/apply`,
      { method: 'POST', headers: H, body: JSON.stringify({ confirm: true }) }
    );
    assert.equal(apply.status, 422);
    const applyBody = (await apply.json()) as { code: string };
    assert.equal(applyBody.code, 'RUNTIME_FAILED');

    const afterApply = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
      { headers: H }
    );
    assert.equal(afterApply.status, 404);
  });

  it('10. erreur fonctionnelle au clic : FUNCTIONAL_TESTS_FAILED 422, aucune écriture', async (t) => {
    if (!(await isBrowserSandboxAvailable())) {
      t.skip('Chromium/playwright-core indisponible sur cette machine');
      return;
    }
    const path = 'sandbox/lot8-functional-error.html';
    const failingHtml = VALID_HTML.replace(
      'onclick="void 0"',
      'onclick="throw new Error(\'functional-api-boom\')"'
    );
    const run = runFor('orch-lot8apifail0001', projectId, [artifactFor(path, failingHtml)]);
    orchestrationRunStore.save(run);

    const preview = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/preview`,
      { method: 'POST', headers: H }
    );
    assert.equal(preview.status, 422);
    const previewBody = (await preview.json()) as {
      ok: boolean;
      code: string;
      message: string;
      runtime: Array<{ report: { verdict: string; blocking: boolean } }>;
      functionalTests: {
        verdict: string;
        blocking: boolean;
        failedCount: number;
        documents: Array<{ report: { scenarios: Array<{ status: string; message?: string }> } }>;
      };
    };
    assert.equal(previewBody.ok, false);
    assert.equal(previewBody.code, 'FUNCTIONAL_TESTS_FAILED');
    assert.match(previewBody.message, /functional-api-boom/);
    assert.equal(previewBody.runtime[0]?.report.verdict, 'PASS', 'le chargement runtime reste sain');
    assert.equal(previewBody.runtime[0]?.report.blocking, false);
    assert.equal(previewBody.functionalTests.verdict, 'FAIL');
    assert.equal(previewBody.functionalTests.blocking, true);
    assert.equal(previewBody.functionalTests.failedCount, 1);
    assert.ok(previewBody.functionalTests.documents[0]?.report.scenarios.some((scenario) =>
      scenario.status === 'FAIL' && /functional-api-boom/.test(scenario.message ?? '')
    ));

    const fileRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
      { headers: H }
    );
    assert.equal(fileRes.status, 404, 'un échec fonctionnel ne doit rien écrire');

    const apply = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${run.orchestrationId}/apply`,
      { method: 'POST', headers: H, body: JSON.stringify({ confirm: true }) }
    );
    assert.equal(apply.status, 422);
    const applyBody = (await apply.json()) as { code: string };
    assert.equal(applyBody.code, 'FUNCTIONAL_TESTS_FAILED');

    const afterApply = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
      { headers: H }
    );
    assert.equal(afterApply.status, 404);
  });

  it('11. le Studio expose les actions sandbox/appliquer et le verdict runtime', () => {
    const studio = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    assert.ok(studio.includes('/preview'), 'endpoint sandbox appelé par le Studio');
    assert.ok(studio.includes('/apply'), 'endpoint apply appelé par le Studio');
    assert.ok(studio.includes('Exécuter en sandbox'), 'action sandbox visible');
    assert.ok(studio.includes('Appliquer les changements'), 'action apply visible');
    assert.ok(studio.includes('aucune mutation (lecture seule)'), 'le libellé lecture seule reste pour les runs non exécutables');
    assert.ok(studio.includes('Sandbox navigateur'), 'le panneau expose le rapport runtime');
    assert.ok(studio.includes('orchestrationRuntimeRows'), 'les rapports runtime sont rendus dans le Studio');
    assert.ok(studio.includes('document(s) HTML non exécuté(s)'), 'la borne du sandbox est affichée');
    assert.ok(studio.includes('Tests fonctionnels générés (DOM)'), 'le panneau expose les tests fonctionnels');
    assert.ok(studio.includes('orchestrationFunctionalTestRows'), 'les tests fonctionnels sont rendus dans le Studio');
    assert.ok(studio.includes('data-orch-functional-tests'), 'le panneau fonctionnel est identifiable');
  });
});
