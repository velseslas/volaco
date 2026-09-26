/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-001)
 * Language Analyzer Base Interface
 */

import { createHash } from 'node:crypto';
import type { FileAnalysis, SupportedLanguage } from '../types.js';

export interface LanguageAnalyzer {
  readonly language: SupportedLanguage;
  readonly supportedExtensions: readonly string[];
  canHandle(filePath: string): boolean;
  analyze(
    content: string,
    filePath: string,
    context: {
      tenantId: string;
      projectId: string;
      fileHash: string;
      analyzerVersion: string;
    }
  ): FileAnalysis;
}

export function computeSemanticHash(payload: Record<string, unknown>): string {
  const serialized = JSON.stringify(payload);
  return createHash('sha256').update(serialized).digest('hex');
}
