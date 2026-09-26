/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Application Understanding Bridge (AINT-008 Integration)
 */

import type { Role } from '../../../identity/permissions.js';
import type { ApplicationUnderstandingService } from '../../application-understanding/service.js';
import type { ApplicationSemanticModel } from '../../application-understanding/types.js';
import type { ApplicationSnapshot } from '../types.js';

export class UnderstandingBridge {
  constructor(
    private readonly understandingService?: ApplicationUnderstandingService | undefined
  ) {}

  public computeSnapshot(model?: ApplicationSemanticModel | undefined): ApplicationSnapshot {
    return {
      treeHash: model?.treeHash ?? 'tree:uninitialized',
      graphHash: model?.graphHash ?? 'graph:uninitialized',
      understandingHash: model?.understandingHash ?? 'understanding:uninitialized'
    };
  }

  public isContextStale(current: ApplicationSnapshot, latest: ApplicationSnapshot): boolean {
    if (current.graphHash === 'graph:uninitialized') {
      return false;
    }
    return (
      current.graphHash !== latest.graphHash ||
      current.understandingHash !== latest.understandingHash ||
      current.treeHash !== latest.treeHash
    );
  }

  public fetchUnderstanding(
    tenantId: string,
    projectId: string,
    userRole: Role = 'OWNER',
    requestId?: string | undefined
  ): ApplicationSemanticModel | undefined {
    if (!this.understandingService) {
      return undefined;
    }

    try {
      return this.understandingService.buildUnderstanding(
        { tenantId, projectId },
        userRole,
        requestId
      );
    } catch {
      return undefined;
    }
  }
}
