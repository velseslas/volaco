/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Code Quality Auditor - Complexity & Maintainability Metrics
 */

import { randomUUID } from 'node:crypto';
import type { ApplicationAuditFinding, AuditFileEntry } from '../types.js';

export class CodeQualityAuditor {
  public audit(
    files: readonly AuditFileEntry[],
    complexityThreshold = 15,
    maxFunctionLines = 60
  ): readonly ApplicationAuditFinding[] {
    const findings: ApplicationAuditFinding[] = [];

    for (const file of files) {
      if (!file.path.endsWith('.ts') && !file.path.endsWith('.js') && !file.path.endsWith('.tsx') && !file.path.endsWith('.jsx')) {
        continue;
      }

      const lines = file.content.split('\n');

      // 1. Check Function Length
      this.checkFunctionLengths(file.path, lines, maxFunctionLines, findings);

      // 2. Approximate Cyclomatic Complexity per File / Function
      this.checkCyclomaticComplexity(file.path, lines, complexityThreshold, findings);
    }

    return findings;
  }

  private checkFunctionLengths(
    filePath: string,
    lines: readonly string[],
    maxLines: number,
    findings: ApplicationAuditFinding[]
  ): void {
    let currentFunction: { name: string; startLine: number; braceDepth: number } | null = null;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      // Detect function or method start
      const funcMatch = trimmed.match(/(?:function\s+([a-zA-Z0-9_$]+)|(?:public|private|protected|async|\s)*\s*([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{)/);

      if (funcMatch && !currentFunction && trimmed.endsWith('{')) {
        const fnName = funcMatch[1] || funcMatch[2] || 'anonyme';
        currentFunction = {
          name: fnName,
          startLine: i + 1,
          braceDepth: braceDepth
        };
      }

      // Count braces
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') {
          braceDepth--;
          if (currentFunction && braceDepth <= currentFunction.braceDepth) {
            const length = (i + 1) - currentFunction.startLine + 1;
            if (length > maxLines) {
              findings.push({
                id: `aaf-code-length-${randomUUID().slice(0, 8)}`,
                dimension: 'CODE_QUALITY',
                severity: length > maxLines * 2 ? 'HIGH' : 'MEDIUM',
                title: `Fonction trop volumineuse (${length} lignes)`,
                description: `La fonction '${currentFunction.name}' compte ${length} lignes (seuil maximal recommandé: ${maxLines} lignes).`,
                location: {
                  filePath,
                  line: currentFunction.startLine,
                  symbolName: currentFunction.name
                },
                cause: `Accumulation de responsabilités multiples au sein d'une seule routine.`,
                impact: `Baisse critique de lisibilité, risque élevé de régression et difficulté de test unitaire.`,
                recommendation: `Refactoriser la fonction en la découpant en sous-fonctions spécialisées ou méthodes de classe.`,
                autoRemediable: true,
                suggestedAction: {
                  agentDomain: 'BACKEND',
                  actionType: 'REFACTOR_EXTRACT_METHOD',
                  targetPath: filePath,
                  description: `Découper la fonction ${currentFunction.name} en sous-fonctions plus petites.`
                },
                evidence: [
                  {
                    source: 'AST_NODE',
                    detail: `Fonction mesurée à ${length} lignes entre la ligne ${currentFunction.startLine} et ${i + 1}.`,
                    metricName: 'functionLength',
                    observedValue: length,
                    thresholdValue: maxLines,
                    filePath
                  }
                ]
              });
            }
            currentFunction = null;
          }
        }
      }
    }
  }

  private checkCyclomaticComplexity(
    filePath: string,
    lines: readonly string[],
    complexityThreshold: number,
    findings: ApplicationAuditFinding[]
  ): void {
    let complexity = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const ifMatches = line.match(/\b(if|else\s+if|for|while|switch|case|catch)\b/g);
      if (ifMatches) complexity += ifMatches.length;

      const opMatches = line.match(/(&&|\|\||\?[^:]+:)/g);
      if (opMatches) complexity += opMatches.length;
    }

    if (complexity > complexityThreshold) {
      findings.push({
        id: `aaf-code-complex-${randomUUID().slice(0, 8)}`,
        dimension: 'CODE_QUALITY',
        severity: complexity > complexityThreshold * 2 ? 'CRITICAL' : 'HIGH',
        title: `Complexité cyclomatique excessive (${complexity})`,
        description: `Le fichier '${filePath}' présente une complexité cyclomatique estimée à ${complexity} (seuil: ${complexityThreshold}).`,
        location: { filePath },
        cause: `Imbrication excessive de conditions, boucles et opérateurs logiques.`,
        impact: `Explosion combinatoire du nombre de chemins d'exécution et difficulté de couverture par tests.`,
        recommendation: `Simplifier la logique par du polymorphisme, des tables de décision ou des gardes préalables (early returns).`,
        autoRemediable: false,
        evidence: [
          {
            source: 'AST_NODE',
            detail: `Complexité cyclomatique mesurée: ${complexity}.`,
            metricName: 'cyclomaticComplexity',
            observedValue: complexity,
            thresholdValue: complexityThreshold,
            filePath
          }
        ]
      });
    }
  }
}
