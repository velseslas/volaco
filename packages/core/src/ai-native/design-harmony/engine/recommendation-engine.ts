/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-012)
 * Design Harmony Recommendation & Action Synthesizer
 */

import type { DesignHarmonyFinding } from '../types.js';

export interface ActionableRecommendation {
  readonly priority: number;
  readonly category: string;
  readonly title: string;
  readonly description: string;
  readonly affectedPages: readonly string[];
  readonly expectedBenefit: string;
  readonly riskLevel: 'LOW' | 'MEDIUM';
}

export class RecommendationEngine {
  public generateRecommendations(findings: readonly DesignHarmonyFinding[]): readonly ActionableRecommendation[] {
    const list: ActionableRecommendation[] = [];

    // 1. Accessibility contrast remediation
    const a11yFindings = findings.filter((f) => f.category === 'ACCESSIBILITY' && f.property === 'contrastRatio');
    if (a11yFindings.length > 0) {
      list.push({
        priority: 1,
        category: 'ACCESSIBILITY',
        title: 'Corriger les déficits de contraste textuel (WCAG 2.1 AA)',
        description: `${a11yFindings.length} élément(s) de texte présentent un contraste insuffisant avec leur arrière-plan.`,
        affectedPages: Array.from(new Set(a11yFindings.map((f) => f.pageRoute))),
        expectedBenefit: 'Garantir la lisibilité universelle et la conformité légale d’accessibilité.',
        riskLevel: 'LOW'
      });
    }

    // 2. Design Drift remediation
    const driftFindings = findings.filter((f) => f.designDrift);
    if (driftFindings.length > 0) {
      list.push({
        priority: 2,
        category: 'DESIGN_DRIFT',
        title: 'Éliminer le Design Drift et réaligner sur les tokens officiels',
        description: `${driftFindings.length} token(s) divergent(s) détecté(s) (espacements hors grille, rayons disparates ou couleurs non standard).`,
        affectedPages: Array.from(new Set(driftFindings.map((f) => f.pageRoute))),
        expectedBenefit: 'Restaurer une rigueur esthétique de niveau professionnel.',
        riskLevel: 'LOW'
      });
    }

    // 3. Component Parity remediation
    const compFindings = findings.filter((f) => f.category === 'COMPONENT');
    if (compFindings.length > 0) {
      list.push({
        priority: 3,
        category: 'COMPONENT',
        title: 'Uniformiser les composants interactifs (Boutons / Inputs)',
        description: `${compFindings.length} anomalie(s) de dimension ou de padding détectée(s) au sein de la même famille de composants.`,
        affectedPages: Array.from(new Set(compFindings.map((f) => f.pageRoute))),
        expectedBenefit: 'Offrir une sensation d’interaction fluide et prévisible.',
        riskLevel: 'LOW'
      });
    }

    // 4. Cross-page parity
    const crossFindings = findings.filter((f) => f.category === 'CROSS_PAGE');
    if (crossFindings.length > 0) {
      list.push({
        priority: 4,
        category: 'CROSS_PAGE',
        title: 'Harmoniser la navigation et la structure globale inter-pages',
        description: `${crossFindings.length} divergence(s) détectée(s) sur les en-têtes ou palettes entre les différentes routes.`,
        affectedPages: Array.from(new Set(crossFindings.map((f) => f.pageRoute))),
        expectedBenefit: 'Assurer une continuité visuelle lors des transitions entre pages.',
        riskLevel: 'LOW'
      });
    }

    return list;
  }
}
