/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Feature Gap Detector - Detects Missing Canonical Capacities
 */

import type { CollectedSignals } from './signal-collector.js';
import type { FeatureEvidence } from '../types.js';

export interface RawOpportunityGap {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: 'FUNCTIONAL_GAP' | 'USER_NEED' | 'UX_IMPROVEMENT' | 'ARCHITECTURE';
  readonly problem: string;
  readonly proposedSolution: string;
  readonly affectedModules: readonly string[];
  readonly dependencies: readonly string[];
  readonly initialEvidence: readonly FeatureEvidence[];
}

export class FeatureGapDetector {
  public detectGaps(signals: CollectedSignals): readonly RawOpportunityGap[] {
    const gaps: RawOpportunityGap[] = [];
    const lowerComps = signals.detectedComponents.map((c) => c.toLowerCase());
    const lowerRoutes = signals.detectedRoutes.map((r) => r.toLowerCase());

    // 1. GAP: Moteur de Recherche Globale & Filtre
    const hasSearch = lowerComps.some((c) => c.includes('search') || c.includes('filter')) ||
      lowerRoutes.some((r) => r.includes('search') || r.includes('filter'));

    if (!hasSearch && signals.totalFileCount >= 2) {
      gaps.push({
        id: 'gap-search-filter',
        title: 'Moteur de Recherche Globale & Filtrage Instantané',
        description: 'Ajouter une barre de recherche globale avec filtrage multi-critères en temps réel.',
        category: 'FUNCTIONAL_GAP',
        problem: 'L application manipule des listes ou des enregistrements mais ne dispose d aucun outil de recherche directe.',
        proposedSolution: 'Implémenter un composant GlobalSearchBar avec indexation in-memory et raccourci clavier (Cmd/Ctrl + K).',
        affectedModules: ['src/components/search', 'src/views'],
        dependencies: [],
        initialEvidence: [
          {
            id: 'ev-gap-search-1',
            source: 'application',
            description: `L application compte ${signals.totalFileCount} fichiers et plusieurs vues sans barre de recherche.`,
            confidence: 0.85,
            references: [
              {
                sourceId: 'app-files',
                detail: `Analyse de ${signals.detectedComponents.length} composants existants : aucun composant de recherche indexé.`
              }
            ]
          }
        ]
      });
    }

    // 2. GAP: Exportation de Données (CSV / JSON)
    const hasExport = lowerComps.some((c) => c.includes('export') || c.includes('download')) ||
      lowerRoutes.some((r) => r.includes('export'));

    if (!hasExport && signals.totalFileCount >= 2) {
      gaps.push({
        id: 'gap-data-export',
        title: 'Export Multi-Formats (CSV, JSON, PDF)',
        description: 'Permettre l exportation des données et des rapports en un clic dans les formats standards.',
        category: 'FUNCTIONAL_GAP',
        problem: 'Les données créées ou consultées dans l application ne peuvent pas être extraites pour analyse externe.',
        proposedSolution: 'Ajouter un module DataExportService avec génération de fichiers Blob côté client.',
        affectedModules: ['src/services/export', 'src/components/export'],
        dependencies: [],
        initialEvidence: [
          {
            id: 'ev-gap-export-1',
            source: 'application',
            description: 'Aucune fonction d extraction de données n a été repérée dans l arborescence actuelle.',
            confidence: 0.8,
            references: [
              {
                sourceId: 'app-tree',
                detail: 'Absence de boutons ou services dédiés à l export (CSV/JSON/PDF).'
              }
            ]
          }
        ]
      });
    }

    // 3. GAP: Journal d Activité & Historique d Actions (Audit Trail)
    const hasHistory = lowerComps.some((c) => c.includes('history') || c.includes('activity') || c.includes('auditlog'));
    if (!hasHistory && signals.totalFileCount >= 3) {
      gaps.push({
        id: 'gap-activity-audit',
        title: 'Journal d Activité & Traçabilité des Actions',
        description: 'Consigner chronologiquement les modifications et opérations clés avec horodatage.',
        category: 'ARCHITECTURE',
        problem: 'Absence de visibilité sur les actions récentes exécutées par les utilisateurs.',
        proposedSolution: 'Intégrer un ActivityTimelineView réactif connecté aux événements applicatifs.',
        affectedModules: ['src/services/activity', 'src/components/activity'],
        dependencies: [],
        initialEvidence: [
          {
            id: 'ev-gap-activity-1',
            source: 'architecture',
            description: 'Aucun stockage ou affichage de l historique des événements n est actuellement configuré.',
            confidence: 0.75,
            references: [
              {
                sourceId: 'arch-scan',
                detail: 'Aucun modèle de données d activité ou de timeline trouvé dans le projet.'
              }
            ]
          }
        ]
      });
    }

    return gaps;
  }
}
