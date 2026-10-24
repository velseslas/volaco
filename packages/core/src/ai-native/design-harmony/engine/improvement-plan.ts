/**
 * VibeCode Core - Design Harmony
 * CDC V8 §17/§21 — IDENTIFY WEAKNESSES → GENERATE IMPROVEMENT PLAN.
 *
 * Le plan est dérivé UNIQUEMENT de sous-scores AQS RÉELLEMENT mesurés :
 *  - une faiblesse est un sous-score mesuré sous le seuil d'action ;
 *  - le gain potentiel est poids AQS × (cible − valeur) — jamais inventé ;
 *  - chaque proposition porte WHY / WHAT / IMPACT / RISKS (§21).
 *
 * Déterministe : mêmes mesures + même itération => même plan (planId stable).
 */

import { AQS_WEIGHTS } from './aqs-engine.js';
import type {
  AestheticMeasurement,
  AqsDimensionId,
  ImprovementPlan,
  ImprovementProposal,
  ImprovementWeakness
} from '../types.js';

/**
 * Seuil d'action : un sous-score mesuré sous 80/100 est une faiblesse
 * prioritaire. Si aucune dimension n'est sous ce seuil mais que le global
 * reste sous la cible, les dimensions sous la cible sont planifiées.
 */
export const IMPROVEMENT_WEAKNESS_THRESHOLD = 80;

interface DimensionGuidance {
  readonly why: string;
  readonly what: string;
  readonly risks: readonly string[];
}

/**
 * Catalogue des actions correctives par dimension AQS. Les textes décrivent
 * le LEVIER visuel — le modifier (LLM ou humain) reste responsable du code.
 */
const GUIDANCE: Record<AqsDimensionId, DimensionGuidance> = {
  visual_hierarchy: {
    why: "l'œil ne distingue pas clairement l'ordre de lecture (titres et corps trop proches en taille/poids).",
    what: "Établir une échelle typographique nette (H1 > H2 > corps) et renforcer le contraste de poids des titres.",
    risks: ['agrandir excessivement les titres peut déséquilibrer la page', 'trop de niveaux typographiques nuit à la lisibilité']
  },
  composition: {
    why: "la structure de page manque d'ossature lisible (alignements et regroupements irréguliers).",
    what: "Aligner les blocs sur une grille commune et regrouper visuellement les contenus liés.",
    risks: ['une grille trop rigide peut casser la hiérarchie voulue', 'les regroupements peuvent modifier l\'ordre perçu']
  },
  typography: {
    why: 'les familles, tailles ou interlignes observés sont hétérogènes.',
    what: 'Réduire à une famille principale (une secondaire maximum), uniformiser l\'échelle et l\'interligne du corps.',
    risks: ['changer de police peut modifier la largeur des textes', 'une échelle trop serrée réduit la lisibilité']
  },
  color_harmony: {
    why: 'la palette comporte des couleurs quasi identiques ou trop nombreuses.',
    what: 'Consolider la palette autour des rôles de marque (primaire, secondaire, accent) et supprimer les quasi-doublons.',
    risks: ['modifier une couleur de marque peut changer l\'identité', 'un contraste insuffisant peut apparaître sur les fonds clairs']
  },
  spacing_rhythm: {
    why: 'les espacements ne suivent pas une grille régulière.',
    what: 'Ramener paddings, marges et gouttières à une grille de 4/8 px et uniformiser les sections.',
    risks: ['réduire les espacements peut densifier la page', 'augmenter les marges peut allonger la page']
  },
  component_quality: {
    why: "les boutons, champs ou cartes varient de forme et d'espacement d'une occurrence à l'autre.",
    what: 'Unifier rayon, padding et hauteur des composants d\'un même rôle (variantes explicites).',
    risks: ['un composant unique peut ne pas convenir à tous les contextes', 'modifier les rayons change le caractère visuel']
  },
  visual_balance: {
    why: 'la masse visuelle est décentrée par rapport au viewport.',
    what: 'Rééquilibrer les colonnes et les blocs pleine largeur pour recentrer le contenu.',
    risks: ['centrer artificiellement peut casser une composition asymétrique volontaire']
  },
  information_density: {
    why: "la densité d'information sort de la bande lisible (trop dense ou trop vide).",
    what: 'Ajuster les espacements et la taille des blocs de contenu pour revenir dans une densité lisible.',
    risks: ['aérer peut allonger le parcours', 'densifier peut nuire à la lisibilité']
  },
  interaction_design: {
    why: "des éléments interactifs n'ont pas de nom accessible ou des liens sont morts.",
    what: 'Ajouter les noms accessibles (aria-label/texte) et corriger les liens morts (href).',
    risks: ['un libellé trop générique dégrade l\'accessibilité', 'changer une cible de lien peut modifier la navigation']
  },
  responsive_quality: {
    why: 'la page mobile présente des débordements ou des adaptations insuffisantes.',
    what: 'Rendre les grilles et images fluides et supprimer les largeurs fixes qui débordent à 390 px.',
    risks: ['une mise en page fluide peut modifier l\'ordre des blocs', 'masquer du contenu mobile peut perdre de l\'information']
  },
  brand_alignment: {
    why: 'des couleurs saturées hors rôles de marque diluent l\'identité.',
    what: 'Ramener les accents saturés vers les rôles de marque définis et neutraliser le reste.',
    risks: ['réduire les accents peut appauvrir la page', 'changer une teinte de marque est une décision de marque']
  },
  perceived_quality: {
    why: 'la finition perçue est faible (détails, cohérence, soin).',
    what: 'Renforcer la cohérence des détails visibles (ombres, bordures, états) sans introduire de nouveaux styles.',
    risks: ['ajouter des effets peut surcharger la page', 'les ombres mal dosées nuisent à la lisibilité']
  }
};

export class ImprovementPlanner {
  /**
   * §17 — construit le plan à partir des seules dimensions MESURÉES.
   * `currentOverall` est non nul : la boucle ne planifie jamais sans mesure.
   */
  public plan(
    measurement: AestheticMeasurement,
    iteration: number,
    options: { readonly target: number }
  ): ImprovementPlan {
    const target = options.target;
    const currentOverall = measurement.aqs.overall ?? 0;
    const measured = measurement.aqs.subScores.filter(
      (sub): sub is typeof sub & { value: number } => sub.value !== null
    );

    const priority = measured.filter((sub) => sub.value < IMPROVEMENT_WEAKNESS_THRESHOLD);
    const candidates = priority.length > 0
      ? priority
      : measured.filter((sub) => sub.value < target);

    const weaknesses: ImprovementWeakness[] = candidates
      .map((sub) => ({
        dimension: sub.id,
        label: sub.label,
        currentValue: sub.value,
        weight: AQS_WEIGHTS[sub.id],
        potentialGain: Math.round(AQS_WEIGHTS[sub.id] * Math.max(0, target - sub.value) * 10) / 10,
        evidence: sub.evidence
      }))
      .sort((a, b) => b.potentialGain - a.potentialGain || a.dimension.localeCompare(b.dimension));

    const proposals: ImprovementProposal[] = weaknesses.map((weakness) => {
      const guidance = GUIDANCE[weakness.dimension];
      return {
        dimension: weakness.dimension,
        label: weakness.label,
        why: `${weakness.label} : ${weakness.currentValue}/100 — ${guidance.why}`,
        what: guidance.what,
        impact: `Gain AQS potentiel jusqu'à +${weakness.potentialGain.toFixed(1)} pt (poids ${weakness.weight.toFixed(2)}, valeur actuelle ${weakness.currentValue}).`,
        risks: guidance.risks
      };
    });

    return {
      planId: `imp-${iteration}-${weaknesses.map((w) => w.dimension).join('+') || 'none'}`,
      iteration,
      targetOverall: target,
      currentOverall,
      weaknesses,
      proposals
    };
  }
}
