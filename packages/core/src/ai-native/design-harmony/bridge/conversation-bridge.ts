/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-012)
 * Conversation Intelligence Bridge (AINT-009 Integration)
 */

import type { DesignHarmonyReport } from '../types.js';

export class DesignHarmonyConversationBridge {
  public explainDesignHarmony(report: DesignHarmonyReport): string {
    const score = report.overallScore;
    const scoreAdjective =
      score >= 90 ? 'remarquable' : score >= 75 ? 'satisfaisante' : score >= 60 ? 'perfectible' : 'critique';

    const lines: string[] = [];
    lines.push(
      `L'analyse de cohérence visuelle de votre application indique une harmonie globale **${scoreAdjective} (${score}/100)** sur ${report.analyzedRoutes.length} route(s) analysée(s).`
    );

    lines.push('');
    lines.push('### Décomposition des Sous-Scores :');
    lines.push(`- **Couleurs & Palette :** ${report.subScores.colorHarmony}/100`);
    lines.push(`- **Typographie & Hiérarchie :** ${report.subScores.typographyHarmony}/100`);
    lines.push(`- **Espacements & Grille :** ${report.subScores.spacingHarmony}/100`);
    lines.push(`- **Rayons & Formes :** ${report.subScores.shapeHarmony}/100`);
    lines.push(`- **Composants (Parité) :** ${report.subScores.componentHarmony}/100`);
    lines.push(`- **Cohérence Inter-Pages :** ${report.subScores.crossPageHarmony}/100`);
    lines.push(`- **Responsive & Accessibilité :** ${report.subScores.responsiveA11yHarmony}/100`);

    if (report.driftSummary.totalDrifts > 0) {
      lines.push('');
      lines.push(
        `> [!WARNING]\n> **Design Drift Détecté :** ${report.driftSummary.totalDrifts} variation(s) non standard observée(s) (${report.driftSummary.criticalDrifts} critique(s)).`
      );
    }

    if (report.findings.length > 0) {
      lines.push('');
      lines.push('### Principaux Points d’Attention :');
      for (const f of report.findings.slice(0, 4)) {
        lines.push(`- **[${f.category}]** ${f.recommendation} *(Preuve: ${f.property} ${f.deviation ?? f.observedValue} sur ${f.pageRoute})*`);
      }
    } else {
      lines.push('');
      lines.push('Félicitations ! Aucun écart de design ni dérive de tokens n’a été détecté.');
    }

    return lines.join('\n');
  }
}
