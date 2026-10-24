/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Application Audit & Global Quality Intelligence Engine - Canonical Utilities
 */

import { createHash } from 'node:crypto';
import type {
  ApplicationAuditFinding,
  AuditDimensionScores,
  AuditDimensionStatusMap,
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
  overallScore: number | null;
  findingsCount: number;
  dimensionScores: AuditDimensionScores;
  dimensionStatus?: AuditDimensionStatusMap;
  coverage?: number;
}): string {
  const status = data.dimensionStatus;
  const raw = `${data.tenantId}:${data.projectId}:${data.overallScore ?? 'NA'}:${data.findingsCount}` +
    `:${data.coverage ?? 1}` +
    `:${data.dimensionScores.architecture ?? 'NA'}:${data.dimensionScores.codeQuality ?? 'NA'}:${data.dimensionScores.security ?? 'NA'}:${data.dimensionScores.performance ?? 'NA'}:${data.dimensionScores.ux ?? 'NA'}:${data.dimensionScores.accessibility ?? 'NA'}:${data.dimensionScores.aiConfig ?? 'NA'}:${data.dimensionScores.designHarmony ?? 'NA'}` +
    `:${status?.ARCHITECTURE ?? 'MEASURED'}:${status?.CODE_QUALITY ?? 'MEASURED'}:${status?.SECURITY ?? 'MEASURED'}:${status?.PERFORMANCE ?? 'MEASURED'}:${status?.UX ?? 'MEASURED'}:${status?.ACCESSIBILITY ?? 'MEASURED'}:${status?.AI_CONFIG ?? 'MEASURED'}:${status?.DESIGN_HARMONY ?? 'MEASURED'}`;
  return 'aar:' + createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 16);
}
