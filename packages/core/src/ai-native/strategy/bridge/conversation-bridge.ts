/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Conversation Bridge - Human-oriented strategic explanations and conversational restitution for AINT-009
 */

import type {
  StrategyOptimizationReport,
  StrategicRecommendation,
  StrategicRoadmap,
  WhatIfComparison
} from '../types.js';

export class StrategyConversationBridge {
  /**
   * Responds to "Que devrions-nous faire maintenant ?" / /strategy
   */
  public formatStrategyOverview(report: StrategyOptimizationReport): string {
    const top = report.topPriorities[0];
    const topCount = report.topPriorities.length;
    const nowCount = report.roadmap.horizons.now.length;

    let response = `### 🎯 Situation Stratégique Actuelle (Score Global : ${report.overallStrategicScore}/100)\n\n`;

    if (top) {
      response += `**Priorité N°1 Recommandée :** ${top.title}\n`;
      response += `* **Score Stratégique :** ${top.strategicScore}/100 (Valeur: ${top.valueScore}, Urgence: ${top.urgencyScore})\n`;
      response += `* **Pourquoi maintenant ?** ${top.rationale}\n`;
      response += `* **Effort estimé :** ${top.effort.level} (${top.effort.points} pts, ~${top.effort.estimatedHours}h)\n\n`;
    }

    response += `**Plan d'Action Immédiat (Horizon NOW) :** ${nowCount} action(s) prioritaire(s).\n`;
    response += `* Problèmes / Régressions : ${report.contextSummary.userProblemsCount} (dont ${report.contextSummary.regressionsCount} régressions)\n`;
    response += `* Opportunités Produit : ${report.contextSummary.featureOpportunitiesCount}\n`;
    response += `* Anomalies d'Audit : ${report.contextSummary.auditFindingsCount}\n\n`;
    response += `Tapez \`/priorities\` pour détailler le top des priorités ou \`/roadmap\` pour afficher les jalons planifiés.`;

    return response;
  }

  /**
   * Responds to "Qu'est-ce qui est prioritaire ?" / /priorities
   */
  public formatTopPriorities(report: StrategyOptimizationReport): string {
    let response = `### 📋 Top Priorités Stratégiques Décidées par le Moteur\n\n`;

    if (report.topPriorities.length === 0) {
      return response + `Aucune priorité urgente identifiée. L'application est nominale.`;
    }

    report.topPriorities.slice(0, 5).forEach((rec, idx) => {
      const icon = rec.type.startsWith('FIX_REGRESSION')
        ? '🚨'
        : rec.type.startsWith('FIX_')
        ? '🐛'
        : rec.type.startsWith('BUILD_')
        ? '✨'
        : '🔧';

      response += `${idx + 1}. ${icon} **${rec.title}** (Score : ${rec.strategicScore}/100)\n`;
      response += `   * **Horizon :** ${rec.recommendedHorizon} | **Effort :** ${rec.effort.level} (${rec.effort.points} pts)\n`;
      response += `   * **Impact :** ${rec.userImpact}\n`;
      response += `   * **Justification :** ${rec.rationale}\n\n`;
    });

    response += `Utilisez \`/why <numéro>\` pour examiner la chaîne de preuves d'une recommandation.`;
    return response;
  }

  /**
   * Responds to "Montre-moi la roadmap" / /roadmap
   */
  public formatRoadmap(roadmap: StrategicRoadmap): string {
    let response = `### 🗺️ Roadmap Stratégique Séquencée\n\n`;

    response += `#### ⚡ Horizon NOW (Immédiat - ${roadmap.horizons.now.length} action(s))\n`;
    if (roadmap.horizons.now.length === 0) response += `*Aucune action bloquante immédiate.*\n`;
    for (const act of roadmap.horizons.now) {
      response += `- [${act.strategicScore} pts] **${act.title}** (Effort: ${act.effortLevel})\n`;
    }

    response += `\n#### ⏩ Horizon NEXT (Prochain Jalon - ${roadmap.horizons.next.length} action(s))\n`;
    if (roadmap.horizons.next.length === 0) response += `*Aucune action planifiée pour ce jalon.*\n`;
    for (const act of roadmap.horizons.next) {
      response += `- [${act.strategicScore} pts] **${act.title}** (Effort: ${act.effortLevel})\n`;
    }

    response += `\n#### ⏳ Horizon LATER (Moyen Terme - ${roadmap.horizons.later.length} action(s))\n`;
    for (const act of roadmap.horizons.later.slice(0, 5)) {
      response += `- [${act.strategicScore} pts] **${act.title}**\n`;
    }

    response += `\n**Total Effort Estimé :** ${roadmap.estimatedTotalEffortPoints} points d effort au total.`;
    return response;
  }

  /**
   * Responds to "Pourquoi ?" / /why
   */
  public formatWhyExplanation(rec: StrategicRecommendation): string {
    let response = `### 🔍 Justification Déterministe : ${rec.title}\n\n`;
    response += `* **Score Stratégique :** ${rec.strategicScore}/100\n`;
    response += `* **Statut des Preuves :** ${rec.evidenceStatus} (${rec.evidence.length} preuve(s) rattachée(s))\n\n`;

    response += `#### 📊 Décomposition Mathématique du Score\n`;
    for (const factor of rec.scoreBreakdown.factors) {
      response += `- **${factor.name}** : ${factor.weightedContribution > 0 ? '+' : ''}${factor.weightedContribution} pts (${factor.explanation})\n`;
    }
    response += `\n*Formule :* \`${rec.scoreBreakdown.mathematicalExplanation}\`\n\n`;

    response += `#### ⚠️ Que se passe-t-il si nous ne faisons rien ?\n`;
    for (const cons of rec.consequencesIfIgnored) {
      response += `- ${cons}\n`;
    }

    return response;
  }

  /**
   * Responds to "Montre-moi les alternatives"
   */
  public formatAlternatives(whatIf: WhatIfComparison): string {
    let response = `### ⚖️ Comparaison des Scénarios Stratégiques (What-If)\n\n`;
    response += `**Recommandation du Moteur :** ${whatIf.recommendationRationale}\n\n`;

    for (const item of whatIf.comparisonMatrix) {
      response += `* **${item.scenarioName}** (Verdict: ${item.verdict})\n`;
      response += `  - Score: ${item.score}/100 | Risque: ${item.risk}/100 | Effort: ${item.effort} pts\n`;
    }

    return response;
  }
}
