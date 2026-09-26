/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * Canonical Hashing, Sorters and Immutability Utilities
 */

import { createHash } from 'node:crypto';
import type { AgentArtifact, AgentConflict, AgentTask } from './types.js';

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

export function compareTasks(a: AgentTask, b: AgentTask): number {
  if (a.priority !== b.priority) {
    return b.priority - a.priority; // higher priority first
  }
  return a.id.localeCompare(b.id);
}

export function compareArtifacts(a: AgentArtifact, b: AgentArtifact): number {
  if (a.domain !== b.domain) {
    return a.domain.localeCompare(b.domain);
  }
  return a.id.localeCompare(b.id);
}

export function compareConflicts(a: AgentConflict, b: AgentConflict): number {
  const severityOrder: Record<AgentConflict['severity'], number> = {
    BLOCKING: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1
  };
  const diff = severityOrder[b.severity] - severityOrder[a.severity];
  if (diff !== 0) return diff;
  return a.conflictId.localeCompare(b.conflictId);
}

export function computeTaskGraphHash(tasks: readonly AgentTask[]): string {
  const sorted = [...tasks].sort(compareTasks);
  const raw = sorted
    .map((t) => `${t.id}:${t.domain}:${t.priority}:${t.dependencies.slice().sort().join(',')}`)
    .join('|');
  return 'graph:' + createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 16);
}

export function computeArtifactHash(artifact: {
  readonly id: string;
  readonly taskId: string;
  readonly domain: string;
  readonly kind: string;
  readonly targetFiles: readonly string[];
  readonly payload: unknown;
}): string {
  const raw = `${artifact.id}:${artifact.taskId}:${artifact.domain}:${artifact.kind}:${artifact.targetFiles.slice().sort().join(',')}:${JSON.stringify(artifact.payload)}`;
  return 'art:' + createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 16);
}

export function computeOrchestrationTraceId(orchestrationId: string, eventIndex: number): string {
  const raw = `${orchestrationId}:trace:${eventIndex}`;
  return 'orch-tr-' + createHash('sha256').update(raw, 'utf8').digest('hex').substring(0, 12);
}
