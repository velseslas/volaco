/**
 * VibeCode Core - Decision Engine
 * Alternative Generator : génère 1 à N alternatives pour une décision.
 *
 * Phase 9.5 : 3 stratégies de génération :
 *  1. USER_DIRECT : une seule alternative = l'action demandée telle quelle
 *  2. INTELLIGENCE_POOL : reprend les recommendations de l'IntelligencePool
 *  3. LLM (Phase future) : appelle le LLM pour générer plusieurs options
 *
 * Le générateur produit TOUJOURS au moins une alternative (sauf si intent invalide).
 */

import { randomUUID } from 'node:crypto';
import type { IntentResult } from '../conversation-intelligence/types.js';
import type { ProjectMemory } from '../conversation-intelligence/types.js';
import type { IntelligenceRecommendation } from '../intelligence-pool/types.js';
import type { DecisionAlternative, DecisionConstraint } from './types.js';

export class AlternativeGenerator {
  /**
   * Génère des alternatives pour un intent donné.
   * Prend en compte les recommendations consultatives de l'IntelligencePool
   * et les contraintes du projet.
   */
  public async generate(params: {
    intent: IntentResult;
    constraints: readonly DecisionConstraint[];
    memory: ProjectMemory;
    intelligenceRecommendations?: readonly IntelligenceRecommendation[] | undefined;
  }): Promise<readonly DecisionAlternative[]> {
    const { intent, constraints, intelligenceRecommendations = [] } = params;
    const alternatives: DecisionAlternative[] = [];

    // 1. Alternative "directe" : l'action demandée telle quelle
    const direct = this.buildDirectAlternative(intent, constraints);
    alternatives.push(direct);

    // 2. Pour chaque recommendation de l'IntelligencePool, créer une alternative
    for (const rec of intelligenceRecommendations.slice(0, 3)) {
      const alt = this.alternativeFromRecommendation(rec, constraints);
      if (alt && !this.isDuplicate(alt, alternatives)) {
        alternatives.push(alt);
      }
    }

    // 3. Si l'intent est de type CREATE/MODIFY, générer une alternative plus prudente
    if (intent.category === 'CREATE' || intent.category === 'MODIFY') {
      const safer = this.buildSaferAlternative(intent, constraints);
      if (safer && !this.isDuplicate(safer, alternatives)) {
        alternatives.push(safer);
      }
    }

    // 4. Si l'intent est DELETE, générer l'alternative "archiver plutôt que supprimer"
    if (intent.category === 'DELETE') {
      const archive = this.buildArchiveAlternative(intent, constraints);
      if (archive && !this.isDuplicate(archive, alternatives)) {
        alternatives.push(archive);
      }
    }

    return Object.freeze(alternatives);
  }

  private buildDirectAlternative(
    intent: IntentResult,
    constraints: readonly DecisionConstraint[]
  ): DecisionAlternative {
    const violated = this.detectViolatedConstraints(intent.goal + ' ' + intent.requestedAction, constraints);
    return {
      id: 'alt-direct-' + randomUUID().slice(0, 8),
      label: 'Action directe',
      description: `Exécuter la demande telle quelle : ${intent.requestedAction}`,
      constraintsHonored: constraints.filter((c) => !violated.includes(c.id)).map((c) => c.id),
      constraintsViolated: violated,
      riskScore: this.scoreRisk(intent, 'direct'),
      reversible: intent.category !== 'DELETE',
      estimatedEffort: this.estimateEffort(intent),
      source: 'USER',
      targetFiles: intent.entities || [],
      proposedActions: [intent.category]
    };
  }

  private buildSaferAlternative(
    intent: IntentResult,
    constraints: readonly DecisionConstraint[]
  ): DecisionAlternative | null {
    const violated = this.detectViolatedConstraints(
      intent.goal + ' sandboxed preview',
      constraints
    );
    return {
      id: 'alt-safer-' + randomUUID().slice(0, 8),
      label: 'Approche incrémentale avec preview',
      description: `Appliquer la modification dans un sandbox et générer un preview avant validation finale`,
      constraintsHonored: constraints.filter((c) => !violated.includes(c.id)).map((c) => c.id),
      constraintsViolated: violated,
      riskScore: Math.max(10, this.scoreRisk(intent, 'direct') - 30),
      reversible: true,
      estimatedEffort: 'MEDIUM',
      source: 'INTELLIGENCE_POOL',
      targetFiles: intent.entities || [],
      proposedActions: [intent.category, 'PREVIEW']
    };
  }

  private buildArchiveAlternative(
    intent: IntentResult,
    constraints: readonly DecisionConstraint[]
  ): DecisionAlternative | null {
    const violated = this.detectViolatedConstraints(
      'archiver plutôt que supprimer',
      constraints
    );
    return {
      id: 'alt-archive-' + randomUUID().slice(0, 8),
      label: 'Archiver au lieu de supprimer',
      description: `Déplacer les éléments ciblés dans /_archive au lieu de les supprimer définitivement`,
      constraintsHonored: constraints.filter((c) => !violated.includes(c.id)).map((c) => c.id),
      constraintsViolated: violated,
      riskScore: 15,
      reversible: true,
      estimatedEffort: 'LOW',
      source: 'INTELLIGENCE_POOL',
      targetFiles: intent.entities || [],
      proposedActions: ['ARCHIVE']
    };
  }

  private alternativeFromRecommendation(
    rec: IntelligenceRecommendation,
    constraints: readonly DecisionConstraint[]
  ): DecisionAlternative | null {
    if (!rec.proposedActions || rec.proposedActions.length === 0) return null;
    const violated = this.detectViolatedConstraints(rec.description, constraints);
    return {
      id: 'alt-rec-' + rec.id.slice(0, 8),
      label: rec.title,
      description: rec.description,
      constraintsHonored: constraints.filter((c) => !violated.includes(c.id)).map((c) => c.id),
      constraintsViolated: violated,
      riskScore: rec.riskScore,
      reversible: rec.reversible,
      estimatedEffort: rec.estimatedEffort || 'MEDIUM',
      source: 'INTELLIGENCE_POOL',
      targetFiles: rec.targetFiles,
      proposedActions: rec.proposedActions
    };
  }

  private isDuplicate(alt: DecisionAlternative, existing: readonly DecisionAlternative[]): boolean {
    return existing.some((e) => e.label === alt.label || e.description === alt.description);
  }

  private detectViolatedConstraints(
    statement: string,
    constraints: readonly DecisionConstraint[]
  ): string[] {
    const lower = statement.toLowerCase();
    const violated: string[] = [];
    for (const c of constraints) {
      if (c.severity !== 'HARD') continue;
      const stmt = c.statement.toLowerCase();
      // Heuristiques simples
      if (stmt.includes('typescript strict') && lower.includes('any ')) {
        violated.push(c.id);
      } else if (stmt.includes('no direct') && stmt.includes('mistral') && lower.includes('api.mistral.ai')) {
        violated.push(c.id);
      } else if (stmt.includes('npm run') && lower.includes('npm run')) {
        violated.push(c.id);
      } else if (stmt.includes('node -e') && lower.includes('node -e')) {
        violated.push(c.id);
      } else if (stmt.includes('must not execute without') && lower.includes('proactive')) {
        violated.push(c.id);
      }
    }
    return violated;
  }

  private scoreRisk(intent: IntentResult, mode: 'direct' | 'safer'): number {
    const categoryRisk: Record<string, number> = {
      QUESTION: 0,
      EXPLORATION: 5,
      EXPLAIN: 0,
      REVIEW: 10,
      NAVIGATION: 0,
      ANALYZE: 10,
      MODIFY: 40,
      CREATE: 30,
      REFACTOR: 55,
      DEBUG: 50,
      OPTIMIZE: 45,
      TEST: 25,
      DEPLOYMENT: 80,
      DELETE: 90,
      UNKNOWN: 50
    };
    const base = categoryRisk[intent.category] ?? 50;
    return mode === 'safer' ? Math.max(10, base - 30) : base;
  }

  private estimateEffort(intent: IntentResult): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (intent.category === 'QUESTION' || intent.category === 'EXPLAIN') return 'LOW';
    if (intent.category === 'NAVIGATION' || intent.category === 'EXPLORATION') return 'LOW';
    if (intent.category === 'DELETE') return 'LOW';
    if (intent.category === 'CREATE' || intent.category === 'MODIFY') return 'MEDIUM';
    if (intent.category === 'REFACTOR' || intent.category === 'DEPLOYMENT') return 'HIGH';
    return 'MEDIUM';
  }
}
