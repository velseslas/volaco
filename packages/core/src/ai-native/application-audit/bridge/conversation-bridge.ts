/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Conversation Bridge - Human-AI Dialogue & Pedagogical Audit Explanations
 */

import type { ApplicationAuditFinding, ApplicationAuditReport } from '../types.js';

export class ApplicationAuditConversationBridge {
  public explainAuditReport(report: ApplicationAuditReport): string {
    const { overallScore, dimensionScores, dimensionStatus, coverage, summary, findings } = report;

    const scoreLabel = (value: number | null): string => value === null ? 'NON MESURÉ' : `${value}/100`;
    const statusLabel = (status: string): string =>
      status === 'MEASURED' ? '' : (status === 'PARTIAL' ? ' *(partiel)*' : ' *(NON MESURÉ)*');

    let verdict = 'Excellent niveau de santé applicative !';
    if (overallScore === null) {
      verdict = 'Audit incomplet : preuves insuffisantes pour prononcer un verdict global.';
    } else if (coverage < 1) {
      verdict = 'Verdict partiel : seules les dimensions réellement mesurées sont notées.';
    } else if (overallScore < 60) {
      verdict = 'Attention : plusieurs anomalies critiques nécessitent une correction prioritaire.';
    } else if (overallScore < 80) {
      verdict = 'Bon niveau d\'ensemble, mais des points de vigilance doivent être résolus.';
    }

    const lines: string[] = [
      `### 📋 Diagnostic Global de l'Application : ${overallScore === null ? 'NON MESURÉ' : `${overallScore}/100`}`,
      `**Verdict** : ${verdict}`,
      `**Couverture réelle** : ${Math.round(coverage * 100)}% des dimensions pondérées`,
      '',
      '#### 📊 Décomposition des 8 Dimensions de Qualité :',
      `- **Sécurité** : ${scoreLabel(dimensionScores.security)}${statusLabel(dimensionStatus.SECURITY)} (pondération 20%)`,
      `- **Architecture** : ${scoreLabel(dimensionScores.architecture)}${statusLabel(dimensionStatus.ARCHITECTURE)} (pondération 15%)`,
      `- **Qualité du Code** : ${scoreLabel(dimensionScores.codeQuality)}${statusLabel(dimensionStatus.CODE_QUALITY)} (pondération 15%)`,
      `- **Design Harmony** : ${scoreLabel(dimensionScores.designHarmony)}${statusLabel(dimensionStatus.DESIGN_HARMONY)} (pondération 15%)`,
      `- **Performance** : ${scoreLabel(dimensionScores.performance)}${statusLabel(dimensionStatus.PERFORMANCE)} (pondération 10%)`,
      `- **Ergonomie & UX** : ${scoreLabel(dimensionScores.ux)}${statusLabel(dimensionStatus.UX)} (pondération 10%)`,
      `- **Accessibilité WCAG** : ${scoreLabel(dimensionScores.accessibility)}${statusLabel(dimensionStatus.ACCESSIBILITY)} (pondération 10%)`,
      `- **Configuration IA** : ${scoreLabel(dimensionScores.aiConfig)}${statusLabel(dimensionStatus.AI_CONFIG)} (pondération 5%)`,
      '',
      `#### 🔍 Synthèse des Anomalies (${summary.totalFindings} findings) :`,
      `- 🔴 **Critiques** : ${summary.criticalCount}`,
      `- 🟠 **Élevées** : ${summary.highCount}`,
      `- 🟡 **Moyennes** : ${summary.mediumCount}`,
      `- 🔵 **Faibles & Info** : ${summary.lowCount + summary.infoCount}`,
      `- ⚡ **Auto-remédiables** : ${summary.autoRemediableCount}`
    ];

    const criticals = findings.filter((f: ApplicationAuditFinding) => f.severity === 'CRITICAL' || f.severity === 'HIGH');
    if (criticals.length > 0) {
      lines.push('', '#### ⚠️ Points d\'Attention Prioritaires :');
      for (const f of criticals.slice(0, 5)) {
        lines.push(`- **[${f.dimension}] ${f.title}** : ${f.recommendation}`);
      }
    }

    lines.push(
      '',
      `> 💡 *Condensat certifié de l'audit : \`${report.auditHash}\` (${report.durationMs}ms).*`
    );

    return lines.join('\n');
  }

  public formatConversationSummary(report: ApplicationAuditReport): string {
    return this.explainAuditReport(report);
  }
}
