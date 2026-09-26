/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-006)
 * Structured Diff Generator Engine
 */

import type { MutationKind, StructuredDiff } from '../types.js';

/**
 * Computes a StructuredDiff between before and after file content.
 */
export function computeStructuredDiff(
  filePath: string,
  operation: MutationKind,
  beforeContent: string | null,
  afterContent: string | null
): StructuredDiff {
  if (beforeContent === null && afterContent === null) {
    return {
      filePath,
      operation,
      beforeContent: null,
      afterContent: null,
      addedLines: 0,
      removedLines: 0
    };
  }

  if (beforeContent === null && afterContent !== null) {
    const lines = afterContent.length === 0 ? 0 : afterContent.split('\n').length;
    return {
      filePath,
      operation,
      beforeContent: null,
      afterContent,
      addedLines: lines,
      removedLines: 0
    };
  }

  if (beforeContent !== null && afterContent === null) {
    const lines = beforeContent.length === 0 ? 0 : beforeContent.split('\n').length;
    return {
      filePath,
      operation,
      beforeContent,
      afterContent: null,
      addedLines: 0,
      removedLines: lines
    };
  }

  // Content updated
  const beforeLines = (beforeContent ?? '').split('\n');
  const afterLines = (afterContent ?? '').split('\n');

  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  let added = 0;
  for (const l of afterLines) {
    if (!beforeSet.has(l)) added++;
  }

  let removed = 0;
  for (const l of beforeLines) {
    if (!afterSet.has(l)) removed++;
  }

  return {
    filePath,
    operation,
    beforeContent,
    afterContent,
    addedLines: added,
    removedLines: removed
  };
}
