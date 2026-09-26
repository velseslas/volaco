/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Role Impact Analyzer: RBAC Profiling of Affected User Groups
 */

import type { Role } from '../../../identity/permissions.js';
import type { UserSignal } from '../types.js';

export interface RoleImpactResult {
  readonly affectedRoles: readonly Role[];
  readonly affectsPrivilegedRoles: boolean;
  readonly roleDistribution: Readonly<Record<Role, number>>;
}

export class RoleImpactAnalyzer {
  public analyze(signals: readonly UserSignal[]): RoleImpactResult {
    const distribution: Record<Role, number> = {
      OWNER: 0,
      ADMIN: 0,
      ENGINEER: 0,
      VIEWER: 0
    };

    const rolesSet = new Set<Role>();

    for (const sig of signals) {
      if (sig.userRole) {
        rolesSet.add(sig.userRole);
        distribution[sig.userRole] = (distribution[sig.userRole] || 0) + 1;
      }
    }

    if (rolesSet.size === 0) {
      rolesSet.add('VIEWER');
      distribution.VIEWER = signals.length;
    }

    const affectedRoles = Array.from(rolesSet);
    const affectsPrivilegedRoles = rolesSet.has('OWNER') || rolesSet.has('ADMIN');

    return {
      affectedRoles,
      affectsPrivilegedRoles,
      roleDistribution: distribution
    };
  }
}
