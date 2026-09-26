/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-015)
 * Bug Classifier: Subtyping of Defect Signals (Crash, Functional, Rendering, Regression, Network, State)
 */

import type { BugSubtype, UserSignal } from '../types.js';

export interface BugClassificationResult {
  readonly subtype: BugSubtype;
  readonly confidence: number;
  readonly reasoning: string;
}

export class BugClassifier {
  public classifyBug(signal: UserSignal): BugClassificationResult {
    const text = (signal.normalizedText || signal.rawText).toLowerCase();

    // 1. Crash
    if (
      text.includes('crash') ||
      text.includes('écran blanc') ||
      text.includes('unhandled rejection') ||
      text.includes('cannot read properties of undefined') ||
      text.includes('fatal') ||
      text.includes('core dump')
    ) {
      return {
        subtype: 'CRASH',
        confidence: 0.95,
        reasoning: 'Interruption brutale ou erreur non rattrapée de l\'exécution applicative.'
      };
    }

    // 2. Network / API
    if (
      text.includes('500') ||
      text.includes('502') ||
      text.includes('503') ||
      text.includes('networkerror') ||
      text.includes('cors') ||
      text.includes('timeout') ||
      text.includes('connexion perdue') ||
      text.includes('fetch failed')
    ) {
      return {
        subtype: 'NETWORK',
        confidence: 0.90,
        reasoning: 'Défaillance de transmission réseau ou indisponibilité du service distant.'
      };
    }

    // 3. Regression
    if (
      text.includes('depuis la mise à jour') ||
      text.includes('avant ça marchait') ||
      text.includes('depuis hier') ||
      text.includes('régression') ||
      text.includes('regression') ||
      text.includes('cassé après modif')
    ) {
      return {
        subtype: 'REGRESSION',
        confidence: 0.85,
        reasoning: 'Anomalie survenue suite à une mutation récente d\'une fonctionnalité préexistante.'
      };
    }

    // 4. Rendering
    if (
      text.includes('affichage') ||
      text.includes('chevauchement') ||
      text.includes('décalé') ||
      text.includes('police coupée') ||
      text.includes('css') ||
      text.includes('clignote') ||
      text.includes('mal aligné')
    ) {
      return {
        subtype: 'RENDERING',
        confidence: 0.85,
        reasoning: 'Défaut de rendu visuel, de style CSS ou de placement d\'éléments dans le DOM.'
      };
    }

    // 5. State Corruption
    if (
      text.includes('panier vidé') ||
      text.includes('données perdues') ||
      text.includes('désynchronisé') ||
      text.includes('état incorrect') ||
      text.includes('rechargement efface')
    ) {
      return {
        subtype: 'STATE_CORRUPTION',
        confidence: 0.85,
        reasoning: 'Corruption ou perte d\'intégrité de l\'état mémoire ou persistant.'
      };
    }

    // 6. Functional (défaut par défaut)
    return {
      subtype: 'FUNCTIONAL',
      confidence: 0.70,
      reasoning: 'Dysfonctionnement de la logique métier ou comportement divergent des attentes.'
    };
  }
}
