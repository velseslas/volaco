/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Conversation Bridge - Bridges AINT-009 with Feature Intelligence
 */

import type { ConversationTurn } from '../../conversation-intelligence/types.js';
import type { RawOpportunityGap } from '../discovery/feature-gap-detector.js';
import type { FeatureCandidate, FeatureIntelligenceReport } from '../types.js';

export class FeatureConversationBridge {
  /**
   * Analyse l'historique conversationnel pour extraire des opportunités basées sur les demandes récurrentes
   */
  public extractOpportunitiesFromConversation(turns: readonly ConversationTurn[]): readonly RawOpportunityGap[] {
    const opportunities: RawOpportunityGap[] = [];

    // Compter les occurrences de mots-clés d'intention
    let analyticsCount = 0;
    let authCount = 0;
    let notifCount = 0;

    for (const turn of turns) {
      const text = turn.userMessage.content.toLowerCase();
      if (text.includes('stat') || text.includes('analytic') || text.includes('graphique') || text.includes('dashboard')) {
        analyticsCount++;
      }
      if (text.includes('login') || text.includes('auth') || text.includes('connexion') || text.includes('profil')) {
        authCount++;
      }
      if (text.includes('notif') || text.includes('alerte') || text.includes('message')) {
        notifCount++;
      }
    }

    if (analyticsCount >= 2) {
      opportunities.push({
        id: 'conv-opp-analytics-dashboard',
        title: 'Tableau de Bord Analytique & Indicateurs Clés (KPIs)',
        description: 'Intégrer des visualisations de données et métriques d activité en temps réel.',
        category: 'USER_NEED',
        problem: `L utilisateur a exprimé le besoin de graphiques ou statistiques à ${analyticsCount} reprises dans le chat.`,
        proposedSolution: 'Développer une vue DashboardView avec widgets modulaires et cartes de statistiques clés.',
        affectedModules: ['src/views/dashboard', 'src/components/charts'],
        dependencies: [],
        initialEvidence: [
          {
            id: 'ev-conv-analytics',
            source: 'conversation',
            description: `Demandes répétées de statistiques/analytics détectées (${analyticsCount} messages).`,
            confidence: 0.9,
            references: [
              {
                sourceId: 'chat-history',
                detail: `Fréquence constatée : ${analyticsCount} occurrences dans les récents échanges.`
              }
            ]
          }
        ]
      });
    }

    if (authCount >= 2) {
      opportunities.push({
        id: 'conv-opp-auth-management',
        title: 'Système d Authentification & Profil Utilisateur',
        description: 'Gérer les sessions utilisateurs, rôles et préférences personnelles.',
        category: 'USER_NEED',
        problem: `L utilisateur a mentionné la gestion d accès et profils à ${authCount} reprises.`,
        proposedSolution: 'Mettre en place un UserSessionProvider avec écran de profil et déconnexion sécurisée.',
        affectedModules: ['src/services/auth', 'src/components/profile'],
        dependencies: [],
        initialEvidence: [
          {
            id: 'ev-conv-auth',
            source: 'conversation',
            description: `Demandes de fonctionnalités d authentification et profil (${authCount} messages).`,
            confidence: 0.85,
            references: [
              {
                sourceId: 'chat-history',
                detail: `Fréquence constatée : ${authCount} occurrences dans les récents échanges.`
              }
            ]
          }
        ]
      });
    }

    if (notifCount >= 2) {
      opportunities.push({
        id: 'conv-opp-notifications',
        title: 'Centre de Notifications & Alertes Toast',
        description: 'Afficher des retours visuels instantanés (toast) lors des actions réussies ou erreurs.',
        category: 'USER_NEED',
        problem: `Demandes répétées relatives aux notifications ou alertes (${notifCount} fois).`,
        proposedSolution: 'Ajouter un NotificationToastManager accessible globalement dans l interface.',
        affectedModules: ['src/components/notifications'],
        dependencies: [],
        initialEvidence: [
          {
            id: 'ev-conv-notif',
            source: 'conversation',
            description: `Demandes d alertes ou notifications répétées (${notifCount} messages).`,
            confidence: 0.8,
            references: [
              {
                sourceId: 'chat-history',
                detail: `Fréquence constatée : ${notifCount} occurrences dans les récents échanges.`
              }
            ]
          }
        ]
      });
    }

    return opportunities;
  }

  /**
   * Synthèse pédagogique en français d'une opportunité pour le dialogue AINT-009
   */
  public explainOpportunity(candidate: FeatureCandidate): string {
    const lines: string[] = [];
    lines.push(`### 💡 Opportunité : ${candidate.title}`);
    lines.push(`**Score de Priorité** : \`${candidate.scores.priorityScore}/100\` | **Confiance** : \`${Math.round(candidate.scores.evidenceConfidence)}%\` | **Impact** : \`${candidate.impact.blastRadiusScore < 35 ? 'Modéré' : 'Élevé'}\``);
    lines.push('');
    lines.push(`> **Problème identifié** : ${candidate.specification.problem}`);
    lines.push(`> **Solution proposée** : ${candidate.specification.proposedSolution}`);
    lines.push('');
    lines.push('#### 🔍 Preuves formelles constatées :');
    for (const ev of candidate.evidence) {
      lines.push(`- **[${ev.source.toUpperCase()}]** ${ev.description} *(Confiance: ${Math.round(ev.confidence * 100)}%)*`);
    }
    lines.push('');
    lines.push(`**Complexité estimée** : ${candidate.impact.estimatedComplexity} (${candidate.impact.estimatedEffort})`);
    if (candidate.impact.risks.length > 0) {
      lines.push(`**Points d attention / Risques** : ${candidate.impact.risks.join(', ')}`);
    }
    return lines.join('\n');
  }

  /**
   * Synthèse complète du rapport d'intelligence produit pour AINT-009
   */
  public explainReport(report: FeatureIntelligenceReport): string {
    const lines: string[] = [];
    lines.push('# 💡 Rapport d Intelligence Produit & Opportunités (AINT-014)');
    lines.push(`**Projet** : \`${report.projectId}\` | **Opportunités qualifiées** : \`${report.opportunities.length}\` | **Priorité moyenne** : \`${Math.round(report.summary.avgPriorityScore)}/100\``);
    lines.push('');
    if (report.opportunities.length === 0) {
      lines.push('Aucune nouvelle opportunité forte n a été détectée à ce stade.');
      return lines.join('\n');
    }

    lines.push('## Top des Opportunités Détectées :');
    for (const [idx, opp] of report.opportunities.slice(0, 5).entries()) {
      lines.push(`${idx + 1}. **${opp.title}** (Priorité: ${opp.scores.priorityScore}/100) — *${opp.description}*`);
    }
    return lines.join('\n');
  }
}
