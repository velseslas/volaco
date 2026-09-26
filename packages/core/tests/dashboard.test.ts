import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectStore,
  AuditStore,
  DashboardService,
  ValidationError,
  NotFoundError,
  ForbiddenError
} from '../src/index.js';

describe('CORE-002 : Project Dashboard Service Unit Tests', () => {
  let projectStore: ProjectStore;
  let auditStore: AuditStore;
  let dashboardService: DashboardService;
  const tenantId = 'ten_dash_001';

  beforeEach(() => {
    projectStore = new ProjectStore();
    auditStore = new AuditStore();
    dashboardService = new DashboardService(projectStore, auditStore);
  });

  it('doit renvoyer un résumé vide pour un tenant sans projets', () => {
    const summary = dashboardService.getDashboardSummary(tenantId, undefined, 'VIEWER', 'req_sum_01');

    assert.equal(summary.tenantId, tenantId);
    assert.equal(summary.totalProjects, 0);
    assert.equal(summary.projects.length, 0);
    assert.equal(summary.lastActivityAt, undefined);
  });

  it('doit créer un projet et émettre un audit event', () => {
    const project = dashboardService.createProject(
      tenantId,
      { name: 'SaaS Analytics', description: 'Dashboard métriques' },
      'ENGINEER',
      'req_create_01'
    );

    assert.ok(project.id.startsWith('proj_'));
    assert.equal(project.name, 'SaaS Analytics');
    assert.equal(project.description, 'Dashboard métriques');
    assert.equal(project.tenantId, tenantId);

    // Vérifier l'audit
    const audits = auditStore.query(tenantId, { action: 'PROJECT_CREATE' });
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.resourceId, project.id);
    assert.equal(audits[0]!.requestId, 'req_create_01');

    // Vérifier l'apparition dans le dashboard
    const summary = dashboardService.getDashboardSummary(tenantId, project.id, 'VIEWER');
    assert.equal(summary.totalProjects, 1);
    assert.equal(summary.projects[0]!.id, project.id);
    assert.equal(summary.projects[0]!.isCurrent, true);
    assert.ok(summary.lastActivityAt instanceof Date);
  });

  it('doit ordonner les projets par date de mise à jour descendante', () => {
    const p1 = dashboardService.createProject(tenantId, { name: 'Projet 1' });
    p1.updatedAt = new Date(Date.now() - 5000);
    const p2 = dashboardService.createProject(tenantId, { name: 'Projet 2' });

    const summary = dashboardService.getDashboardSummary(tenantId);
    assert.equal(summary.totalProjects, 2);
    // Projet 2 créé en dernier doit être premier
    assert.equal(summary.projects[0]!.name, 'Projet 2');
    assert.equal(summary.projects[1]!.name, 'Projet 1');
  });

  it('doit supprimer un projet avec validation et audit', () => {
    const project = dashboardService.createProject(tenantId, { name: 'Projet Temporaire' });
    assert.equal(dashboardService.getDashboardSummary(tenantId).totalProjects, 1);

    const deleted = dashboardService.deleteProject(tenantId, project.id, 'ADMIN', 'req_del_01');
    assert.equal(deleted, true);

    // Vérifier que le dashboard est maintenant vide
    assert.equal(dashboardService.getDashboardSummary(tenantId).totalProjects, 0);

    // Vérifier l'audit de suppression
    const audits = auditStore.query(tenantId, { action: 'PROJECT_DELETE' });
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.resourceId, project.id);
  });

  it('doit rejeter la suppression d un projet inexistant', () => {
    assert.throws(
      () => dashboardService.deleteProject(tenantId, 'proj_inexistant', 'ADMIN'),
      NotFoundError
    );
  });

  it('doit appliquer les règles de permissions RBAC', () => {
    // VIEWER ne peut pas créer de projet
    assert.throws(
      () => dashboardService.createProject(tenantId, { name: 'Test RBAC' }, 'VIEWER'),
      ForbiddenError
    );

    // ENGINEER ne peut pas supprimer de projet (réservé ADMIN/OWNER)
    const project = dashboardService.createProject(tenantId, { name: 'Test Delete' }, 'ENGINEER');
    assert.throws(
      () => dashboardService.deleteProject(tenantId, project.id, 'ENGINEER'),
      ForbiddenError
    );
  });

  it('doit valider les entrées obligatoires', () => {
    assert.throws(() => dashboardService.getDashboardSummary(''), ValidationError);
    assert.throws(() => dashboardService.createProject('', { name: 'Valid Name' }), ValidationError);
    assert.throws(() => dashboardService.createProject(tenantId, { name: '   ' }), ValidationError);
  });
});
