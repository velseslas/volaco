import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';
import { fileStore } from '../../../packages/core/src/file-explorer/store.js';
import { auditStore } from '../../../packages/core/src/observability/audit.js';
import type {
  AggregatedProblem,
  ProposedRemediationPlan,
  UserFeedbackReport
} from '../../../packages/core/src/ai-native/user-feedback/types.js';

interface FeedbackApiResponse {
  readonly success: boolean;
  readonly report?: UserFeedbackReport;
  readonly problem?: AggregatedProblem;
  readonly plan?: ProposedRemediationPlan;
  readonly conversationSummary?: string;
  readonly conversationDetail?: string;
  readonly requestId?: string;
}

describe('AINT-015 : User Feedback & Bug Intelligence HTTP API Tests', () => {
  let server: Server;
  let baseUrl: string;
  const tenantId = 'tenant_feedback_api_01';
  let projectId: string;

  before(async () => {
    projectStore.clear();
    fileStore.clear();
    auditStore.clear();

    const proj = projectStore.createProject(tenantId, 'Projet User Feedback API Test');
    projectId = proj.id;
    fileStore.initializeStandardTree(tenantId, projectId);

    const instance = createApiServer({ port: 0 });
    server = instance.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    projectStore.clear();
    fileStore.clear();
    auditStore.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. POST /api/v1/projects/:projectId/feedback/analyze : doit analyser les signaux et renvoyer le rapport', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/feedback/analyze`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        rawFeedbacks: [
          'Le bouton de validation plante complètement au clic !',
          'Impossible de soumettre le formulaire après la mise à jour'
        ]
      })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as FeedbackApiResponse;
    assert.equal(body.success, true);
    assert.ok(body.report);
    assert.equal(body.report.tenantId, tenantId);
    assert.equal(body.report.projectId, projectId);
    assert.ok(body.report.problems.length > 0);
    assert.ok(body.conversationSummary?.includes('Rapport d\'Intelligence Retours & Bugs'));
  });

  it('2. GET /api/v1/projects/:projectId/feedback : doit renvoyer le rapport de feedback', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/feedback`, {
      method: 'GET',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as FeedbackApiResponse;
    assert.equal(body.success, true);
    assert.ok(body.report);
    assert.ok(body.report.problems.length > 0);
  });

  it('3. GET /api/v1/projects/:projectId/feedback/:problemId : doit renvoyer le détail d une anomalie', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/feedback`, {
      headers: { 'x-tenant-id': tenantId, 'x-user-role': 'VIEWER' }
    });
    const listBody = (await listRes.json()) as FeedbackApiResponse;
    const firstProblem = listBody.report?.problems[0];
    assert.ok(firstProblem);
    const firstId = firstProblem.id;

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/feedback/${firstId}`, {
      method: 'GET',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as FeedbackApiResponse;
    assert.equal(body.success, true);
    assert.equal(body.problem?.id, firstId);
    assert.ok(body.conversationDetail?.includes('Détail de l\'Anomalie'));
  });

  it('4. POST /api/v1/projects/:projectId/feedback/:problemId/lifecycle : doit faire évoluer le statut', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/feedback`, {
      headers: { 'x-tenant-id': tenantId, 'x-user-role': 'VIEWER' }
    });
    const listBody = (await listRes.json()) as FeedbackApiResponse;
    const firstId = listBody.report?.problems[0]?.id;
    assert.ok(firstId);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/feedback/${firstId}/lifecycle`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        newStatus: 'PLANNED',
        reason: 'Planifié pour correction par l équipe'
      })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as FeedbackApiResponse;
    assert.equal(body.success, true);
    assert.equal(body.problem?.status, 'PLANNED');
  });

  it('5. POST /api/v1/projects/:projectId/feedback/:problemId/plan : doit générer un plan de remédiation AINT-010', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/feedback`, {
      headers: { 'x-tenant-id': tenantId, 'x-user-role': 'VIEWER' }
    });
    const listBody = (await listRes.json()) as FeedbackApiResponse;
    const firstId = listBody.report?.problems[0]?.id;
    assert.ok(firstId);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/feedback/${firstId}/plan`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as FeedbackApiResponse;
    assert.equal(body.success, true);
    assert.ok(body.plan);
    assert.equal(body.plan.problemId, firstId);
    assert.equal(body.plan.taskGraph.tasks.length, 3);
    assert.equal(body.plan.taskGraph.tasks[0]?.operation, 'ANALYZE');
    assert.equal(body.plan.taskGraph.tasks[1]?.operation, 'MODIFY');
    assert.equal(body.plan.taskGraph.tasks[2]?.operation, 'VERIFY');
  });

  it('6. POST /api/v1/feedback/analyze : doit analyser directement in-memory sans projet préalable', async () => {
    const res = await fetch(`${baseUrl}/api/v1/feedback/analyze`, {
      method: 'POST',
      headers: {
        'x-tenant-id': 'tenant-direct',
        'x-user-role': 'VIEWER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        rawFeedbacks: [
          'Le bouton de recherche ne filtre pas correctement les résultats',
          'Recherche inopérante sur mobile'
        ]
      })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as FeedbackApiResponse;
    assert.equal(body.success, true);
    assert.ok(body.report);
    assert.ok(body.report.problems.length > 0);
  });

  it('7. Sécurité & Multi-Tenant : doit refuser l accès si le projet appartient à un autre tenant (404)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/feedback`, {
      method: 'GET',
      headers: {
        'x-tenant-id': 'tenant_intruder',
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 404);
  });

  it('8. RBAC : un VIEWER ne peut pas exécuter de transition de cycle de vie (403)', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/feedback`, {
      headers: { 'x-tenant-id': tenantId, 'x-user-role': 'VIEWER' }
    });
    const listBody = (await listRes.json()) as FeedbackApiResponse;
    const firstId = listBody.report?.problems[0]?.id;
    assert.ok(firstId);

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/feedback/${firstId}/lifecycle`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        newStatus: 'RESOLVED'
      })
    });

    assert.equal(res.status, 403);
  });
});
