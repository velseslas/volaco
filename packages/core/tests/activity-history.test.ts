import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ProjectActivityService } from '../src/activity/service.js';
import { ProjectActivityStore } from '../src/activity/store.js';
import { ProjectStore } from '../src/identity/project.js';
import { AuditStore } from '../src/observability/audit.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../src/errors.js';

describe('CAPP-007 : Project Activity & History Unit Tests', () => {
  let projectStore: ProjectStore;
  let activityStore: ProjectActivityStore;
  let auditStore: AuditStore;
  let service: ProjectActivityService;

  const tenantA = 'tenant_alpha';
  const tenantB = 'tenant_beta';
  let projectIdA: string;
  let projectIdB: string;

  beforeEach(() => {
    projectStore = new ProjectStore();
    activityStore = new ProjectActivityStore();
    auditStore = new AuditStore();

    service = new ProjectActivityService(projectStore, activityStore, auditStore);

    // Initialiser les projets
    const projA = projectStore.createProject(tenantA, 'Pulse Analytics', 'Analytics SaaS');
    projectIdA = projA.id;

    const projB = projectStore.createProject(tenantB, 'Beta Project', 'Isolé');
    projectIdB = projB.id;
  });

  it('1. doit enregistrer et restituer une activité avec displayTime et acteur', () => {
    const act = service.recordActivity(
      tenantA,
      projectIdA,
      {
        type: 'FILE_CREATED',
        description: 'File created: src/App.jsx',
        actor: { id: 'usr_1', name: 'Alex', type: 'USER', role: 'ENGINEER' },
        displayTime: '10:15',
        metadata: { path: 'src/App.jsx' }
      },
      'ENGINEER',
      'req_1'
    );

    assert.ok(act.id.startsWith('act_'));
    assert.strictEqual(act.tenantId, tenantA);
    assert.strictEqual(act.projectId, projectIdA);
    assert.strictEqual(act.type, 'FILE_CREATED');
    assert.strictEqual(act.description, 'File created: src/App.jsx');
    assert.strictEqual(act.displayTime, '10:15');
    assert.strictEqual(act.actor.name, 'Alex');
    assert.strictEqual(act.actor.type, 'USER');

    const history = service.getProjectHistory(tenantA, projectIdA, {}, 'VIEWER', 'req_2');
    assert.strictEqual(history.length, 1);
    assert.ok(history[0]);
    assert.strictEqual(history[0].id, act.id);
  });

  it('2. doit reproduire fidèlement la séquence de référence CAPP-007 (09:42 à 09:55)', () => {
    const sequence = service.seedReferenceHistory(tenantA, projectIdA, 'ADMIN', 'req_seed');

    assert.strictEqual(sequence.length, 7);

    // Vérification de la séquence chronologique ascendante
    const ascHistory = service.getProjectHistory(tenantA, projectIdA, { order: 'ASC' }, 'VIEWER');
    assert.strictEqual(ascHistory.length, 7);

    const i0 = ascHistory[0]!;
    assert.strictEqual(i0.displayTime, '09:42');
    assert.strictEqual(i0.description, 'User created project');
    assert.strictEqual(i0.type, 'PROJECT_CREATED');
    assert.strictEqual(i0.actor.type, 'USER');

    const i1 = ascHistory[1]!;
    assert.strictEqual(i1.displayTime, '09:45');
    assert.strictEqual(i1.description, 'File created');
    assert.strictEqual(i1.type, 'FILE_CREATED');

    const i2 = ascHistory[2]!;
    assert.strictEqual(i2.displayTime, '09:47');
    assert.strictEqual(i2.description, 'File modified');
    assert.strictEqual(i2.type, 'FILE_MODIFIED');

    const i3 = ascHistory[3]!;
    assert.strictEqual(i3.displayTime, '09:48');
    assert.strictEqual(i3.description, 'Revision 2 created');
    assert.strictEqual(i3.type, 'REVISION_CREATED');

    const i4 = ascHistory[4]!;
    assert.strictEqual(i4.displayTime, '09:51');
    assert.strictEqual(i4.description, 'AI modification');
    assert.strictEqual(i4.type, 'AI_MODIFICATION');
    assert.strictEqual(i4.actor.type, 'AI');

    const i5 = ascHistory[5]!;
    assert.strictEqual(i5.displayTime, '09:53');
    assert.strictEqual(i5.description, 'Revision 3 created');
    assert.strictEqual(i5.type, 'REVISION_CREATED');

    const i6 = ascHistory[6]!;
    assert.strictEqual(i6.displayTime, '09:55');
    assert.strictEqual(i6.description, 'Rollback → Revision 1');
    assert.strictEqual(i6.type, 'ROLLBACK_EXECUTED');
  });

  it('3. doit filtrer les activités par type et par acteur', () => {
    service.seedReferenceHistory(tenantA, projectIdA, 'ADMIN');

    // Filtrer seulement les révisions
    const revs = service.getProjectHistory(tenantA, projectIdA, { type: 'REVISION_CREATED' });
    assert.strictEqual(revs.length, 2);
    assert.ok(revs.every((r) => r.type === 'REVISION_CREATED'));

    // Filtrer seulement les actions de l'IA
    const aiActs = service.getProjectHistory(tenantA, projectIdA, { actorType: 'AI' });
    assert.strictEqual(aiActs.length, 2); // AI modification + Revision 3 created
    assert.ok(aiActs.every((a) => a.actor.type === 'AI'));

    // Pagination limit
    const top3 = service.getProjectHistory(tenantA, projectIdA, { limit: 3 });
    assert.strictEqual(top3.length, 3);
  });

  it('4. Isolation Multi-Tenant : un locataire ne peut ni lire ni enregistrer d activités sur un projet tiers', () => {
    service.seedReferenceHistory(tenantA, projectIdA, 'ADMIN');

    // Tenant B essaie de lire l'historique du projet A
    assert.throws(
      () => service.getProjectHistory(tenantB, projectIdA, {}, 'VIEWER'),
      NotFoundError
    );

    // Tenant B essaie d'écrire dans le projet A
    assert.throws(
      () => service.recordActivity(tenantB, projectIdA, {
        type: 'CUSTOM',
        description: 'Tentative illégale'
      }, 'ADMIN'),
      NotFoundError
    );

    // Vérifier que le projet B est vide
    const historyB = service.getProjectHistory(tenantB, projectIdB, {}, 'VIEWER');
    assert.strictEqual(historyB.length, 0);
  });

  it('5. RBAC : VIEWER peut lire mais est rejeté en écriture (ForbiddenError)', () => {
    // Lecture autorisée pour VIEWER
    const history = service.getProjectHistory(tenantA, projectIdA, {}, 'VIEWER');
    assert.ok(Array.isArray(history));

    // Écriture interdite pour VIEWER
    assert.throws(
      () => service.recordActivity(tenantA, projectIdA, {
        type: 'CUSTOM',
        description: 'Non autorisé'
      }, 'VIEWER'),
      ForbiddenError
    );

    // Écriture autorisée pour ENGINEER
    const act = service.recordActivity(tenantA, projectIdA, {
      type: 'CUSTOM',
      description: 'Opération autorisée'
    }, 'ENGINEER');
    assert.ok(act);
  });

  it('6. Validation des entrées : doit rejeter les données invalides', () => {
    assert.throws(
      () => service.recordActivity('', projectIdA, { type: 'CUSTOM', description: 'Test' }),
      ValidationError
    );

    assert.throws(
      () => service.recordActivity(tenantA, '', { type: 'CUSTOM', description: 'Test' }),
      ValidationError
    );

    assert.throws(
      () => service.recordActivity(tenantA, projectIdA, { type: 'CUSTOM', description: '   ' }),
      ValidationError
    );
  });

  it('7. Observabilité & Audit : doit enregistrer les événements d audit correspondants', () => {
    service.recordActivity(tenantA, projectIdA, {
      type: 'STATUS_CHANGED',
      description: 'Project transitioned to READY',
      actor: { id: 'usr_admin', name: 'Admin', type: 'USER', role: 'ADMIN' }
    }, 'ADMIN', 'req_aud_test');

    const auditEvents = auditStore.query(tenantA);
    const matched = auditEvents.find((e) => e.action === 'STATUS_CHANGED');
    assert.ok(matched);
    assert.strictEqual(matched.resourceType, 'PROJECT_ACTIVITY');
    assert.ok(matched.resourceId.startsWith(projectIdA));
  });
});
