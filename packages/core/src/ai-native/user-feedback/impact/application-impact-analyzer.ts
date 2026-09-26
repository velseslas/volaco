/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Application Impact Analyzer: Blast Radius & System Perimeter Quantification
 */

import type { UserSignal } from '../types.js';

export interface ApplicationImpactResult {
  readonly affectedFiles: readonly string[];
  readonly isBlockingCoreFlow: boolean;
  readonly blastRadiusScore: number; // 0 - 100
}

export class ApplicationImpactAnalyzer {
  public analyze(signals: readonly UserSignal[]): ApplicationImpactResult {
    const files = new Set<string>();
    let isBlocking = false;

    for (const sig of signals) {
      if (sig.url && (sig.url.endsWith('.ts') || sig.url.endsWith('.tsx') || sig.url.endsWith('.js') || sig.url.endsWith('.html'))) {
        files.add(sig.url);
      }

      const text = (sig.normalizedText || sig.rawText).toLowerCase();
      if (
        text.includes('bloqué') ||
        text.includes('impossible de') ||
        text.includes('crash') ||
        text.includes('auth') ||
        text.includes('login') ||
        text.includes('paiement') ||
        text.includes('checkout')
      ) {
        isBlocking = true;
      }
    }

    const fileCount = files.size;
    let blastRadius = 25;

    if (fileCount > 5) {
      blastRadius = 80;
    } else if (fileCount > 2) {
      blastRadius = 55;
    } else if (fileCount === 1) {
      blastRadius = 35;
    }

    if (isBlocking) {
      blastRadius = Math.min(100, blastRadius + 25);
    }

    return {
      affectedFiles: Array.from(files).sort(),
      isBlockingCoreFlow: isBlocking,
      blastRadiusScore: blastRadius
    };
  }
}
