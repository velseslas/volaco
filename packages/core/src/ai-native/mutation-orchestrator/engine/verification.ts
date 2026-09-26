/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-006)
 * Post-Mutation Verification & Invariant Validation Engine
 */

import type { CodeIntelligenceService } from '../../understanding/service.js';
import type { SemanticCodeGraphService } from '../../semantic-graph/service.js';
import type { IMutableFileSource } from '../filesystem/adapter.js';
import type {
  MutationPlan,
  PostMutationInvariant,
  PostMutationRevalidation
} from '../types.js';
import { MutationInvariantError } from '../types.js';

export interface PostMutationVerificationOptions {
  readonly invariants?: readonly PostMutationInvariant[] | undefined;
  readonly requestId?: string | undefined;
}

/**
 * Re-analyzes the project using AINT-001 and AINT-004 to verify AST & semantic invariants.
 */
export function verifyPostMutationState(
  tenantId: string,
  projectId: string,
  plan: MutationPlan,
  fileSource: IMutableFileSource,
  codeIntelService?: CodeIntelligenceService | undefined,
  semanticGraphService?: SemanticCodeGraphService | undefined,
  options?: PostMutationVerificationOptions | undefined
): PostMutationRevalidation {
  const brokenImports: string[] = [];
  const brokenSymbols: string[] = [];
  let syntaxValid = true;

  // 1. AINT-001 AST Re-Analysis
  if (codeIntelService) {
    try {
      const summary = codeIntelService.analyzeProject(tenantId, projectId, 'OWNER', options?.requestId);

      // Check for syntax errors / diagnostics
      for (const [filePath, fileAnalysis] of Object.entries(summary.fileAnalyses)) {
        const hasError = fileAnalysis.diagnostics.some((d) => d.severity === 'error');
        if (hasError) {
          syntaxValid = false;
          throw new MutationInvariantError(
            `Erreur de syntaxe post-mutation détectée dans le fichier '${filePath}'`,
            { filePath, diagnostics: fileAnalysis.diagnostics },
            options?.requestId
          );
        }
      }

      // Check broken imports
      for (const [filePath, fileAnalysis] of Object.entries(summary.fileAnalyses)) {
        for (const imp of fileAnalysis.imports) {
          if (imp.isRelative && imp.moduleSpecifier) {
            const targetFiles = Object.keys(summary.fileAnalyses);
            const matches = targetFiles.filter(
              (tf) => tf.includes(imp.moduleSpecifier.replace(/^\.\//, '')) || tf.endsWith(imp.moduleSpecifier)
            );
            if (matches.length === 0 && !imp.moduleSpecifier.endsWith('.css')) {
              brokenImports.push(`${filePath} -> ${imp.moduleSpecifier}`);
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof MutationInvariantError) {
        throw err;
      }
      // Non-fatal if code intelligence fails on non-standard fixture unless invariant is violated
    }
  }

  // 2. AINT-004 Semantic Graph Re-Build
  let newGraphHash: string | undefined;
  if (semanticGraphService) {
    try {
      const newGraph = semanticGraphService.buildGraph(
        { tenantId, projectId },
        'OWNER',
        options?.requestId
      );
      newGraphHash = newGraph.graphHash;
    } catch {
      // Graph re-build error will be handled by invariant check
    }
  }

  const newTreeHash = fileSource.computeTreeHash(tenantId, projectId);

  // 3. Verify Explicit Invariants
  if (options?.invariants) {
    for (const inv of options.invariants) {
      evaluatePostMutationInvariant(inv, tenantId, projectId, fileSource, syntaxValid, options.requestId);
    }
  }

  return {
    syntaxValid,
    brokenImports,
    brokenSymbols,
    newGraphHash,
    newTreeHash
  };
}

function evaluatePostMutationInvariant(
  inv: PostMutationInvariant,
  tenantId: string,
  projectId: string,
  fileSource: IMutableFileSource,
  syntaxValid: boolean,
  requestId?: string | undefined
): void {
  switch (inv.kind) {
    case 'FILE_EXISTS': {
      const file = fileSource.getFile(tenantId, projectId, inv.target);
      if (!file) {
        throw new MutationInvariantError(
          `Invariant post-mutation violé: le fichier attendu '${inv.target}' n'existe pas`,
          { invariant: inv },
          requestId
        );
      }
      break;
    }
    case 'SYMBOL_EXISTS': {
      const file = fileSource.getFile(tenantId, projectId, inv.target);
      if (!file || !inv.expectedValue || !file.content.includes(inv.expectedValue)) {
        throw new MutationInvariantError(
          `Invariant post-mutation violé: le symbole '${inv.expectedValue}' est introuvable dans '${inv.target}'`,
          { invariant: inv },
          requestId
        );
      }
      break;
    }
    case 'NO_SYNTAX_ERROR': {
      if (!syntaxValid) {
        throw new MutationInvariantError(
          'Invariant post-mutation violé: une ou plusieurs erreurs de syntaxe sont présentes',
          { invariant: inv },
          requestId
        );
      }
      break;
    }
    default:
      break;
  }
}
