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
    patterns: [/test/i, /spec/i, /couverture/i, /e2e/i, /unitaire/i],
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

interface HeuristicClassification {
  category: IntentCategory;
  confidence: number;
  entities: string[];
  domain: string | undefined;
  constraints: string[];
  urgency: 'LOW' | 'NORMAL' | 'HIGH';
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
  if (/sans|ne pas|jamais|uniquement|obligatoire|strictement/i.test(text)) {
    constraints.push(`Extracted constraint: ${text.slice(0, 80)}`);
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
  projectId: string
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
      { tenantId, projectId, prompt: text, systemPrompt, temperature: 0, maxTokens: 200 },
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
  projectId = 'system'
): Promise<IntentResult> {
  const text = userText.trim();

  // Les mots-clés restent utiles pour extraire entités/domaine/contraintes
  // (logique spécifique à VibeCode qu'une IA générique ne connaît pas),
  // même quand l'IA fournit une meilleure catégorie.
  const heuristic = classifyIntentHeuristic(text);
  const aiResult = await classifyIntentViaAI(text, tenantId, projectId);

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
