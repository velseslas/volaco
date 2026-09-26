/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Conversation Bridge: Pedagogical Synthesis for Chat Dialogue (AINT-009)
 */

import type { AggregatedProblem, UserFeedbackReport } from '../types.js';

export class ConversationBridge {
  /**
   * Formate une synthèse pédagogique complète en français pour l'assistant conversationnel
   */
  public formatReportForChat(report: UserFeedbackReport): string {
    const lines: string[] = [];

    lines.push(`### 🐞 Rapport d'Intelligence Retours & Bugs (AINT-015)`);
    lines.push(`> **Projet :** \`${report.projectId}\` | **Signaux analysés :** ${report.summary.totalSignals} | **Problèmes qualifiés :** ${report.summary.totalProblems}`);
    lines.push('');

    // Indicateurs clés
    lines.push(`| Indicateur | Valeur |`);
    lines.push(`| :--- | :--- |`);
    lines.push(`| **Score de priorité moyen** | **${report.summary.avgPriorityScore} / 100** |`);
    lines.push(`| **Bugs critiques** | ${report.summary.criticalBugsCount > 0 ? `🚨 **${report.summary.criticalBugsCount} critique(s)**` : '✅ 0 critique'} |`);
    lines.push(`| **Régressions confirmées** | ${report.summary.confirmedRegressionsCount > 0 ? `⚠️ **${report.summary.confirmedRegressionsCount} régression(s)**` : '0 régression'} |`);
    lines.push(`| **Demandes d'évolution** | 💡 ${report.summary.featureRequestsCount} demande(s) |`);
    lines.push(`| **Clusters contradictoires** | ⚖️ ${report.summary.contradictionClustersCount} sujet(s) |`);
    lines.push('');

    // Problèmes majeurs
    if (report.problems.length > 0) {
      lines.push(`#### 📌 Principales anomalies prioritaires :`);
      lines.push('');

      for (const p of report.problems.slice(0, 5)) {
        const sevBadge = p.severity === 'CRITICAL' ? '🚨 [CRITIQUE]' : p.severity === 'HIGH' ? '⚠️ [ÉLEVÉ]' : 'ℹ️ [MOYEN]';
        lines.push(`- **${sevBadge} ${p.title}** (Priorité: **${p.scores.priorityScore}/100**)`);
        lines.push(`  - *Catégorie :* \`${p.category}\` | *Statut :* \`${p.status}\` | *Impact :* ${p.impact.affectedUsersCount} utilisateur(s)`);
        const firstEv = p.evidence[0];
        if (firstEv) {
          lines.push(`  - *Preuve principale :* [${firstEv.proofLevel}] ${firstEv.description}`);
        }
        if (p.suggestedRemediation) {
          lines.push(`  - *Remédiation suggérée :* ${p.suggestedRemediation}`);
        }
      }
      lines.push('');
    } else {
      lines.push(`*Aucune anomalie active identifiée à ce stade.*`);
      lines.push('');
    }

    // Retours contradictoires
    if (report.contradictions.length > 0) {
      lines.push(`#### ⚖️ Retours Contradictoires (Arbitrage UX requis) :`);
      for (const c of report.contradictions) {
        lines.push(`- **Sujet : ${c.topic}** (${c.positiveCount} avis favorables vs ${c.negativeCount} défavorables)`);
        lines.push(`  - *Analyse :* ${c.analysis}`);
        lines.push(`  - *Recommandation :* ${c.recommendation}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Formate une fiche détaillée pour un problème unitaire
   */
  public formatProblemDetail(problem: AggregatedProblem): string {
    const lines: string[] = [];

    lines.push(`### 🔍 Détail de l'Anomalie : ${problem.title}`);
    lines.push(`- **ID :** \`${problem.id}\``);
    lines.push(`- **Sévérité :** \`${problem.severity}\` | **Urgence :** \`${problem.urgency}\``);
    lines.push(`- **Priorité Globale :** **${problem.scores.priorityScore} / 100**`);
    lines.push(`- **Régression :** \`${problem.regressionStatus}\` | **Tendance :** \`${problem.trend}\``);
    lines.push(`- **Utilisateurs impactés :** ${problem.impact.affectedUsersCount} (${Math.round(problem.impact.userImpactRatio * 100)}%)`);
    lines.push(`- **Description :** ${problem.description}`);
    lines.push('');

    if (problem.rootCauseHypothesis) {
      lines.push(`> **Hypothèse Cause Racine :** ${problem.rootCauseHypothesis}`);
    }
    if (problem.suggestedRemediation) {
      lines.push(`> **Remédiation recommandée :** ${problem.suggestedRemediation}`);
    }
    lines.push('');

    lines.push(`#### 📋 Preuves matérielles (${problem.evidence.length}) :`);
    for (const ev of problem.evidence) {
      lines.push(`- [**${ev.proofLevel}**] (${ev.source}) ${ev.description} *(Confiance: ${Math.round(ev.confidence * 100)}%)*`);
    }

    return lines.join('\n');
  }
}
