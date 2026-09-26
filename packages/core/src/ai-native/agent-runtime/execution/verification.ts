/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Post-Mutation Verification Engine
 */

import type { CodeIntelligenceService } from '../../understanding/service.js';
import type { Role } from '../../../identity/permissions.js';

export interface VerificationResult {
  readonly passed: boolean;
  readonly errors: readonly string[];
  readonly diagnostics: readonly unknown[];
}

export class VerificationEngine {
  constructor(private readonly codeIntelService?: CodeIntelligenceService | undefined) {}

  public async verifyProject(
    tenantId: string,
    projectId: string,
    modifiedFiles: readonly string[],
    userRole: Role = 'ENGINEER'
  ): Promise<VerificationResult> {
    const errors: string[] = [];
    const diagnostics: unknown[] = [];

    // 1. If CodeIntelligenceService is available, verify syntax on modified files
    if (this.codeIntelService && modifiedFiles.length > 0) {
      try {
        const summary = this.codeIntelService.analyzeProject(tenantId, projectId, userRole);
        if (summary && summary.fileAnalyses) {
          for (const filePath of modifiedFiles) {
            const fileAnalysis = summary.fileAnalyses[filePath];
            if (fileAnalysis && fileAnalysis.diagnostics) {
              for (const d of fileAnalysis.diagnostics) {
                if (d.severity === 'error') {
                  errors.push(`Erreur de syntaxe dans ${filePath}: ${d.message}`);
                  diagnostics.push(d);
                }
              }
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Echec de la re-analyse de code intelligence: ${msg}`);
      }
    }

    return {
      passed: errors.length === 0,
      errors,
      diagnostics
    };
  }
}
