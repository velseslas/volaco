/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-006)
 * Mutation Planner & Dependency Ordering Engine
 */

import { randomUUID } from 'node:crypto';
import type { IMutableFileSource } from '../filesystem/adapter.js';
import type { SemanticCodeGraph } from '../../semantic-graph/types.js';
import type { ImpactAnalysis, ImpactRiskLevel } from '../../impact-intelligence/types.js';
import { assertSafeMutationPath } from './security.js';
import { computePlanHash, deepFreeze } from './canonical.js';
import type {
  MutationKind,
  MutationPlan,
  SingleMutation
} from '../types.js';
import { MutationValidationError } from '../types.js';

export interface CreatePlanRequest {
  readonly tenantId: string;
  readonly projectId: string;
  readonly baseGraphHash: string;
  readonly baseImpactHash?: string | undefined;
  readonly mutations: readonly SingleMutation[];
  readonly riskLevel?: ImpactRiskLevel | undefined;
  readonly requestId?: string | undefined;
}

const MUTATION_KIND_ORDER: Record<MutationKind, number> = {
  CREATE_FILE: 10,
  UPDATE_IMPORT: 20,
  UPDATE_SYMBOL: 30,
  UPDATE_COMPONENT: 40,
  UPDATE_ROUTE: 50,
  UPDATE_EXPORT: 60,
  UPDATE_FILE: 70,
  RENAME_FILE: 80,
  MOVE_FILE: 90,
  DELETE_FILE: 100
};

/**
 * Topologically sorts mutations based on kind priority and cross-file dependencies.
 */
export function orderMutations(mutations: readonly SingleMutation[]): readonly SingleMutation[] {
  const sorted = [...mutations].sort((a, b) => {
    const orderA = MUTATION_KIND_ORDER[a.kind] ?? 50;
    const orderB = MUTATION_KIND_ORDER[b.kind] ?? 50;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    // Secondary sort: target path
    const pathA = a.operation.path;
    const pathB = b.operation.path;
    if (pathA !== pathB) {
      return pathA.localeCompare(pathB);
    }
    return a.mutationId.localeCompare(b.mutationId);
  });

  return sorted;
}

/**
 * Creates, enriches, and validates a MutationPlan.
 */
export function buildMutationPlan(
  request: CreatePlanRequest,
  fileSource: IMutableFileSource,
  currentGraph?: SemanticCodeGraph | undefined,
  impactAnalysis?: ImpactAnalysis | undefined
): MutationPlan {
  // 1. Mandatory Input Validation
  if (!request.tenantId || typeof request.tenantId !== 'string' || request.tenantId.trim().length === 0) {
    throw new MutationValidationError('tenantId est obligatoire pour le plan de mutation');
  }
  if (!request.projectId || typeof request.projectId !== 'string' || request.projectId.trim().length === 0) {
    throw new MutationValidationError('projectId est obligatoire pour le plan de mutation');
  }
  if (!request.mutations || request.mutations.length === 0) {
    throw new MutationValidationError('Au moins une mutation est requise dans le plan de mutation');
  }

  // 2. Validate all targets and paths for security
  for (const m of request.mutations) {
    assertSafeMutationPath(m.operation.path, request.requestId);
    if (m.operation.newPath) {
      assertSafeMutationPath(m.operation.newPath, request.requestId);
    }
  }

  // 3. Enrich mutations with contentHashBefore if file exists and hash not provided
  const enrichedMutations: SingleMutation[] = request.mutations.map((m) => {
    let contentHashBefore = m.contentHashBefore;
    if (contentHashBefore === undefined && m.kind !== 'CREATE_FILE') {
      const file = fileSource.getFile(request.tenantId, request.projectId, m.operation.path);
      if (file && file.hash) {
        contentHashBefore = file.hash;
      }
    }
    return {
      ...m,
      contentHashBefore
    };
  });

  // 4. Order mutations topologically
  const ordered = orderMutations(enrichedMutations);

  // 5. Expected changes list
  const expectedChanges: string[] = ordered.map(
    (m) => `${m.kind}: ${m.operation.path}${m.operation.newPath ? ' -> ' + m.operation.newPath : ''}`
  );

  // 6. Risk Level
  const riskLevel: ImpactRiskLevel =
    impactAnalysis?.overallRisk ?? request.riskLevel ?? 'LOW';

  const planId = `plan-${randomUUID()}`;
  const createdAt = new Date().toISOString();

  const unsignedPayload = {
    schemaVersion: '1.0.0' as const,
    planId,
    tenantId: request.tenantId.trim(),
    projectId: request.projectId.trim(),
    requestId: request.requestId,
    baseGraphHash: request.baseGraphHash,
    baseImpactHash: request.baseImpactHash ?? impactAnalysis?.impactHash,
    mutations: ordered,
    expectedChanges,
    riskLevel,
    validationStatus: 'PENDING' as const
  };

  const planHash = computePlanHash(unsignedPayload);

  const plan: MutationPlan = {
    ...unsignedPayload,
    createdAt,
    planHash
  };

  return deepFreeze(plan);
}
