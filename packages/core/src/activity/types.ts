/**
 * VibeCode Studio - Project Activity & History Types (CAPP-007)
 */

import type { EntityId } from '../types/index.js';
import type { Role } from '../identity/permissions.js';

export type ActivityType =
  | 'PROJECT_CREATED'
  | 'FILE_CREATED'
  | 'FILE_MODIFIED'
  | 'FILE_DELETED'
  | 'FILE_RENAMED'
  | 'REVISION_CREATED'
  | 'AI_MODIFICATION'
  | 'ROLLBACK_EXECUTED'
  | 'STATUS_CHANGED'
  | 'PROJECT_VALIDATED'
  | 'CUSTOM';

export type ActorType = 'USER' | 'AI' | 'SYSTEM';

export interface ActivityActor {
  id: string;
  name: string;
  type: ActorType;
  role?: Role | undefined;
}

export interface ProjectActivity {
  id: string;
  tenantId: EntityId;
  projectId: EntityId;
  type: ActivityType;
  description: string;
  actor: ActivityActor;
  timestamp: Date;
  displayTime: string; // Ex: "09:42"
  metadata?: Record<string, unknown> | undefined;
}

export interface RecordActivityInput {
  type: ActivityType;
  description: string;
  actor?: Partial<ActivityActor> | undefined;
  timestamp?: Date | string | undefined;
  displayTime?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface ActivityFilter {
  type?: ActivityType | ActivityType[] | undefined;
  actorType?: ActorType | undefined;
  since?: Date | undefined;
  limit?: number | undefined;
  order?: 'ASC' | 'DESC' | undefined;
}
