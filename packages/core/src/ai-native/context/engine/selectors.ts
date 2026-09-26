/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-003)
 * Context Candidate Selectors & Security Filters
 */

import { logger } from '../../../logger.js';
import type { ProjectAnalysisSummary } from '../../understanding/types.js';
import type { ApplicationDNA } from '../../dna/types.js';
import type {
  ContextDecisionItem,
  ContextItemProvenance,
  ContextRelevanceReason,
  ContextRequest,
  ContextSymbolItem,
  IRevisionProvider,
  IWorkspaceProvider
} from '../types.js';
import {
  calculateRelevanceScore,
  compareCandidates,
  computeLexicalScore,
  tokenizeText,
  type ScoredCandidate
} from './ranker.js';
import { estimateTokens } from './token-estimator.js';

export interface RawFileCandidate {
  readonly filePath: string;
  readonly content: string;
  readonly score: number;
  readonly provenance: ContextItemProvenance;
  readonly isAnchor: boolean;
}

/**
 * Checks whether a given file path corresponds to a secret, credential, or sensitive file.
 */
export function isSecretPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const name = lower.split('/').pop() || lower;

  if (name.startsWith('.env')) return true;
  if (name.endsWith('.pem')) return true;
  if (name.endsWith('.key')) return true;
  if (name.endsWith('.p12')) return true;
  if (name.endsWith('.pfx')) return true;
  if (name.includes('credentials') || name.includes('secret')) return true;

  return false;
}

/**
 * Checks whether a given file path corresponds to a generated, lock, or binary asset file.
 */
export function isDefaultExcludedPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const name = lower.split('/').pop() || lower;

  // Paths
  if (
    lower.startsWith('node_modules/') ||
    lower.includes('/node_modules/') ||
    lower.startsWith('dist/') ||
    lower.includes('/dist/') ||
    lower.startsWith('build/') ||
    lower.includes('/build/') ||
    lower.startsWith('coverage/') ||
    lower.includes('/coverage/') ||
    lower.startsWith('.cache/') ||
    lower.includes('/.cache/') ||
    lower.startsWith('.git/') ||
    lower.includes('/.git/')
  ) {
    return true;
  }

  // Lock files
  if (name === 'package-lock.json' || name === 'yarn.lock' || name === 'pnpm-lock.yaml') {
    return true;
  }

  // Binary / Static Assets
  const assetExts = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.woff', '.woff2', '.ttf', '.eot'];
  if (assetExts.some(ext => name.endsWith(ext))) {
    return true;
  }

  return false;
}

/**
 * Checks whether a given file path is a test file.
 */
export function isTestFilePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.includes('.test.') ||
    lower.includes('.spec.') ||
    lower.includes('__tests__/') ||
    lower.startsWith('test/') ||
    lower.startsWith('tests/')
  );
}

export class ContextCandidateSelector {
  public selectCandidates(
    request: ContextRequest,
    summary: ProjectAnalysisSummary,
    dna: ApplicationDNA,
    allFiles: Record<string, string>,
    workspaceProvider?: IWorkspaceProvider,
    revisionProvider?: IRevisionProvider
  ): {
    fileCandidates: readonly RawFileCandidate[];
    symbolCandidates: readonly ContextSymbolItem[];
    decisionCandidates: readonly ContextDecisionItem[];
    activeDiagnostics: readonly string[];
    traces: readonly string[];
  } {
    const traces: string[] = [];
    const allPaths = Object.keys(allFiles).sort();
    const queryTokens = tokenizeText(request.taskDescription ?? '');

    // 1. Check if tests should be included
    const taskLower = (request.taskDescription ?? '').toLowerCase();
    const isTestExplicitlyRequested =
      taskLower.includes('test') ||
      taskLower.includes('spec') ||
      (request.targetLayers ?? []).some(l => l.toLowerCase() === 'tests') ||
      (request.targetFiles ?? []).some(isTestFilePath) ||
      (request.targetSymbols ?? []).some(s => s.toLowerCase().includes('test'));

    if (isTestExplicitlyRequested) {
      traces.push('Tests are explicitly requested by context; allowing test files.');
    }

    // 2. Identify Workspace active & dirty files
    let activeWorkspaceFile: string | undefined = undefined;
    const dirtyWorkspaceFiles = new Set<string>();

    if (workspaceProvider && workspaceProvider.getWorkspace) {
      try {
        const ws = workspaceProvider.getWorkspace(request.tenantId, request.projectId);
        if (ws && ws.state) {
          if (ws.state.activeFile && allFiles[ws.state.activeFile]) {
            activeWorkspaceFile = ws.state.activeFile;
          }
          if (ws.state.dirtyFiles && Array.isArray(ws.state.dirtyFiles)) {
            for (const df of ws.state.dirtyFiles) {
              if (allFiles[df]) dirtyWorkspaceFiles.add(df);
            }
          } else if (ws.state.isDirty && ws.state.activeFile) {
            dirtyWorkspaceFiles.add(ws.state.activeFile);
          }
        }
      } catch (err) {
        logger.warn('Workspace state optionnel indisponible — ignoré', {
          component: 'context-selectors',
          err: err instanceof Error ? err.message : String(err)
        });
      }
    }

    // 3. Identify Primary Anchors
    const targetFileSet = new Set(request.targetFiles ?? []);
    const primaryAnchorMap = new Map<string, ContextRelevanceReason>();

    for (const tf of targetFileSet) {
      if (allFiles[tf]) {
        primaryAnchorMap.set(tf, 'TARGET_FILE');
      }
    }

    if (activeWorkspaceFile && !primaryAnchorMap.has(activeWorkspaceFile)) {
      primaryAnchorMap.set(activeWorkspaceFile, 'ACTIVE_WORKSPACE_FILE');
    }

    for (const df of dirtyWorkspaceFiles) {
      if (!primaryAnchorMap.has(df)) {
        primaryAnchorMap.set(df, 'DIRTY_WORKSPACE_FILE');
      }
    }

    traces.push(`Identified ${primaryAnchorMap.size} primary anchor(s).`);

    // 4. Graph Neighbors (1-hop only from DNA)
    const directDeps = new Set<string>();
    const reverseDeps = new Set<string>();

    for (const anchor of primaryAnchorMap.keys()) {
      const directs = dna.graphMetrics.directDependencies[anchor] ?? [];
      for (const d of directs) {
        if (!primaryAnchorMap.has(d)) directDeps.add(d);
      }

      const reverses = dna.graphMetrics.reverseDependencies[anchor] ?? [];
      for (const r of reverses) {
        if (!primaryAnchorMap.has(r)) reverseDeps.add(r);
      }
    }

    // 5. Entry Points & Centrality
    const entryPoints = new Set<string>(dna.architecture.entryPoints.map(ep => ep.path));
    const maxDependents = dna.graphMetrics.mostDependedOnFiles[0]?.dependentsCount ?? 1;
    const centralityMap = new Map<string, number>();
    for (const item of dna.graphMetrics.mostDependedOnFiles) {
      if (item.dependentsCount > 0) {
        centralityMap.set(item.path, item.dependentsCount / Math.max(maxDependents, 1));
      }
    }

    // 6. Target Layers & Modules
    const targetLayers = new Set((request.targetLayers ?? []).map(l => l.toLowerCase()));
    const layerFiles = new Set<string>();
    if (targetLayers.size > 0) {
      for (const layer of dna.architecture.layers) {
        if (targetLayers.has(layer.kind.toLowerCase())) {
          for (const fp of layer.filePaths) layerFiles.add(fp);
        }
      }
    }

    // 7. Diagnostics Mapping
    const diagnosticsByFile = new Map<string, string[]>();
    for (const [fp, fa] of Object.entries(summary.fileAnalyses)) {
      const activeDiags = fa.diagnostics
        .filter(d => d.severity === 'error' || d.severity === 'warning')
        .map(d => `[${d.severity.toUpperCase()}] ${fp}:${d.line ?? 1} - ${d.message}`);
      if (activeDiags.length > 0) {
        diagnosticsByFile.set(fp, activeDiags);
      }
    }

    // 8. Evaluate and Score File Candidates
    const targetSymbolSet = new Set((request.targetSymbols ?? []).map(s => s.toLowerCase()));
    const rawCandidates: RawFileCandidate[] = [];

    for (const filePath of allPaths) {
      // Security: Secrets are excluded unconditionally
      if (isSecretPath(filePath)) {
        continue;
      }

      // Default exclusions (generated, lock, assets)
      if (isDefaultExcludedPath(filePath)) {
        continue;
      }

      // Tests excluded unless explicitly requested
      if (isTestFilePath(filePath) && !isTestExplicitlyRequested) {
        continue;
      }

      const content = allFiles[filePath] ?? '';
      const fa = summary.fileAnalyses[filePath];
      const isAnchor = primaryAnchorMap.has(filePath);
      const hasTargetSymbol = (fa?.symbols ?? []).some(s => targetSymbolSet.has(s.name.toLowerCase()));

      // Determine main reason and score components
      let reason: ContextRelevanceReason = 'INTENT_SEMANTIC_MATCH';
      let detail = `Relevant to task through semantic match`;

      if (isAnchor) {
        reason = primaryAnchorMap.get(filePath)!;
        detail = `Primary anchor file (${reason})`;
      } else if (hasTargetSymbol) {
        reason = 'TARGET_SYMBOL';
        detail = `Contains explicitly targeted symbol`;
      } else if (targetLayers.size > 0 && layerFiles.has(filePath)) {
        reason = 'TARGET_LAYER';
        detail = `Member of target architectural layer`;
      } else if (directDeps.has(filePath)) {
        reason = 'DIRECT_DEPENDENCY';
        detail = `Direct dependency of an anchor file`;
      } else if (reverseDeps.has(filePath)) {
        reason = 'REVERSE_DEPENDENCY';
        detail = `Direct dependent (reverse dependency) of an anchor file`;
      } else if (entryPoints.has(filePath)) {
        reason = 'ENTRY_POINT';
        detail = `Application architecture entry point`;
      } else if ((centralityMap.get(filePath) ?? 0) >= 0.5) {
        reason = 'HIGH_CENTRALITY';
        detail = `High architectural centrality in project graph`;
      }

      // Lexical match
      const fileTextToMatch = `${filePath} ${fa?.symbols.map(s => s.name).join(' ') ?? ''}`;
      const { score: lexScore, matchedTokens } = computeLexicalScore(queryTokens, fileTextToMatch);

      const hasDiag = diagnosticsByFile.has(filePath);

      const score = calculateRelevanceScore({
        isAnchor,
        isTargetSymbol: hasTargetSymbol,
        isTargetLayer: targetLayers.size > 0 && layerFiles.has(filePath),
        lexicalScore: lexScore,
        isDirectDependency: directDeps.has(filePath),
        isReverseDependency: reverseDeps.has(filePath),
        isEntryPoint: entryPoints.has(filePath),
        centralityRatio: centralityMap.get(filePath) ?? 0,
        hasDiagnostic: hasDiag
      });

      // Filter: only keep if anchor, has target symbol, dependency, entrypoint, layer target, or has positive lexical match
      if (isAnchor || hasTargetSymbol || directDeps.has(filePath) || reverseDeps.has(filePath) || entryPoints.has(filePath) || layerFiles.has(filePath) || lexScore > 0) {
        const provenance: ContextItemProvenance = {
          reason,
          score,
          detail,
          matchedTokens: matchedTokens.length > 0 ? matchedTokens : undefined
        };

        rawCandidates.push({
          filePath,
          content,
          score,
          provenance,
          isAnchor
        });
      }
    }

    // Sort file candidates using canonical comparator
    const sortedFileCandidates = [...rawCandidates].sort((a, b) =>
      compareCandidates(
        {
          score: a.score,
          filePath: a.filePath,
          reason: a.provenance.reason
        },
        {
          score: b.score,
          filePath: b.filePath,
          reason: b.provenance.reason
        }
      )
    );

    // 9. Symbols Selection
    const symbolCandidates: ContextSymbolItem[] = [];
    const seenSymbolKeys = new Set<string>();

    for (const candidate of sortedFileCandidates) {
      const fa = summary.fileAnalyses[candidate.filePath];
      if (!fa) continue;

      for (const sym of fa.symbols) {
        const isExplicitTarget = targetSymbolSet.has(sym.name.toLowerCase());
        const { score: symLexScore, matchedTokens } = computeLexicalScore(queryTokens, sym.name);

        if (isExplicitTarget || symLexScore > 0 || candidate.isAnchor) {
          const symReason: ContextRelevanceReason = isExplicitTarget
            ? 'TARGET_SYMBOL'
            : symLexScore > 0
            ? 'INTENT_SEMANTIC_MATCH'
            : candidate.provenance.reason;

          const symScore = calculateRelevanceScore({
            isTargetSymbol: isExplicitTarget,
            isAnchor: candidate.isAnchor,
            lexicalScore: symLexScore
          });

          const rendered = `${sym.signature ?? `${sym.kind} ${sym.name}`}${sym.docstring ? `\n${sym.docstring}` : ''}`;
          const key = `${candidate.filePath}:${sym.name}:${sym.lineStart}`;
          seenSymbolKeys.add(key);

          symbolCandidates.push({
            name: sym.name,
            filePath: candidate.filePath,
            kind: sym.kind,
            lineStart: sym.lineStart,
            lineEnd: sym.lineEnd,
            signature: sym.signature,
            docstring: sym.docstring,
            estimatedTokens: estimateTokens(rendered),
            provenance: {
              reason: symReason,
              score: symScore,
              detail: isExplicitTarget ? 'Explicitly targeted symbol' : `Symbol in ${candidate.filePath}`,
              matchedTokens: matchedTokens.length > 0 ? matchedTokens : undefined
            }
          });
        }
      }
    }

    // Include any target symbols in the project that were not part of sortedFileCandidates
    if (targetSymbolSet.size > 0) {
      for (const [fp, fa] of Object.entries(summary.fileAnalyses)) {
        if (isSecretPath(fp) || isDefaultExcludedPath(fp)) continue;
        for (const sym of fa.symbols) {
          const key = `${fp}:${sym.name}:${sym.lineStart}`;
          if (targetSymbolSet.has(sym.name.toLowerCase()) && !seenSymbolKeys.has(key)) {
            seenSymbolKeys.add(key);
            const rendered = `${sym.signature ?? `${sym.kind} ${sym.name}`}${sym.docstring ? `\n${sym.docstring}` : ''}`;
            symbolCandidates.push({
              name: sym.name,
              filePath: fp,
              kind: sym.kind,
              lineStart: sym.lineStart,
              lineEnd: sym.lineEnd,
              signature: sym.signature,
              docstring: sym.docstring,
              estimatedTokens: estimateTokens(rendered),
              provenance: {
                reason: 'TARGET_SYMBOL',
                score: 0.9,
                detail: 'Explicitly targeted symbol'
              }
            });
          }
        }
      }
    }

    // Sort symbol candidates canonically
    symbolCandidates.sort((a, b) =>
      compareCandidates(
        {
          score: a.provenance.score,
          filePath: a.filePath,
          lineStart: a.lineStart,
          name: a.name,
          reason: a.provenance.reason
        },
        {
          score: b.provenance.score,
          filePath: b.filePath,
          lineStart: b.lineStart,
          name: b.name,
          reason: b.provenance.reason
        }
      )
    );

    // 10. Technical Decisions Selection
    const decisionCandidates: ContextDecisionItem[] = [];
    if (revisionProvider && revisionProvider.listRevisions) {
      try {
        const revs = revisionProvider.listRevisions(request.tenantId, request.projectId);
        // Look through recent revisions
        const recentRevs = revs.slice(-5);
        for (const rev of recentRevs) {
          for (const dec of rev.decisions ?? []) {
            const { score: decLex } = computeLexicalScore(queryTokens, `${dec.title} ${dec.rationale} ${dec.impact}`);
            const score = calculateRelevanceScore({
              isTechnicalDecision: true,
              lexicalScore: decLex
            });

            decisionCandidates.push({
              id: dec.id,
              title: dec.title,
              rationale: dec.rationale,
              impact: dec.impact,
              provenance: {
                reason: 'RECENT_TECHNICAL_DECISION',
                score,
                detail: `Recent technical decision from revision #${rev.revisionNumber}`
              }
            });
          }
        }
      } catch (err) {
        logger.warn('Révisions inaccessibles — fallback appliqué', {
          component: 'context-selectors',
          err: err instanceof Error ? err.message : String(err)
        });
      }
    }

    // Sort decisions canonically by score descending, then title
    decisionCandidates.sort((a, b) => {
      if (b.provenance.score !== a.provenance.score) {
        return b.provenance.score - a.provenance.score;
      }
      return a.title.localeCompare(b.title);
    });

    // 11. Active Diagnostics Collection
    const activeDiagnostics: string[] = [];
    for (const candidate of sortedFileCandidates) {
      const diags = diagnosticsByFile.get(candidate.filePath);
      if (diags) {
        activeDiagnostics.push(...diags);
      }
    }
    activeDiagnostics.sort();

    return {
      fileCandidates: sortedFileCandidates,
      symbolCandidates,
      decisionCandidates,
      activeDiagnostics,
      traces
    };
  }
}
