/**
 * VibeCode Studio - Core Type Definitions (FND-001)
 */

export type EntityId = string;

export interface Tenant {
  id: EntityId;
  name: string;
  slug: string;
  createdAt: Date;
}

export interface User {
  id: EntityId;
  tenantId: EntityId;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'ENGINEER' | 'VIEWER';
  createdAt: Date;
}

export type ProjectStatus =
  | 'CREATED'
  | 'ACTIVE'
  | 'BUILDING'
  | 'VALIDATING'
  | 'READY'
  | 'ERROR'
  | 'ARCHIVED';

export interface Project {
  id: EntityId;
  tenantId: EntityId;
  name: string;
  description?: string;
  status?: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type CompassPhase =
  | 'EXPLORING'
  | 'UNDERSTANDING'
  | 'PLANNING'
  | 'WAITING_CONFIRMATION'
  | 'EXECUTING'
  | 'VALIDATING'
  | 'COMPLETED';

export interface CompassState {
  currentPhase: CompassPhase;
  progressPercent: number;
  activeObjective: string;
  updatedAt: Date;
}

export interface QualityGateResult {
  gateId: string;
  passed: boolean;
  timestamp: Date;
  checks: {
    build: boolean;
    typecheck: boolean;
    lint: boolean;
    tests: boolean;
    security: boolean;
  };
  details: string[];
}
