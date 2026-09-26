/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-003)
 * Budget Trimmer & Representation Progression Engine
 */

import type { ProjectAnalysisSummary } from '../../understanding/types.js';
import type {
  ContextBudgetConfig,
  ContextBudgetUsage,
  ContextDecisionItem,
  ContextFileItem,
  ContextSymbolItem,
  FileRepresentation
} from '../types.js';
import type { RawFileCandidate } from './selectors.js';
import { estimateTokens, truncateToTokens } from './token-estimator.js';

export class BudgetTrimmer {
  public applyBudget(
    fileCandidates: readonly RawFileCandidate[],
    symbolCandidates: readonly ContextSymbolItem[],
    decisionCandidates: readonly ContextDecisionItem[],
    budget: ContextBudgetConfig,
    summary: ProjectAnalysisSummary
  ): {
    files: readonly ContextFileItem[];
    symbols: readonly ContextSymbolItem[];
    decisions: readonly ContextDecisionItem[];
    budgetUsage: ContextBudgetUsage;
  } {
    let remainingTokens = budget.maxTokens;
    let truncatedItemsCount = 0;
    const finalFiles: ContextFileItem[] = [];

    // 1. Process Files under budget constraints
    for (const candidate of fileCandidates) {
      if (finalFiles.length >= budget.maxFiles) {
        truncatedItemsCount++;
        continue;
      }

      const fullTokens = estimateTokens(candidate.content);
      const fa = summary.fileAnalyses[candidate.filePath];

      if (fullTokens <= remainingTokens) {
        // FULL fits within remaining budget
        finalFiles.push({
          filePath: candidate.filePath,
          content: candidate.content,
          lineCount: candidate.content.split('\n').length,
          estimatedTokens: fullTokens,
          provenance: candidate.provenance,
          includedSymbols: fa?.symbols.map(s => s.name),
          representation: 'FULL'
        });
        remainingTokens -= fullTokens;
      } else {
        // FULL exceeds remaining budget -> Try OUTLINE representation
        const outlineContent = this.generateOutline(candidate.filePath, summary);
        const outlineTokens = estimateTokens(outlineContent);

        if (outlineTokens <= remainingTokens && outlineTokens > 0) {
          finalFiles.push({
            filePath: candidate.filePath,
            content: outlineContent,
            lineCount: outlineContent.split('\n').length,
            estimatedTokens: outlineTokens,
            provenance: candidate.provenance,
            includedSymbols: fa?.symbols.map(s => s.name),
            representation: 'OUTLINE'
          });
          remainingTokens -= outlineTokens;
        } else if (candidate.isAnchor && remainingTokens > 20) {
          // Anchors have absolute priority: truncate deterministically to remaining budget
          const { text: truncatedText, estimatedTokens: truncatedTokens } = truncateToTokens(
            candidate.content,
            remainingTokens
          );

          finalFiles.push({
            filePath: candidate.filePath,
            content: truncatedText,
            lineCount: truncatedText.split('\n').length,
            estimatedTokens: truncatedTokens,
            provenance: candidate.provenance,
            includedSymbols: fa?.symbols.map(s => s.name),
            representation: 'TRUNCATED'
          });
          remainingTokens = 0;
          truncatedItemsCount++;
        } else {
          // Non-anchor that cannot fit is excluded
          truncatedItemsCount++;
        }
      }
    }

    // 2. Process Symbols under budget constraints
    const finalSymbols: ContextSymbolItem[] = [];
    for (const sym of symbolCandidates) {
      if (finalSymbols.length >= budget.maxSymbols) {
        truncatedItemsCount++;
        continue;
      }

      if (sym.estimatedTokens <= remainingTokens) {
        finalSymbols.push(sym);
        remainingTokens -= sym.estimatedTokens;
      } else {
        truncatedItemsCount++;
      }
    }

    // 3. Process Decisions under budget constraints
    const finalDecisions: ContextDecisionItem[] = [];
    for (const dec of decisionCandidates) {
      if (finalDecisions.length >= budget.maxDecisions) {
        truncatedItemsCount++;
        continue;
      }

      const decTokens = estimateTokens(`${dec.title}\n${dec.rationale}\n${dec.impact}`);
      if (decTokens <= remainingTokens) {
        finalDecisions.push(dec);
        remainingTokens -= decTokens;
      } else {
        truncatedItemsCount++;
      }
    }

    const totalTokensUsed = budget.maxTokens - remainingTokens;

    const budgetUsage: ContextBudgetUsage = {
      totalTokens: Math.max(0, totalTokensUsed),
      fileCount: finalFiles.length,
      symbolCount: finalSymbols.length,
      decisionCount: finalDecisions.length,
      isBudgetExceeded: remainingTokens < 0,
      truncatedItemsCount
    };

    return {
      files: finalFiles,
      symbols: finalSymbols,
      decisions: finalDecisions,
      budgetUsage
    };
  }

  /**
   * Generates a concise OUTLINE representation of a file using AST symbols from AINT-001.
   */
  private generateOutline(filePath: string, summary: ProjectAnalysisSummary): string {
    const fa = summary.fileAnalyses[filePath];
    if (!fa || fa.symbols.length === 0) {
      return '';
    }

    const relevantSymbols = fa.symbols.filter(
      sym => sym.isExported || sym.kind === 'component' || sym.route
    );
    if (relevantSymbols.length === 0) {
      return '';
    }

    const lines: string[] = [`// [OUTLINE: ${filePath}]`];
    for (const sym of relevantSymbols) {
      const sig = sym.signature ?? `${sym.kind} ${sym.name}`;
      lines.push(sig);
    }

    return lines.join('\n');
  }
}
