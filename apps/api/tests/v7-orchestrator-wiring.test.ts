/**
 * V7-WIRE-5 — AI Orchestrator (AINT-010) branché sur le produit.
 *
 * Avant : `/orchestrate` était montée et testée isolément, mais aucun flux
 * produit ne l'appelait. Désormais :
 *  - la carte de plan du Studio lance l'analyse multi-agents à la demande ;
 *  - la route force `autoMutateIfLowRisk=false` (lecture seule) ;
 *  - le run complet est persisté et relisible via `/orchestrations` ;
 *  - la lecture reste isolée par tenant + projet.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { OrchestrationRunStore } from '../../../packages/core/src/index.js';

const TENANT = 'v7-orchestrator-wire';
const H = {
  'Content-Type': 'application/json',
  'x-tenant-id': TENANT,
  'x-user-role': 'ENGINEER'
};

describe('V7-WIRE-5 — AI Orchestrator AINT-010 dans le flux produit', () => {
  let server: Server;
  let baseUrl: string;
  let projectId: string;
  let firstRunId = '';

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
      body: JSON.stringify({ name: 'V7 WIRE-5 Orchestrateur' })
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

  function buildPlan() {
    return {
      planId: 'plan-v7-orch-wire-1',
      title: 'Panneau de synthèse et tests',
      summary: 'Créer un panneau de synthèse puis vérifier les régressions',
      planHash: 'hash-v7-orch-wire-1',
      status: 'APPROVED',
      steps: [
        {
          stepIndex: 0,
          title: 'Panneau de synthèse',
          description: 'Créer le composant de synthèse dans index.html',
          targetDomain: 'UI',
          targetFiles: ['index.html'],
          operation: 'CREATE',
          requiresApproval: false
        },
        {
          stepIndex: 1,
          title: 'Vérification des régressions',
          description: 'Contrôler le rendu et produire la suite de tests',
          targetDomain: 'TEST',
          targetFiles: ['tests/summary.test.ts'],
          operation: 'VERIFY',
          requiresApproval: false
        }
      ]
    };
  }

  it('1. POST /orchestrate : run réel en revue humaine, aucun fichier muté, run persisté', async () => {
    // Un projet neuf peut déjà contenir un index.html de départ : la preuve
    // d'absence de mutation est une comparaison avant/après, pas un 404 naïf.
    const beforeRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent('index.html')}`,
      { headers: H }
    );
    const beforeStatus = beforeRes.status;
    const beforeFile = beforeStatus === 200
      ? ((await beforeRes.json()) as { file: { content: string; hash: string } }).file
      : null;

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/orchestrate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ plan: buildPlan() })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      run: {
        orchestrationId: string;
        state: string;
        planId: string;
        completedTaskIds: string[];
        artifacts: unknown[];
        traces: unknown[];
        totalTokens: number;
        mutationTransactionId?: string;
      };
    };
    const run = body.run;
    firstRunId = run.orchestrationId;
    assert.match(run.orchestrationId, /^orch-[a-f0-9]{12}$/);
    assert.equal(run.state, 'WAITING_HUMAN_APPROVAL');
    assert.equal(run.mutationTransactionId, undefined, 'aucune mutation transactionnelle');
    assert.ok(run.completedTaskIds.length >= 1, 'au moins une tâche exécutée');
    assert.ok(run.artifacts.length >= 1, 'au moins un artefact réel');
    assert.ok(run.traces.length >= 3, 'la machine à états est tracée');
    assert.ok(Number.isFinite(run.totalTokens) && run.totalTokens >= 0);

    // La cible du plan n'a pas été écrite (autoMutateIfLowRisk=false).
    const afterRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent('index.html')}`,
      { headers: H }
    );
    assert.equal(afterRes.status, beforeStatus, 'le statut de index.html ne doit pas changer');
    if (beforeStatus === 200 && beforeFile) {
      const afterFile = ((await afterRes.json()) as { file: { content: string; hash: string } }).file;
      assert.equal(afterFile.hash, beforeFile.hash, 'le hash de index.html doit être identique');
      assert.equal(afterFile.content, beforeFile.content, 'le contenu de index.html doit être identique');
    }
    const newTargetRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent('tests/summary.test.ts')}`,
      { headers: H }
    );
    assert.equal(newTargetRes.status, 404, 'la cible de test ne doit pas être créée');

    // Persistance réelle : une NOUVELLE instance du store relit le run.
    const freshStore = new OrchestrationRunStore({ persist: true });
    const persisted = freshStore.get(TENANT, projectId, run.orchestrationId);
    assert.ok(persisted, 'le run doit survivre dans le store persistant');
    assert.equal(persisted.state, 'WAITING_HUMAN_APPROVAL');
    assert.equal(persisted.planId, 'plan-v7-orch-wire-1');
  });

  it('2. GET /orchestrations + /orchestrate/:id : historique et détail relus depuis le store', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/orchestrations?limit=10`, { headers: H });
    assert.equal(listRes.status, 200);
    const list = (await listRes.json()) as {
      items: { orchestrationId: string; state: string; artifacts: unknown[] }[];
      count: number;
    };
    assert.ok(list.items.length >= 1);
    assert.equal(list.count, list.items.length);
    const first = list.items[0];
    assert.ok(first);

    const detailRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${encodeURIComponent(first.orchestrationId)}`,
      { headers: H }
    );
    assert.equal(detailRes.status, 200);
    const detail = (await detailRes.json()) as { run: { orchestrationId: string; artifacts: unknown[] } };
    assert.equal(detail.run.orchestrationId, first.orchestrationId);
    assert.ok(detail.run.artifacts.length >= 1);
  });

  it('3. isolation multi-tenant : un autre tenant ne voit ni le détail ni l’historique', async () => {
    const otherH = { ...H, 'x-tenant-id': 'v7-orchestrator-other' };
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/orchestrations?limit=10`, { headers: otherH });
    assert.equal(listRes.status, 200);
    const list = (await listRes.json()) as { items: unknown[] };
    assert.equal(list.items.length, 0);

    const detailRes = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/${encodeURIComponent(firstRunId)}`,
      { headers: otherH }
    );
    assert.equal(detailRes.status, 404);
  });

  it('4. GET détail inconnu → 404', async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/orchestrate/orch-000000000000`,
      { headers: H }
    );
    assert.equal(res.status, 404);
  });

  it('5. le Studio appelle /orchestrate et rend le résultat réel (pas un appel ignoré)', () => {
    const studio = readFileSync(resolve(process.cwd(), 'apps/studio/index.html'), 'utf8');
    assert.ok(studio.includes("'/orchestrate'"), 'endpoint AINT-010 appelé');
    assert.ok(studio.includes('Analyser avec les agents'), 'action produit explicite dans la carte de plan');
    assert.ok(studio.includes('runPlanOrchestration'), 'handler dédié présent');
    assert.ok(studio.includes('orchestrationRunDetailsHtml'), 'le run réel est rendu');
    assert.ok(studio.includes('completedTaskIds'), 'les tâches exécutées sont affichées');
    assert.ok(studio.includes('artifacts.length'), 'les artefacts sont affichés');
    assert.ok(studio.includes('aucune mutation (lecture seule)'), 'la lecture seule est explicite');
    assert.ok(studio.includes('aint-010-orchestration-'), 'l’export restitue le run AINT-010');
    assert.ok(studio.includes('/orchestrations?limit=10'), 'l’historique persistant est consultable');
    assert.ok(studio.includes('GET /orchestrations'), 'la provenance persistante est nommée');
  });
});
