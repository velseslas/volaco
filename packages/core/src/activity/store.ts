/**
 * VibeCode Studio - Project Activity Store (CAPP-007)
 */

import { randomUUID } from 'node:crypto';
import type { EntityId } from '../types/index.js';
import type { ProjectActivity, RecordActivityInput, ActivityFilter } from './types.js';

function formatDisplayTime(d: Date): string {
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export class ProjectActivityStore {
  private activities: ProjectActivity[] = [];

  public record(tenantId: EntityId, projectId: EntityId, input: RecordActivityInput): ProjectActivity {
    const now = input.timestamp ? new Date(input.timestamp) : new Date();
    const displayTime = input.displayTime || formatDisplayTime(now);

    const activity: ProjectActivity = {
      id: 'act_' + randomUUID().replace(/-/g, '').slice(0, 16),
      tenantId,
      projectId,
      type: input.type,
      description: input.description,
      actor: {
        id: input.actor?.id || 'user',
        name: input.actor?.name || (input.actor?.type === 'AI' ? 'Agent IA' : 'Utilisateur'),
        type: input.actor?.type || 'USER',
        ...(input.actor?.role ? { role: input.actor.role } : {})
      },
      timestamp: now,
      displayTime,
      ...(input.metadata ? { metadata: input.metadata } : {})
    };

    this.activities.push(activity);
    return activity;
  }

  public getActivities(tenantId: EntityId, projectId: EntityId, filter?: ActivityFilter): ProjectActivity[] {
    let filtered = this.activities.filter(
      (a) => a.tenantId === tenantId && a.projectId === projectId
    );

    if (filter?.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      filtered = filtered.filter((a) => types.includes(a.type));
    }

    if (filter?.actorType) {
      filtered = filtered.filter((a) => a.actor.type === filter.actorType);
    }

    if (filter?.since) {
      filtered = filtered.filter((a) => a.timestamp >= filter.since!);
    }

    const order = filter?.order || 'DESC';
    filtered.sort((a, b) => {
      const diff = a.timestamp.getTime() - b.timestamp.getTime();
      return order === 'ASC' ? diff : -diff;
    });

    if (typeof filter?.limit === 'number' && filter.limit > 0) {
      filtered = filtered.slice(0, filter.limit);
    }

    return filtered;
  }

  public clear(): void {
    this.activities = [];
  }
}

export const projectActivityStore = new ProjectActivityStore();
