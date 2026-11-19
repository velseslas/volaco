/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * Natural Language Intent Classification Engine
 *
 * Historique : classifiait uniquement par mots-clés (expressions régulières).
 * Corrigé pour utiliser une vraie IA (Gemini/Mistral) quand disponible, avec
 * les mots-clés comme filet de sécurité si aucune IA réelle n'est configurée
 * ou si son appel échoue — jamais d'échec silencieux de la conversation.
 */

import type { ApplicationSemanticModel } from '../../application-understanding/types.js';
import type { IntentCategory, IntentResult } from '../types.js';
import { classifyAmbiguities } from './clarification-engine.js';
import { aiProviderRegistry } from '../../../ai/providers/registry.js';
import { preferredAiProvider } from '../../../ai/providers/provider-catalog.js';
import { logger } from '../../../logger.js';

interface CategoryRule {
  readonly category: IntentCategory;
  readonly patterns: readonly RegExp[];
  readonly weight: number;
}

const CATEGORY_RULES: readonly CategoryRule[] = [
  {
    category: 'EXPLAIN',
    patterns: [/pourquoi\b/i, /pour quelle raison/i, /explique/i, /comment fonctionne/i, /qu'est-ce que/i, /c'est quoi/i, /explain/i, /why/i],
    weight: 0.95
  },
  {
    category: 'ANALYZE',
    patterns: [/analyse/i, /audit/i, /examine/i, /v[ée]rifie/i, /mesure/i, /scan/i, /inspect/i],
    weight: 0.90
  },
  {
    category: 'DEBUG',
    patterns: [/erreur/i, /bug/i, /crash/i, /probl[èe]me/i, /ne marche pas/i, /404/i, /500/i, /fail/i, /exception/i, /corrige/i, /fix/i],
    weight: 0.92
  },
  {
    category: 'DELETE',
    patterns: [/supprime/i, /retire/i, /efface/i, /d[ée]truit/i, /enl[èe]ve/i, /delete/i, /remove/i],
    weight: 0.90
  },
  {
    category: 'OPTIMIZE',
    patterns: [/optimise/i, /acc[ée]l[èe]re/i, /plus rapide/i, /performance/i, /latence/i, /all[èe]ge/i, /optimize/i, /faster/i],
    weight: 0.88
  },
  {
    category: 'REFACTOR',
    patterns: [/refactor/i, /restructure/i, /r[ée]organise/i, /nettoie/i, /clean/i, /d[ée]couple/i],
    weight: 0.85
  },
  {
    category: 'CREATE',
    patterns: [/ajoute/i, /cr[ée][ée]?/i, /fais un/i, /fais une/i, /nouvel/i, /nouveau/i, /impl[ée]mente/i, /constuis/i, /add/i, /create/i, /new/i],
    weight: 0.88
  },
  {
    category: 'MODIFY',
    patterns: [/change/i, /modifie/i, /remplace/i, /mets [àa] jour/i, /update/i, /modify/i, /alter/i],
    weight: 0.89
  },
  {
    category: 'QUESTION',
    patterns: [/est-ce que/i, /peut-on/i, /o[ùu] se trouve/i, /qui/i, /quel/i, /combien/i, /\?/],
    weight: 0.80
  },
  {
    category: 'REVIEW',
    patterns: [/revue/i, /review/i, /v[ée]rifie mon code/i, /qualit[ée]/i],
    weight: 0.82
  },
  {
    category: 'TEST',
    // É48 — /spec/ borné à un DÉBUT DE MOT : /spec/i matchait la sous-chaîne
    // « spec » à l'intérieur de « respecter » (« doit respecter
    // l'accessibilité »), « perspective », « inspecter » — une PRÉCISION
    // conversationnelle devenait TEST (0.85), la reprise É43 était bloquée et
    // la précision perdue. « spec.ts », « specs », « spec du module » restent
    // classés TEST ; « respecter » ne l'est plus.
    patterns: [/test/i, /\bspec/i, /couverture/i, /e2e/i, /unitaire/i],
    weight: 0.85
  },
  {
    category: 'DEPLOYMENT',
    patterns: [/d[ée]ploiement/i, /deploy/i, /production/i, /release/i, /publish/i],
    weight: 0.86
  },
  {
    category: 'NAVIGATION',
    patterns: [/montre/i, /ouvre/i, /va sur/i, /navigue/i, /affiche/i, /show/i, /open/i],
    weight: 0.78
  },
  {
    category: 'EXPLORATION',
    patterns: [/cherche/i, /explore/i, /trouve/i, /discover/i, /search/i],
    weight: 0.75
  }
];

const VALID_CATEGORIES: readonly IntentCategory[] = [
  'QUESTION', 'EXPLORATION', 'CREATE', 'MODIFY', 'DELETE', 'REFACTOR', 'DEBUG',
  'ANALYZE', 'EXPLAIN', 'REVIEW', 'OPTIMIZE', 'TEST', 'DEPLOYMENT', 'NAVIGATION', 'UNKNOWN'
];

/**
 * É42 — une INTERDICTION n'est pas une commande. « Finalement, ne modifie pas
 * la partie facturation » exprime une CONTRAINTE, pas une mutation : le verbe
 * d'action vit À L'INTÉRIEUR d'une forme négative (« ne … pas », « ne …
 * jamais », « n' … pas »). Sans cette règle, « ne modifie pas » classait
 * MODIFY (0.89) et un plan de mutation était présenté — une mutation lancée
 * sur une simple probabilité d'intention, et la contrainte perdue.
 */
/** Forme négative impérative (« ne … pas », « ne … jamais », « n' … pas »). */
export const NEGATION_IMPERATIVE_PATTERN = /\b(?:ne\s+(?:[\w'’éèêàâîôû-]+\s+)?(?:pas|jamais)|n'[\w'’éèêàâîôû-]+\s+(?:pas|jamais))\b/i;

/** Clause négative COMPLÈTE, avec le verbe qui la porte (avant ou après). */
const NEGATION_CLAUSE_PATTERN = /\b(?:ne|n')[\s'’]*(?:[\w'’éèêàâîôû-]+\s+){0,2}?(?:pas|jamais)(?:\s+(?:d[e']\s*)?[\w'’éèêàâîôû-]+)?/gi;

/** Verbes de MUTATION : leur présence HORS clause négative garde une action. */
const MUTATION_ACTION_PATTERN = /(?:modifi|chang|supprim|remplac|ajout|cr[ée]|effac|lanc|ex[ée]cut|d[ée]ploi|impl[ée]ment|touch|alter|corrige)/i;

interface HeuristicClassification {
  category: IntentCategory;
  confidence: number;
  entities: string[];
  domain: string | undefined;
  constraints: string[];
  urgency: 'LOW' | 'NORMAL' | 'HIGH';
}

/**
 * É41 — une question de MÉTHODE n'est pas une commande. « Comment ajouter un
 * footer à la page d accueil ? » demande la MÉTHODE, pas la mutation : sans
 * cette règle, le verbe « ajoute[r] » (CREATE, 0.88) l'emportait sur le « ? »
 * (QUESTION, 0.80) et un plan de mutation était présenté pour confirmation —
 * une mutation lancée sur une simple probabilité d'intention.
 * Détection déterministe : commence par « comment » ET se termine par « ? ».
 * Exception politesse + action : « Peux-tu créer une page contact ? » reste
 * une demande d'ACTION (le message ne commence pas par « comment »).
 */
function isMethodQuestion(text: string): boolean {
  if (!/^comment\b/i.test(text)) return false;
  if (!/\?\s*$/.test(text)) return false;
  // Forme interrogative de politesse portant une demande d'action : la
  // classification d'action existante est conservée.
  if (/\b(?:peux|pourrais|pouvez|pourriez)(?:-tu|-vous)?\b/i.test(text)) return false;
  return true;
}

/**
 * Classification par mots-clés (comportement historique). Utilisée comme
 * filet de sécurité quand aucune IA réelle n'est disponible, et pour
 * extraire entités/domaine/contraintes même quand l'IA fournit la catégorie.
 */
function classifyIntentHeuristic(text: string): HeuristicClassification {
  let bestCategory: IntentCategory = 'UNKNOWN';
  let highestWeight = 0.0;

  for (const rule of CATEGORY_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        if (rule.weight > highestWeight) {
          highestWeight = rule.weight;
          bestCategory = rule.category;
        }
        break;
      }
    }
  }

  if (bestCategory === 'UNKNOWN') {
    if (/\?$/.test(text)) bestCategory = 'QUESTION';
    else bestCategory = 'EXPLORATION';
    highestWeight = 0.50;
  }

  // É42 — interdiction ≠ commande : si une forme négative porte l'unique
  // verbe d'action, le message est une CONTRAINTE (aucun plan, aucune
  // mutation) ; la contrainte reste extraite plus bas et conservée en
  // mémoire projet. Un verbe de mutation HORS clause négative (« … mais
  // crée une page ») conserve la classification d'action existante.
  if (NEGATION_IMPERATIVE_PATTERN.test(text)) {
    const remainder = text.replace(new RegExp(NEGATION_CLAUSE_PATTERN.source, NEGATION_CLAUSE_PATTERN.flags), ' ');
    if (!MUTATION_ACTION_PATTERN.test(remainder)) {
      bestCategory = 'EXPLORATION';
      highestWeight = 0.50;
    }
  }

  // É41 — la question de méthode prime sur les verbes d'action qu'elle
  // contient (catégorie seule : entités/domaine/contraintes inchangés).
  if (isMethodQuestion(text)) {
    bestCategory = 'EXPLAIN';
    highestWeight = 0.90;
  }

  const entities: string[] = [];
  const entityMatches = text.match(/(?:fournisseur|fournisseurs|auth|utilisateur|utilisateurs|paiement|checkout|panier|dashboard|profil|bouton|table|page|route|service|fichier|commande)s?/gi);
  if (entityMatches) {
    for (const e of entityMatches) {
      const norm = e.toLowerCase();
      if (!entities.includes(norm)) entities.push(norm);
    }
  }

  let domain: string | undefined = undefined;
  if (/fournisseur/i.test(text)) domain = 'dom_suppliers';
  else if (/auth|login|session|mot de passe/i.test(text)) domain = 'dom_authentication';
  else if (/user|profil|compte|membre/i.test(text)) domain = 'dom_user_management';
  else if (/pay|achat|facture|panier|checkout/i.test(text)) domain = 'dom_billing';
  else if (/dash|stat|kpi|rapport/i.test(text)) domain = 'dom_analytics';

  const constraints: string[] = [];
  // É42 — la forme négative impérative (« ne modifie pas », « n'utilise pas »)
  // est aussi une contrainte explicite (les formes « ne pas »/« jamais »
  // adjacentes étaient déjà couvertes).
  // É49 — couverture des interdictions naturelles restées hors déclencheurs :
  // « surtout pas de X », « pas de X », « jamais de X », « aucun X »,
  // « interdit/interdiction de X », « évite X ». Preuve É49 (sonde E5, UI S5) :
  // « n'ajoute surtout pas de bouton de paiement » ne déclenchait AUCUNE
  // contrainte → rien à stocker (conversation-engine n'appelle
  // MemoryManager.addConstraint QUE sur intent.constraints) → les gardes É44
  // (supervision, chemins protégés) et É47 (réponse) tournaient à vide.
  // Asymétrie assumée : un faux positif coûte une ligne de mémoire inerte
  // (les gardes ne s'activent que sur mot interdictif + chemin nommé) ;
  // un faux négatif coûte une interdiction violée silencieusement.
  if (
    /sans|ne pas|jamais|uniquement|obligatoire|strictement/i.test(text) ||
    NEGATION_IMPERATIVE_PATTERN.test(text) ||
    /\b(?:surtout\s+pas|pas\s+de|jamais\s+de|aucun\w*|interdi[ts]|interdiction|évit\w*)\b/i.test(text)
  ) {
    constraints.push(`Extracted constraint: ${text.slice(0, 80)}`);
    // É49 — capture RÉFINIE de l'interdiction : la fenêtre fixe (80 premiers
    // caractères) tronquait l'OBJET de l'interdiction — « …mais n'ajoute
    // surtout pas de bouton de paiement » stockait « …surtout pas de bouton »
    // SANS « paiement » (sonde É49/E5 APRÈS extraction) : la contrainte était
    // stockée et transmise mais INERTE (mot interdictif sans objet, aucun
    // chemin nommé pour É44). Chaque occurrence interdictive reçoit sa
    // fenêtre propre (déclencheur −30/+110 car.), dédupliquée, plafonnée à 3
    // — la chaîne primaire É42 reste STRICTEMENT identique (non-régression
    // des formats gelés).
    const INTERDICTIVE_GLOBAL = /\b(?:surtout\s+pas|pas\s+de|jamais\s+de|aucun\w*|interdi[ts]|interdiction|évit\w*|sans|ne\s+pas|ne\s+[\w'’éèêàâîôû-]+\s+(?:pas|jamais)|n'[\w'’éèêàâîôû-]+\s+(?:pas|jamais)|uniquement|obligatoire|strictement)\b/gi;
    let interdictiveMatch: RegExpExecArray | null;
    let refinedCount = 0;
    while ((interdictiveMatch = INTERDICTIVE_GLOBAL.exec(text)) !== null && refinedCount < 3) {
      const refined = `Extracted constraint: ${text.slice(Math.max(0, interdictiveMatch.index - 30), interdictiveMatch.index + 110)}`;
      if (!constraints.includes(refined)) {
        constraints.push(refined);
        refinedCount++;
      }
    }
  }

  const isUrgent = /urgent|imm[ée]diat|vite|asap|critique/i.test(text);

  return {
    category: bestCategory,
    confidence: Math.round(highestWeight * 100) / 100,
    entities: entities.sort(),
    domain,
    constraints: constraints.sort(),
    urgency: isUrgent ? 'HIGH' : 'NORMAL'
  };
}

interface AiClassification {
  category: IntentCategory;
  confidence: number;
  urgency: 'NORMAL' | 'HIGH';
}

/**
 * Demande à une vraie IA (Gemini/Mistral) de choisir la catégorie d'intention.
 * Retourne null si aucune IA n'est disponible, si l'appel échoue, ou si la
 * réponse ne peut pas être exploitée en toute confiance (jamais d'exception
 * qui casserait la conversation — on retombe alors sur les mots-clés).
 */
async function classifyIntentViaAI(
  text: string,
  tenantId: string,
  projectId: string,
  /**
   * É53 LOT E4.1 — CORRECTION B : signal de cancellation du tour /stream
   * (armé par E1/E2/E3 uniquement). Un abandon n'est JAMAIS avalé par le
   * repli mots-clés : l'erreur est rejetée telle quelle et l'issue du tour
   * reste l'arbitrage E1/E2 (catches E3 de la route).
   */
  signal?: AbortSignal | undefined
): Promise<AiClassification | null> {
  // LOT MULTI-MODÈLES — fournisseur actif du tableau de bord ; héritage sinon.
  const preferredProviderId = preferredAiProvider() ?? (process.env.MISTRAL_API_KEY ? 'mistral' : process.env.GEMINI_API_KEY ? 'gemini' : undefined);
  const adapter = aiProviderRegistry.resolve(preferredProviderId ? { preferredProviderId } : {});
  if (!adapter) {
    return null;
  }

  const systemPrompt =
    "Tu es un classificateur d'intention pour un outil de développement web assisté par IA (VibeCode Studio).\n" +
    `Catégories valides (choisis EXACTEMENT une de ces valeurs) : ${VALID_CATEGORIES.join(', ')}.\n` +
    "Réponds UNIQUEMENT avec un objet JSON strict, sans aucun texte autour, au format exact :\n" +
    '{"category": "UNE_DES_CATEGORIES", "urgency": "NORMAL_OU_HIGH", "confidence": 0.0_A_1.0}';

  try {
    const credentials = aiProviderRegistry.getTenantCredentials(tenantId, adapter.descriptor.providerId);
    const response = await adapter.generate(
      { tenantId, projectId, prompt: text, systemPrompt, temperature: 0, maxTokens: 200, ...(signal !== undefined ? { signal } : {}) },
      credentials
    );

    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as { category?: unknown; urgency?: unknown; confidence?: unknown };
    const category = typeof parsed.category === 'string' ? parsed.category.toUpperCase() : '';
    if (!VALID_CATEGORIES.includes(category as IntentCategory)) {
      return null;
    }

    return {
      category: category as IntentCategory,
      urgency: parsed.urgency === 'HIGH' ? 'HIGH' : 'NORMAL',
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.75
    };
  } catch (error) {
    // É53 LOT E4.1 — CORRECTION B : un abandon demandé par l'appelant
    // (signal du tour) n'est jamais un échec de classification ordinaire :
    // l'erreur est REJETÉE (le tour ne continue pas après annulation, aucun
    // repli mots-clés). Sans abandon (timeout, réseau, JSON) → repli
    // historique strictement inchangé.
    if (signal?.aborted === true) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Échec de la classification d'intention par IA — repli sur les mots-clés.", {
      component: 'intent-engine',
      tenantId,
      error: message
    });
    return null;
  }
}

export async function classifyIntent(
  userText: string,
  semanticModel?: ApplicationSemanticModel | undefined,
  tenantId = 'system',
  projectId = 'system',
  /**
   * É53 LOT E4.1 — CORRECTION B : signal de cancellation du tour (optionnel,
   * rétrocompatible — absent = comportement strictement inchangé).
   */
  signal?: AbortSignal | undefined
): Promise<IntentResult> {
  const text = userText.trim();

  // Les mots-clés restent utiles pour extraire entités/domaine/contraintes
  // (logique spécifique à VibeCode qu'une IA générique ne connaît pas),
  // même quand l'IA fournit une meilleure catégorie.
  const heuristic = classifyIntentHeuristic(text);
  const aiResult = await classifyIntentViaAI(text, tenantId, projectId, signal);

  const category = aiResult ? aiResult.category : heuristic.category;
  const confidence = aiResult ? aiResult.confidence : heuristic.confidence;
  const urgency: 'LOW' | 'NORMAL' | 'HIGH' = aiResult?.urgency || heuristic.urgency;

  const ambiguities = classifyAmbiguities(text, category, heuristic.entities);

  return {
    category,
    domain: heuristic.domain,
    goal: text,
    requestedAction: `Execute ${category} action on ${heuristic.entities.join(', ') || 'application'}`,
    entities: heuristic.entities,
    constraints: heuristic.constraints,
    urgency,
    confidence,
    ambiguities
  };
}

export class ConversationIntentEngine {
  public async classifyIntent(
    userText: string,
    semanticModel?: ApplicationSemanticModel | undefined,
    tenantId?: string,
    projectId?: string
  ): Promise<IntentResult> {
    return classifyIntent(userText, semanticModel, tenantId, projectId);
  }
}
