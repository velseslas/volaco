/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-013)
 * Conversation Bridge - Human-AI Dialogue & Pedagogical Audit Explanations
 */

import type { ApplicationAuditFinding, ApplicationAuditReport } from '../types.js';

export class ApplicationAuditConversationBridge {
  public explainAuditReport(report: ApplicationAuditReport): string {
    const { overallScore, dimensionScores, summary, findings } = report;

    let verdict = 'Excellent niveau de santé applicative !';
    if (overallScore < 60) {
      verdict = 'Attention : plusieurs anomalies critiques nécessitent une correction prioritaire.';
    } else if (overallScore < 80) {
      verdict = 'Bon niveau d\'ensemble, mais des points de vigilance doivent être résolus.';
    }

    const lines: string[] = [
      `### 📋 Diagnostic Global de l'Application : ${overallScore}/100`,
      `**Verdict** : ${verdict}`,
      '',
      '#### 📊 Décomposition des 8 Dimensions de Qualité :',
      `- **Sécurité** : ${dimensionScores.security}/100 (pondération 20%)`,
      `- **Architecture** : ${dimensionScores.architecture}/100 (pondération 15%)`,
      `- **Qualité du Code** : ${dimensionScores.codeQuality}/100 (pondération 15%)`,
      `- **Design Harmony** : ${dimensionScores.designHarmony}/100 (pondération 15%)`,
      `- **Performance** : ${dimensionScores.performance}/100 (pondération 10%)`,
      `- **Ergonomie & UX** : ${dimensionScores.ux}/100 (pondération 10%)`,
      `- **Accessibilité WCAG** : ${dimensionScores.accessibility}/100 (pondération 10%)`,
      `- **Configuration IA** : ${dimensionScores.aiConfig}/100 (pondération 5%)`,
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
