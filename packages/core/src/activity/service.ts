/**
 * VibeCode Studio - Project Activity & History Service (CAPP-007)
 */

import type { Role } from '../identity/permissions.js';
import { assertPermission } from '../identity/permissions.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { ProjectStore, projectStore as defaultProjectStore } from '../identity/project.js';
import { AuditStore, auditStore as defaultAuditStore } from '../observability/audit.js';
import { ProjectActivityStore, projectActivityStore as defaultActivityStore } from './store.js';
import type { ProjectActivity, RecordActivityInput, ActivityFilter } from './types.js';

export class ProjectActivityService {
  constructor(
    private projectStore: ProjectStore = defaultProjectStore,
    private activityStore: ProjectActivityStore = defaultActivityStore,
    private auditStore?: AuditStore
  ) {
    if (!this.auditStore) {
      this.auditStore = defaultAuditStore;
    }
  }

  private assertProjectAccess(tenantId: string, projectId: string, requestId?: string): void {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new ValidationError('Le tenantId est obligatoire', { field: 'tenantId' }, requestId);
    }
    if (!projectId || projectId.trim().length === 0) {
      throw new ValidationError('Le projectId est obligatoire', { field: 'projectId' }, requestId);
    }

    const project = this.projectStore.getProject(tenantId, projectId);
    if (!project) {
      throw new NotFoundError(`Projet ${projectId} introuvable pour le tenant ${tenantId}`, requestId);
    }
  }

  public recordActivity(
    tenantId: string,
    projectId: string,
    input: RecordActivityInput,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): ProjectActivity {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    if (!input.type) {
      throw new ValidationError('Le type d\'activité est obligatoire', { field: 'type' }, requestId);
    }
    if (!input.description || input.description.trim().length === 0) {
      throw new ValidationError('La description de l\'activité est obligatoire', { field: 'description' }, requestId);
    }

    const activity = this.activityStore.record(tenantId, projectId, {
      ...input,
      description: input.description.trim()
    });

    // Enregistrement miroir dans l'AuditStore (FND-005)
    if (this.auditStore) {
      try {
        this.auditStore.record({
          tenantId,
          userId: activity.actor.id,
          action: activity.type,
          resourceType: 'PROJECT_ACTIVITY',
          resourceId: `${projectId}:${activity.id}`,
          status: 'SUCCESS',
          metadata: {
            description: activity.description,
            actorType: activity.actor.type,
            displayTime: activity.displayTime,
            ...(activity.metadata || {})
          },
          requestId: requestId || 'req_act_auto'
        });
      } catch {
        // Continue sans bloquer
      }
    }

    return activity;
  }

  public getProjectHistory(
    tenantId: string,
    projectId: string,
    filter?: ActivityFilter,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): ProjectActivity[] {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_READ', requestId);

    return this.activityStore.getActivities(tenantId, projectId, filter);
  }

  /**
   * Initialise la séquence d'activité de référence CAPP-007 pour un projet
   * 09:42  User created project
   * 09:45  File created
   * 09:47  File modified
   * 09:48  Revision 2 created
   * 09:51  AI modification
   * 09:53  Revision 3 created
   * 09:55  Rollback → Revision 1
   */
  public seedReferenceHistory(
    tenantId: string,
    projectId: string,
    userRole: Role = 'ADMIN',
    requestId?: string
  ): ProjectActivity[] {
    this.assertProjectAccess(tenantId, projectId, requestId);
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    const baseDate = new Date();
    const setTime = (hours: number, minutes: number) => {
      const d = new Date(baseDate);
      d.setHours(hours, minutes, 0, 0);
      return d;
    };

    const sequence: RecordActivityInput[] = [
      {
        type: 'PROJECT_CREATED',
        description: 'User created project',
        actor: { id: 'usr_owner', name: 'Utilisateur', type: 'USER', role: 'OWNER' },
        timestamp: setTime(9, 42),
        displayTime: '09:42',
        metadata: { phase: 'INITIALIZATION', stack: 'react-tailwind' }
      },
      {
        type: 'FILE_CREATED',
        description: 'File created',
        actor: { id: 'usr_owner', name: 'Utilisateur', type: 'USER', role: 'ENGINEER' },
        timestamp: setTime(9, 45),
        displayTime: '09:45',
        metadata: { path: 'src/components/Header.jsx' }
      },
      {
        type: 'FILE_MODIFIED',
        description: 'File modified',
        actor: { id: 'usr_owner', name: 'Utilisateur', type: 'USER', role: 'ENGINEER' },
        timestamp: setTime(9, 47),
        displayTime: '09:47',
        metadata: { path: 'src/components/Header.jsx', diffLines: '+14 -2' }
      },
      {
        type: 'REVISION_CREATED',
        description: 'Revision 2 created',
        actor: { id: 'usr_owner', name: 'Utilisateur', type: 'USER', role: 'ENGINEER' },
        timestamp: setTime(9, 48),
        displayTime: '09:48',
        metadata: { revisionNumber: 2, message: 'Structure Header validée' }
      },
      {
        type: 'AI_MODIFICATION',
        description: 'AI modification',
        actor: { id: 'ai_assistant', name: 'Agent IA', type: 'AI' },
        timestamp: setTime(9, 51),
        displayTime: '09:51',
        metadata: { prompt: 'Ajouter des métriques en direct et un graphique', tokensUsed: 420 }
      },
      {
        type: 'REVISION_CREATED',
        description: 'Revision 3 created',
        actor: { id: 'ai_assistant', name: 'Agent IA', type: 'AI' },
        timestamp: setTime(9, 53),
        displayTime: '09:53',
        metadata: { revisionNumber: 3, message: 'Intégration du composant KPI' }
      },
      {
        type: 'ROLLBACK_EXECUTED',
        description: 'Rollback → Revision 1',
        actor: { id: 'usr_owner', name: 'Utilisateur', type: 'USER', role: 'ENGINEER' },
        timestamp: setTime(9, 55),
        displayTime: '09:55',
        metadata: { targetRevisionNumber: 1, reason: 'Retour à l\'état stable initial' }
      }
    ];

    const results: ProjectActivity[] = [];
    for (const item of sequence) {
      results.push(this.activityStore.record(tenantId, projectId, item));
    }

    return results;
  }
}

export const projectActivityService = new ProjectActivityService();
