import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';
import { projectStore } from '../../../packages/core/src/identity/project.js';
import { fileStore } from '../../../packages/core/src/file-explorer/store.js';
import { auditStore } from '../../../packages/core/src/observability/audit.js';
import type {
  StrategyOptimizationReport,
  StrategicRecommendation,
  StrategicRoadmap,
  WhatIfComparison
} from '../../../packages/core/src/ai-native/strategy/types.js';

interface StrategyApiResponse {
  readonly success: boolean;
  readonly report?: StrategyOptimizationReport;
  readonly totalCount?: number;
  readonly topPriorities?: readonly StrategicRecommendation[];
  readonly recommendations?: readonly StrategicRecommendation[];
  readonly recommendation?: StrategicRecommendation;
  readonly provenanceTrace?: unknown;
  readonly whyExplanation?: string;
  readonly roadmap?: StrategicRoadmap;
  readonly roadmapSummary?: string;
  readonly whatIfAnalysis?: WhatIfComparison;
  readonly alternativesSummary?: string;
  readonly chatOverview?: string;
  readonly prioritiesSummary?: string;
  readonly result?: unknown;
  readonly requestId?: string;
}

describe('AINT-016 : AI Strategy Optimizer HTTP API Tests', () => {
  let server: Server;
  let baseUrl: string;
  const tenantId = 'tenant_strategy_api_01';
  let projectId: string;

  const sampleFeedbackReport = {
    tenantId,
    projectId: '',
    problems: [
      {
        id: 'PRB-001',
        title: 'Crash au chargement du panier',
        description: 'Exception non gérée sur page de paiement',
        severity: 'CRITICAL' as const,
        status: 'CONFIRMED' as const,
        category: 'CRASH' as const,
        cluster: { id: 'cl-1', label: 'Checkout crash', size: 12, representativeSnippet: 'cart.ts' },
        impact: {
          affectedUsersCount: 450,
          frequencyPerHour: 15,
          frustrationScore: 92,
          isRegression: true,
          isBlocker: true,
          businessImpact: 'Perte directe de chiffre d affaires'
        },
        reproducibility: { score: 95, confidence: 'HIGH' as const, pattern: 'Systématique' },
        evidence: [],
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        provenance: []
      }
    ],
    qualityScore: 40,
    generatedAt: new Date().toISOString(),
    hash: 'hash-feedback-1'
  };

  const sampleFeatureReport = {
    tenantId,
    projectId: '',
    opportunities: [
      {
        id: 'OPP-001',
        title: 'Authentification Passkey sans mot de passe',
        description: 'Support FIDO2 / WebAuthn pour connexion sécurisée',
        category: 'SECURITY' as const,
        status: 'FEASIBLE' as const,
        impactScore: 85,
        effortScore: 40,
        confidenceScore: 90,
        strategicAlignment: 95,
        targetAudience: 'Tous les utilisateurs',
        dependencies: [],
        evidence: [],
        createdAt: new Date().toISOString()
      }
    ],
    generatedAt: new Date().toISOString(),
    hash: 'hash-feat-1'
  };

  const sampleAuditReport = {
    tenantId,
    projectId: '',
    overallScore: 68,
    scores: {
      security: 70,
      performance: 65,
      reliability: 60,
      maintainability: 75,
      accessibility: 70
    },
    findings: [
      {
        id: 'FND-001',
        dimension: 'security' as const,
        severity: 'HIGH' as const,
        title: 'Dépendance obsolète critique',
        description: 'CVE critique détectée dans express-jwt',
        location: { filePath: 'package.json', startLine: 15, endLine: 15 }
      }
    ],
    recommendations: [],
    analyzedFilesCount: 25,
    generatedAt: new Date().toISOString()
  };

  before(async () => {
    projectStore.clear();
    fileStore.clear();
    auditStore.clear();

    const proj = projectStore.createProject(tenantId, 'Projet Strategy API Test');
    projectId = proj.id;
    fileStore.initializeStandardTree(tenantId, projectId);

    sampleFeedbackReport.projectId = projectId;
    sampleFeatureReport.projectId = projectId;
    sampleAuditReport.projectId = projectId;

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

  it('1. POST /api/v1/projects/:projectId/strategy/analyze : optimise la stratégie et renvoie le rapport complet', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/strategy/analyze`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'ENGINEER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        feedbackReport: sampleFeedbackReport,
        featureReport: sampleFeatureReport,
        auditReport: sampleAuditReport
      })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as StrategyApiResponse;
    assert.equal(body.success, true);
    assert.ok(body.report);
    assert.equal(body.report.tenantId, tenantId);
    assert.equal(body.report.projectId, projectId);
    assert.ok(body.report.allRecommendations.length > 0);
    assert.ok(body.report.topPriorities.length > 0);
    assert.ok(body.chatOverview?.includes('Situation Stratégique Actuelle'));
  });

  it('2. GET /api/v1/projects/:projectId/strategy : renvoie le rapport stratégique en cache', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/strategy`, {
      method: 'GET',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as StrategyApiResponse;
    assert.equal(body.success, true);
    assert.ok(body.report);
    assert.ok(body.report.allRecommendations.length > 0);
    assert.ok(typeof body.report.overallStrategicScore === 'number');
  });

  it('3. GET /api/v1/projects/:projectId/strategy/recommendations : liste toutes les recommandations et priorités', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/strategy/recommendations`, {
      method: 'GET',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as StrategyApiResponse;
    assert.equal(body.success, true);
    assert.ok((body.totalCount ?? 0) > 0);
    assert.ok(body.recommendations && body.recommendations.length > 0);
    assert.ok(body.topPriorities && body.topPriorities.length > 0);
    assert.ok(body.prioritiesSummary?.includes('Top Priorités Stratégiques'));
  });

  it('4. GET /api/v1/projects/:projectId/strategy/recommendations/:recId : détail avec provenance et explication Pourquoi', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/strategy/recommendations`, {
      headers: { 'x-tenant-id': tenantId, 'x-user-role': 'VIEWER' }
    });
    const listBody = (await listRes.json()) as StrategyApiResponse;
    const firstRec = listBody.recommendations?.[0];
    assert.ok(firstRec);
    const firstId = firstRec.id;

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/strategy/recommendations/${firstId}`, {
      method: 'GET',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as StrategyApiResponse;
    assert.equal(body.success, true);
    assert.equal(body.recommendation?.id, firstId);
    assert.ok(body.provenanceTrace);
    assert.ok(body.whyExplanation?.includes('Justification Déterministe'));
  });

  it('5. POST /api/v1/projects/:projectId/strategy/recommendations/:recId/approve : approuve une recommandation', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/strategy/recommendations`, {
      headers: { 'x-tenant-id': tenantId, 'x-user-role': 'VIEWER' }
    });
    const listBody = (await listRes.json()) as StrategyApiResponse;
    const firstRec = listBody.recommendations?.[0];
    assert.ok(firstRec);
    const firstId = firstRec.id;

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/strategy/recommendations/${firstId}/approve`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'OWNER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        reason: 'Validé pour le sprint courant'
      })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as StrategyApiResponse;
    assert.equal(body.success, true);
    assert.ok(body.result);
  });

  it('6. POST /api/v1/projects/:projectId/strategy/recommendations/:recId/reject : rejette une recommandation', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/strategy/recommendations`, {
      headers: { 'x-tenant-id': tenantId, 'x-user-role': 'VIEWER' }
    });
    const listBody = (await listRes.json()) as StrategyApiResponse;
    const secondRec = listBody.recommendations?.[1] || listBody.recommendations?.[0];
    assert.ok(secondRec);
    const targetId = secondRec.id;

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/strategy/recommendations/${targetId}/reject`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'ADMIN',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        reason: 'Hors scope du trimestre'
      })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as StrategyApiResponse;
    assert.equal(body.success, true);
    assert.ok(body.result);
  });

  it('7. POST /api/v1/projects/:projectId/strategy/roadmap : renvoie la roadmap topologique multi-horizons', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/strategy/roadmap`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as StrategyApiResponse;
    assert.equal(body.success, true);
    assert.ok(body.roadmap);
    assert.ok(body.roadmap.horizons.now);
    assert.ok(body.roadmap.horizons.next);
    assert.ok(body.roadmapSummary?.includes('Roadmap Stratégique'));
  });

  it('8. POST /api/v1/projects/:projectId/strategy/compare : renvoie la matrice What-If des alternatives', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/strategy/compare`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as StrategyApiResponse;
    assert.equal(body.success, true);
    assert.ok(body.whatIfAnalysis);
    assert.ok(body.alternativesSummary?.includes('Comparaison des Scénarios Stratégiques'));
  });

  it('9. Sécurité & Multi-Tenant : doit refuser l accès si le projet appartient à un autre tenant (404)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/strategy`, {
      method: 'GET',
      headers: {
        'x-tenant-id': 'tenant_intruder',
        'x-user-role': 'VIEWER'
      }
    });

    assert.equal(res.status, 404);
  });

  it('10. RBAC : un VIEWER ne peut pas approuver une recommandation (403 Forbidden)', async () => {
    const listRes = await fetch(`${baseUrl}/api/v1/projects/${projectId}/strategy/recommendations`, {
      headers: { 'x-tenant-id': tenantId, 'x-user-role': 'VIEWER' }
    });
    const listBody = (await listRes.json()) as StrategyApiResponse;
    const firstRec = listBody.recommendations?.[0];
    assert.ok(firstRec);
    const firstId = firstRec.id;

    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/strategy/recommendations/${firstId}/approve`, {
      method: 'POST',
      headers: {
        'x-tenant-id': tenantId,
        'x-user-role': 'VIEWER',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        reason: 'Tentative illicite'
      })
    });

    assert.equal(res.status, 403);
  });
});
