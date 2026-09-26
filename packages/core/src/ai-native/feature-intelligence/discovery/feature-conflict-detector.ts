/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Conflict Detector - Detects Architectural, DNA & Security Incompatibilities
 */

import type { ApplicationDNA } from '../../dna/types.js';
import type { ArchitecturalDecisionRecord } from '../../conversation-intelligence/types.js';

export interface ConflictCheckResult {
  readonly hasConflict: boolean;
  readonly conflictKind?: 'DNA_CONFLICT' | 'SECURITY_CONFLICT' | 'ARCHITECTURE_CONFLICT' | undefined;
  readonly reason?: string | undefined;
}

export class FeatureConflictDetector {
  /**
   * Vérifie les conflits potentiels avec l'Application DNA et les décisions
   */
  public checkConflict(params: {
    readonly title: string;
    readonly description: string;
    readonly proposedSolution: string;
    readonly dna?: ApplicationDNA | undefined;
    readonly decisions?: readonly ArchitecturalDecisionRecord[] | undefined;
  }): ConflictCheckResult {
    const combinedText = `${params.title} ${params.description} ${params.proposedSolution}`.toLowerCase();

    // 1. Conflit DNA : Indépendance vis-à-vis des providers (Multi-provider requirement)
    if (params.dna) {
      // Si la proposition suggère un couplage fort avec un provider propriétaire spécifique
      if (
        (combinedText.includes('coupler directement à openai') ||
         combinedText.includes('verrouiller sur aws') ||
         combinedText.includes('dépendre exclusivement de firebase')) &&
        params.dna.summary.overallHealth !== 'DEGRADED'
      ) {
        return {
          hasConflict: true,
          conflictKind: 'DNA_CONFLICT',
          reason: 'CONFLICT WITH APPLICATION DNA : La proposition introduit un couplage propriétaire contraire au principe d indépendance des providers.'
        };
      }

      // Conflit d'architecture : SPA client-only recevant du SQL direct
      if (
        params.dna.architecture.primaryPattern.pattern === 'SPA' &&
        (combinedText.includes('connexion sql directe') || combinedText.includes('pilote postgresql natif'))
      ) {
        return {
          hasConflict: true,
          conflictKind: 'ARCHITECTURE_CONFLICT',
          reason: 'CONFLICT WITH ARCHITECTURE : Impossible d intégrer une connexion directe à la base SQL dans une application SPA côté client.'
        };
      }
    }

    // 2. Conflit de Sécurité : eval, innerHTML non sanitisé ou stockage de clés en clair
    if (
      combinedText.includes('stocker la clé api en clair') ||
      combinedText.includes('utiliser eval') ||
      combinedText.includes('désactiver rbac')
    ) {
      return {
        hasConflict: true,
        conflictKind: 'SECURITY_CONFLICT',
        reason: 'CONFLICT WITH SECURITY POLICIES : La solution suggérée viole les règles de sécurité fondamentales (secrets en clair ou désactivation du RBAC).'
      };
    }

    // 3. Conflits avec les ADRs existants
    if (params.decisions) {
      for (const dec of params.decisions) {
        if (dec.status === 'ACTIVE') {
          const decLow = dec.statement.toLowerCase();
          if (decLow.includes('pas de mode sombre') && combinedText.includes('mode sombre')) {
            return {
              hasConflict: true,
              conflictKind: 'ARCHITECTURE_CONFLICT',
              reason: `CONFLICT WITH DECISION : L opportunité est en conflit avec la décision validée : "${dec.statement}".`
            };
          }
        }
      }
    }

    return {
      hasConflict: false
    };
  }
}
