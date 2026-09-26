import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasPermission,
  assertPermission,
  ForbiddenError,
  ProjectStore,
  TenantStore
} from '../src/index.js';

describe('FND-003 : Identity, Tenancy & RBAC Unit Tests', () => {
  let projectStore: ProjectStore;
  let tenantStore: TenantStore;

  beforeEach(() => {
    projectStore = new ProjectStore();
    tenantStore = new TenantStore();
  });

  it('doit respecter strictement la matrice des permissions RBAC', () => {
    // OWNER a tous les droits
    assert.equal(hasPermission('OWNER', 'PROJECT_CREATE'), true);
    assert.equal(hasPermission('OWNER', 'PROJECT_DELETE'), true);
    assert.equal(hasPermission('OWNER', 'TENANT_MANAGE'), true);

    // ADMIN ne peut pas gÃ©rer le tenant
    assert.equal(hasPermission('ADMIN', 'PROJECT_DELETE'), true);
    assert.equal(hasPermission('ADMIN', 'TENANT_MANAGE'), false);

    // ENGINEER peut crÃ©er mais pas supprimer
    assert.equal(hasPermission('ENGINEER', 'PROJECT_CREATE'), true);
    assert.equal(hasPermission('ENGINEER', 'PROJECT_DELETE'), false);

    // VIEWER ne peut que lire
    assert.equal(hasPermission('VIEWER', 'PROJECT_READ'), true);
    assert.equal(hasPermission('VIEWER', 'PROJECT_CREATE'), false);
    assert.equal(hasPermission('VIEWER', 'PROJECT_DELETE'), false);
  });

  it('doit lever ForbiddenError lorsque les droits sont insuffisants', () => {
    assert.throws(
      () => assertPermission('VIEWER', 'PROJECT_DELETE', 'req_test'),
      (err: unknown) => {
        return err instanceof ForbiddenError && err.statusCode === 403;
      }
    );
  });

  it('doit isoler hermÃ©tiquement les projets par tenantId', () => {
    tenantStore.createTenant('tenant_A', 'Entreprise Alpha', 'alpha');
    tenantStore.createTenant('tenant_B', 'Entreprise Beta', 'beta');

    const projA1 = projectStore.createProject('tenant_A', 'Projet A1');
    const projA2 = projectStore.createProject('tenant_A', 'Projet A2');
    const projB1 = projectStore.createProject('tenant_B', 'Projet B1');

    // Tenant A ne voit que ses 2 projets
    const listA = projectStore.listProjects('tenant_A');
    assert.equal(listA.length, 2);
    assert.ok(listA.some(p => p.id === projA1.id));
    assert.ok(listA.some(p => p.id === projA2.id));
    assert.ok(!listA.some(p => p.id === projB1.id));

    // Tenant B ne voit que son projet
    const listB = projectStore.listProjects('tenant_B');
    assert.equal(listB.length, 1);
    assert.equal(listB[0]?.id, projB1.id);

    // Tentative d'accÃ¨s inter-tenant directe : null
    assert.equal(projectStore.getProject('tenant_A', projB1.id), null);
    assert.equal(projectStore.getProject('tenant_B', projA1.id), null);
  });
});
