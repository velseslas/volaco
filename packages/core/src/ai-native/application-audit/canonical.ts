/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Application Audit & Global Quality Intelligence Engine - Canonical Utilities
 */

import { createHash } from 'node:crypto';
import type {
  ApplicationAuditFinding,
  AuditDimensionScores,
  AuditSeverity
} from './types.js';

export function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = (obj as Record<string, unknown>)[name];
    if (value !== null && typeof value === 'object') {
      deepFreeze(value);
    }
  }
  return Object.freeze(obj);
}

const SEVERITY_WEIGHTS: Record<AuditSeverity, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1
};

export function compareAuditFindings(
  a: ApplicationAuditFinding,
  b: ApplicationAuditFinding
): number {
  const weightA = SEVERITY_WEIGHTS[a.severity] ?? 0;
  const weightB = SEVERITY_WEIGHTS[b.severity] ?? 0;

  if (weightB !== weightA) {
    return weightB - weightA; // Descending severity
  }

  if (a.dimension !== b.dimension) {
    return a.dimension.localeCompare(b.dimension);
  }

  return a.title.localeCompare(b.title);
}

export function computeApplicationAuditHash(data: {
  tenantId: string;
  projectId: string;
  overallScore: number;
  findingsCount: number;
  dimensionScores: AuditDimensionScores;
}): string {
  const raw = `${data.tenantId}:${data.projectId}:${data.overallScore}:${data.findingsCount}:${data.dimensionScores.architecture}:${data.dimensionScores.codeQuality}:${data.dimensionScores.security}:${data.dimensionScores.performance}:${data.dimensionScores.ux}:${data.dimensionScores.accessibility}:${data.dimensionScores.aiConfig}:${data.dimensionScores.designHarmony}`;
  return 'aar:' + createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 16);
}
