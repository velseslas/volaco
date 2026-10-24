/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Audit Bridge - Transforms AINT-013 Findings into Product Evolution Opportunities
 */

import type { ApplicationAuditReport, ApplicationAuditFinding } from '../../application-audit/types.js';
import type { RawOpportunityGap } from '../discovery/feature-gap-detector.js';

export class FeatureAuditBridge {
  /**
   * Extrait des opportunités d'amélioration produit à partir des résultats d'audit AINT-013
   */
  public extractOpportunitiesFromAudit(report: ApplicationAuditReport): readonly RawOpportunityGap[] {
    const opportunities: RawOpportunityGap[] = [];

    // Une dimension non mesurée (null) ne doit jamais être interprétée comme
    // un échec ni coercée à 0 par une comparaison JavaScript.
    const scoreText = (value: number | null): string => value === null ? 'non mesuré' : `${value}/100`;
    const below = (value: number | null, threshold: number): boolean => value !== null && value < threshold;

    // 1. Détection Opportunité Accessibilité (si score < 70 ou findings A11y présents)
    const a11yFindings = report.findings.filter((f: ApplicationAuditFinding) => f.dimension === 'ACCESSIBILITY');
    if (a11yFindings.length >= 2 || below(report.dimensionScores.accessibility, 70)) {
      opportunities.push({
        id: 'audit-opp-a11y-theme',
        title: 'Mise en Conformité Accessibilité WCAG 2.1 AA & Mode Sombre',
        description: 'Optimiser les contrastes de couleurs, la taille des cibles tactiles et ajouter un sélecteur de thème sombre.',
        category: 'UX_IMPROVEMENT',
        problem: `L audit AINT-013 a identifié ${a11yFindings.length} non-conformités d accessibilité (score: ${scoreText(report.dimensionScores.accessibility)}).`,
        proposedSolution: 'Introduire des variables CSS standardisées, un commutateur ThemeToggle et des cibles tactiles >= 44x44px.',
        affectedModules: ['src/styles', 'src/components/theme'],
        dependencies: [],
        initialEvidence: a11yFindings.slice(0, 3).map((f: ApplicationAuditFinding, idx: number) => ({
          id: `ev-audit-a11y-${idx}`,
          source: 'audit',
          description: f.description,
          confidence: 0.9,
          references: [
            {
              sourceId: `finding-${f.id}`,
              filePath: f.location.filePath,
              line: f.location.line,
              detail: `Sévérité: ${f.severity}. Recommandation: ${f.recommendation}`
            }
          ]
        }))
      });
    }

    // 2. Détection Opportunité UX / Responsive (si débordements ou liens morts)
    const uxFindings = report.findings.filter((f: ApplicationAuditFinding) => f.dimension === 'UX');
    if (uxFindings.length >= 1 || below(report.dimensionScores.ux, 75)) {
      opportunities.push({
        id: 'audit-opp-responsive-nav',
        title: 'Refonte Ergonomique & Navigation Mobile Optimisée',
        description: 'Éliminer les débordements horizontaux et remplacer les ancres mortes par une navigation fluide.',
        category: 'UX_IMPROVEMENT',
        problem: `Problèmes ergonomiques détectés par l audit UX (score: ${scoreText(report.dimensionScores.ux)}).`,
        proposedSolution: 'Remplacer les largeurs fixes par du CSS Grid/Flexbox adaptatif et brancher les actions sur un routeur applicatif.',
        affectedModules: ['src/navigation', 'src/views'],
        dependencies: [],
        initialEvidence: uxFindings.slice(0, 3).map((f: ApplicationAuditFinding, idx: number) => ({
          id: `ev-audit-ux-${idx}`,
          source: 'ux',
          description: f.description,
          confidence: 0.85,
          references: [
            {
              sourceId: `finding-${f.id}`,
              filePath: f.location.filePath,
              detail: f.impact
            }
          ]
        }))
      });
    }

    // 3. Détection Opportunité Performance (DOM Bloat / Scripts monolithiques)
    const perfFindings = report.findings.filter((f: ApplicationAuditFinding) => f.dimension === 'PERFORMANCE');
    if (perfFindings.length >= 1 || below(report.dimensionScores.performance, 70)) {
      opportunities.push({
        id: 'audit-opp-perf-virtualization',
        title: 'Virtualisation du Rendu & Découpage Modulaire',
        description: 'Optimiser le chargement des scripts volumineux et virtualiser les listes lourdes.',
        category: 'ARCHITECTURE',
        problem: `Surcharge DOM et scripts bloquants identifiés lors de l audit de performance (score: ${scoreText(report.dimensionScores.performance)}).`,
        proposedSolution: 'Adopter le chargement asynchrone (defer/async) et découper les composants volumineux.',
        affectedModules: ['src/components', 'index.html'],
        dependencies: [],
        initialEvidence: perfFindings.slice(0, 3).map((f: ApplicationAuditFinding, idx: number) => ({
          id: `ev-audit-perf-${idx}`,
          source: 'audit',
          description: f.description,
          confidence: 0.85,
          references: [
            {
              sourceId: `finding-${f.id}`,
              detail: f.recommendation
            }
          ]
        }))
      });
    }

    return opportunities;
  }
}
