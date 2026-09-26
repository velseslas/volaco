import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  maskSecret,
  sanitizePayload,
  MetricsCollector,
  AuditStore,
  AiUsageTracker
} from '../src/index.js';

describe('FND-005 : Security, Observability, Audit & Cost Unit Tests', () => {
  let metrics: MetricsCollector;
  let audit: AuditStore;
  let aiUsage: AiUsageTracker;

  beforeEach(() => {
    metrics = new MetricsCollector();
    audit = new AuditStore();
    aiUsage = new AiUsageTracker();
  });

  it('doit masquer correctement les secrets et clÃ©s d API', () => {
    assert.equal(maskSecret('sk_live_1234567890abcdef', 4), 'sk_l...cdef');
    assert.equal(maskSecret('court', 4), '***');

    const sensitiveObj = {
      user: 'admin',
      apiKey: 'sk_secret_12345678901234567890',
      nested: {
        password: 'SuperPassword123!',
        notes: 'Public note'
      }
    };

    const clean = sanitizePayload(sensitiveObj);
    assert.equal(clean.user, 'admin');
    assert.ok(clean.apiKey.includes('...'));
    assert.ok(!clean.apiKey.includes('1234567890'));
    assert.equal(clean.nested.password, '***MASKED***');
    assert.equal(clean.nested.notes, 'Public note');
  });

  it('doit enregistrer les mÃ©triques et calculer la latence moyenne', () => {
    metrics.recordRequest(200, 10);
    metrics.recordRequest(200, 20);
    metrics.recordRequest(404, 30);
    metrics.recordRequest(500, 40);

    const summary = metrics.getMetricsSummary();
    assert.equal(summary.totalRequests, 4);
    assert.equal(summary.successCount, 2);
    assert.equal(summary.clientErrorCount, 1);
    assert.equal(summary.serverErrorCount, 1);
    assert.equal(summary.avgLatencyMs, 25);
  });

  it('doit enregistrer des Ã©vÃ©nements d audit et isoler par tenant', () => {
    audit.record({
      tenantId: 'tenant_audit_1',
      userId: 'usr_1',
      action: 'PROJECT_CREATE',
      resourceType: 'PROJECT',
      resourceId: 'proj_1',
      status: 'SUCCESS',
      requestId: 'req_aud_1'
    });

    audit.record({
      tenantId: 'tenant_audit_2',
      userId: 'usr_2',
      action: 'PROJECT_DELETE',
      resourceType: 'PROJECT',
      resourceId: 'proj_2',
      status: 'SUCCESS',
      requestId: 'req_aud_2'
    });

    const tenant1Events = audit.query('tenant_audit_1');
    assert.equal(tenant1Events.length, 1);
    assert.equal(tenant1Events[0]?.action, 'PROJECT_CREATE');

    const tenant2Events = audit.query('tenant_audit_2');
    assert.equal(tenant2Events.length, 1);
    assert.equal(tenant2Events[0]?.action, 'PROJECT_DELETE');
  });

  it('doit calculer le coÃ»t estimÃ© des tokens IA selon le barÃ¨me Codestral', () => {
    const cost = aiUsage.calculateCost('codestral-latest', 100_000, 50_000);
    assert.equal(cost, 0.05);

    aiUsage.recordUsage('tenant_ai', 'proj_alpha', 'codestral-latest', 100_000, 50_000, 'req_ai_1');
    aiUsage.recordUsage('tenant_ai', 'proj_alpha', 'codestral-latest', 200_000, 100_000, 'req_ai_2');

    const summary = aiUsage.getUsageSummary('tenant_ai', 'proj_alpha');
    assert.equal(summary.totalPromptTokens, 300_000);
    assert.equal(summary.totalCompletionTokens, 150_000);
    assert.equal(summary.totalTokens, 450_000);
    assert.equal(summary.totalCostUsd, 0.15);
    assert.equal(summary.recordCount, 2);
  });
});
