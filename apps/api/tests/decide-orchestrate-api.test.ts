/**
 * Tests Lot 1 — routes Decision Engine (/decide) et AI Orchestrator (/orchestrate)
 *
 * Avant correctif : ces deux routes existaient (écrites, documentées, leurs
 * services testés unitairement) mais n'étaient NI configurées NI montées dans
 * server.ts — inaccessibles via HTTP. Le présent test garantit qu'elles sont
 * branchées et répondent avec des objets structurés.
 */

import './_lot-b-legacy-env.js';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../src/server.js';

const H = { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'ENGINEER' };

describe('Lot 1 : routes decide + orchestrate accessibles via HTTP', () => {
  let server: Server;
  let baseUrl: string;
  let projectId: string;

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
    // Crée un projet réel (les routes exigent un projet existant)
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ name: 'Lot1 Decide Orchestrate' })
    });
    projectId = ((await res.json()) as { project: { id: string } }).project.id;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. POST /decide renvoie une décision structurée avec recommendations et nextState', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/decide`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ message: 'Ajoute une page de contact au site' })
    });
    assert.equal(res.status, 200, 'La route /decide doit être montée et fonctionnelle');
    const body = (await res.json()) as {
      decision: { verdict: string; decisionId: string; alternatives: unknown[] };
      recommendations: unknown[];
      nextState: string;
      reasoningTrace: string[];
    };
    assert.ok(body.decision, 'decision obligatoire');
    assert.ok(body.decision.decisionId);
    assert.ok(['READY', 'NEEDS_CONFIRMATION', 'BLOCKED', 'DEFERRED'].includes(body.decision.verdict));
    assert.ok(Array.isArray(body.recommendations));
    assert.ok(typeof body.nextState === 'string' && body.nextState.length > 0);
    assert.ok(Array.isArray(body.reasoningTrace) && body.reasoningTrace.length >= 3);
  });

  it('2. POST /decide sans message ni intent -> 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/decide`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({})
    });
    assert.equal(res.status, 400);
  });

  it('3. POST /orchestrate (autoMutate=false forcé) : agents exécutés, run WAITING_HUMAN_APPROVAL, AUCUNE mutation', async () => {
    // Forme exacte du plan validé par les tests unitaires ai-orchestrator
    // (5 domaines DATA/BACKEND/UI/SECURITY/TEST + intent structuré).
    // É47 P2 (P1-1) : la route force autoMutateIfLowRisk=false → le run
    // s'arrête en WAITING_HUMAN_APPROVAL et AUCUN fichier n'est modifié,
    // même pour ce plan complet.
    const plan = {
      planId: 'plan-api-lot1',
      title: 'Création du module de facturation et paiements',
      summary: 'Ajout de la gestion des factures et intégration passerelle de paiement',
      planHash: 'hash-lot1',
      status: 'APPROVED',
      steps: [
        { stepIndex: 0, title: 'Schéma de données facture', description: 'Créer le schéma des entités Facture et Paiement', targetDomain: 'DATA', targetFiles: ['src/models/invoice.ts'], operation: 'CREATE', requiresApproval: false },
        { stepIndex: 1, title: 'Service de calcul et paiement', description: 'Implémenter le service backend de facturation et routes api', targetDomain: 'BACKEND', targetFiles: ['src/services/billing.ts', 'src/routes/billing.ts'], operation: 'CREATE', requiresApproval: false },
        { stepIndex: 2, title: 'Composant interface facture', description: 'Concevoir la vue utilisateur et interface de paiement', targetDomain: 'UI', targetFiles: ['src/components/InvoiceView.tsx'], operation: 'CREATE', requiresApproval: false },
        { stepIndex: 3, title: 'Audit de sécurité des paiements', description: 'Vérifier la conformité de sécurité et les permissions RBAC', targetDomain: 'SECURITY', targetFiles: ['src/security/billing-guard.ts'], operation: 'VERIFY', requiresApproval: true },
        { stepIndex: 4, title: 'Tests unitaires et intégration', description: 'Rédiger les tests de facturation', targetDomain: 'TEST', targetFiles: ['tests/billing.test.ts'], operation: 'VERIFY', requiresApproval: false }
      ]
    };
    const intent = {
      category: 'CREATE',
      goal: 'Module de facturation complet',
      requestedAction: 'Créer les modèles, endpoints, composants UI et tests',
      entities: ['Facture', 'Paiement', 'Client'],
      constraints: ['Strict RBAC', 'PCI-DSS Compliance'],
      urgency: 'NORMAL',
      confidence: 0.95,
      ambiguities: []
    };
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/orchestrate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ plan, intent })
    });
    assert.equal(res.status, 200, 'La route /orchestrate doit être montée et fonctionnelle');
    const body = (await res.json()) as {
      run: { state: string; orchestrationId: string; completedTaskIds: string[]; artifacts: unknown[]; totalCostUsd: number; totalTokens: number; mutationTransactionId?: string; traces: Array<{ event: string }> };
    };
    assert.ok(body.run.orchestrationId.startsWith('orch-'));
    // É47 P2 (P1-1) — la mutation n'est JAMAIS exécutée depuis la route
    assert.equal(body.run.state, 'WAITING_HUMAN_APPROVAL');
    assert.equal(body.run.mutationTransactionId, undefined, 'aucune transaction de mutation');
    assert.ok(body.run.traces.some((t) => t.event.includes('approbation humaine')), 'trace d approbation humaine présente');
    // Les agents ont travaillé (artefacts produits) mais rien n'est appliqué
    assert.ok(body.run.completedTaskIds.length >= 1);
    assert.ok(Array.isArray(body.run.artifacts) && body.run.artifacts.length >= 1);
    // Aucun fichier cible créé/modifié dans le projet
    for (const target of ['src/models/invoice.ts', 'src/components/InvoiceView.tsx']) {
      const f = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/content?path=${encodeURIComponent(target)}`, { headers: H });
      assert.ok(!f.ok, `le fichier ${target} ne doit pas exister après un run WAITING (status ${f.status})`);
    }
    // P2 — contrat honnête : SANS clé IA, les agents sont dégradés (tokens 0)
    assert.ok(body.run.totalTokens === 0, 'sans provider IA, aucun token fictif');;
    assert.ok(body.run.totalCostUsd >= 0);
  });

  it('3-bis. POST /orchestrate en VIEWER -> 403 (É47 P2, P1-2 : RBAC PROJECT_MUTATE)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'studio-local', 'x-user-role': 'VIEWER' },
      body: JSON.stringify({ plan: { planId: 'p-v', steps: [{ stepIndex: 0, title: 'x', description: 'x', targetDomain: 'UI', targetFiles: ['a.ts'], operation: 'CREATE', requiresApproval: false }] } })
    });
    assert.equal(res.status, 403, 'un VIEWER est rejeté avant toute exécution d agents');
  });

  it('4. POST /orchestrate sans plan -> 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/orchestrate`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({})
    });
    assert.equal(res.status, 400);
  });
});
