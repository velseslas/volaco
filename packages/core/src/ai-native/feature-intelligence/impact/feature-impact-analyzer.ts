/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Impact Analyzer - Unified Impact Assessment
 */

import type { FeatureImpactAnalysis } from '../types.js';
import { DependencyAnalyzer } from './dependency-analyzer.js';
import { BlastRadiusAnalyzer } from './blast-radius-analyzer.js';

export class FeatureImpactAnalyzer {
  private readonly depAnalyzer = new DependencyAnalyzer();
  private readonly blastAnalyzer = new BlastRadiusAnalyzer();

  public analyzeImpact(params: {
    readonly affectedModules: readonly string[];
    readonly files?: readonly { readonly path: string }[] | undefined;
    readonly title: string;
  }): FeatureImpactAnalysis {
    const dependencies = this.depAnalyzer.analyzeDependencies(params.affectedModules);
    const touchesCoreOrAuth = params.title.toLowerCase().includes('auth') ||
      params.affectedModules.some((m) => m.includes('core') || m.includes('auth'));

    const matchedFiles: string[] = [];
    if (params.files) {
      for (const f of params.files) {
        if (params.affectedModules.some((m) => f.path.startsWith(m) || f.path.includes(m))) {
          matchedFiles.push(f.path);
        }
      }
    }

    const { blastRadiusScore, estimatedComplexity, estimatedEffort } = this.blastAnalyzer.computeBlastRadius({
      affectedModulesCount: params.affectedModules.length,
      affectedFilesCount: matchedFiles.length,
      touchesCoreOrAuth
    });

    const isBreaking = blastRadiusScore > 75;

    const risks: string[] = [];
    if (touchesCoreOrAuth) {
      risks.push('Impact potentiel sur la gestion des sessions utilisateur');
    }
    if (blastRadiusScore > 50) {
      risks.push('Multiple modules concernés nécessitant des tests de non-régression');
    }

    return {
      affectedModules: params.affectedModules,
      affectedFiles: matchedFiles,
      affectedLayers: ['UI', 'SERVICE'],
      dependencies,
      conflicts: [],
      risks,
      blastRadiusScore,
      isBreaking,
      estimatedComplexity,
      estimatedEffort
    };
  }
}
