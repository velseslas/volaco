/**
 * VibeCode Studio - Terminal Interface Types (CORE-005)
 */

import type { EntityId } from '../types/index.js';

export type AllowedBinary = 'pnpm' | 'npm' | 'node' | 'git';

export interface CommandInput {
  command: string;
  timeoutMs?: number | undefined;
}

export interface CommandResult {
  tenantId: EntityId;
  projectId: EntityId;
  command: string;
  binary: AllowedBinary;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  executedAt: Date;
}
