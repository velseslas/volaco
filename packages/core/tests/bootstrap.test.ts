import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBootstrapReport } from '../src/index.js';
import type { CompassState, Tenant, Project } from '../src/types/index.js';

describe('FND-001 : Foundation & Modular Monolith Bootstrap', () => {
  it('doit gÃ©nÃ©rer un rapport de bootstrap valide conforme aux spÃ©cifications', () => {
    const report = createBootstrapReport('VibeCode Platform');
    assert.equal(report.project, 'VibeCode Platform');
    assert.equal(report.version, '0.1.0');
    assert.equal(report.architecture, 'MODULAR_MONOLITH');
    assert.equal(report.foundation, 'FND-001');
    assert.equal(report.status, 'ACTIVE');
    assert.ok(report.timestamp);
  });

  it('doit respecter strictement les contrats de types fondamentaux', () => {
    const tenant: Tenant = {
      id: 'tenant-001',
      name: 'VibeCode Labs',
      slug: 'vibecode-labs',
      createdAt: new Date()
    };

    const project: Project = {
      id: 'proj-001',
      tenantId: tenant.id,
      name: 'Alpha Studio',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const compass: CompassState = {
      currentPhase: 'UNDERSTANDING',
      progressPercent: 20,
      activeObjective: 'Analyse d intention initiale',
      updatedAt: new Date()
    };

    assert.equal(tenant.id, 'tenant-001');
    assert.equal(project.tenantId, tenant.id);
    assert.equal(compass.currentPhase, 'UNDERSTANDING');
    assert.equal(compass.progressPercent, 20);
  });
});
