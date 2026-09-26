/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-009)
 * PHASE 4 — Vrai Intent Engine basé sur LLM
 *
 * Remplace le switch rule-based de DefaultReasoningProvider par un vrai appel
 * à un LLM (Mistral/Gemini). Le LLM devient le cerveau, la regex reste un
 * signal auxiliaire via DefaultReasoningProvider qui sert aussi de fallback.
 *
 * CDC §4-7 : "La regex peut rester comme signal auxiliaire, mais elle ne
 * doit plus être le cerveau."
 */

import type {
  EngineeringPlan,
  IntentCategory,
  IntentResult,
  NextActionKind,
  PlanStep,
  ReasoningProvider,
  ReasoningRequest,
  ReasoningResponse
} from '../types.js';
import { logger } from '../../../logger.js';

/**
 * Signature de la fonction qui appelle le LLM. Découplée de toute implémentation
 * spécifique (Mistral, Gemini, mock) pour pouvoir tester le provider sans
 * dépendance réseau. En production, cette fonction est construite dans server.ts
 * à partir de AIProviderRegistryLLMAdapter.
 */
export type LLMCaller = (systemPrompt: string, userPrompt: string) => Promise<string>;

const VALID_INTENT_CATEGORIES: ReadonlySet<string> = new Set<string>([
  'CREATE', 'MODIFY', 'DELETE', 'EXPLAIN', 'ANALYZE', 'DEBUG',
  'OPTIMIZE', 'REFACTOR', 'QUESTION', 'REVIEW', 'TEST',
  'DEPLOYMENT', 'NAVIGATION', 'EXPLORATION', 'UNKNOWN'
]);

const VALID_NEXT_ACTIONS: ReadonlySet<string> = new Set<string>([
  'ASK_QUESTION', 'REQUEST_CONFIRMATION', 'PRESENT_PLAN', 'EXECUTE_PLAN',
  'REQUEST_UNDERSTANDING', 'RESPOND_DIRECTLY', 'ROLLBACK'
]);

const VALID_PLAN_OPERATIONS: ReadonlySet<string> = new Set<string>([
  'ANALYZE', 'CREATE', 'MODIFY', 'DELETE', 'VERIFY'
]);

/**
 * Valide qu'un objet JSON respecte le schéma attendu d'un ReasoningResponse
 * (vérification de surface, pas une validation JSON Schema complète — suffisant
 * pour détecter une réponse LLM mal formée et déclencher le fallback).
 */
function validateLLMResponse(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  if (typeof o.reply !== 'string' || o.reply.trim().length === 0) return false;
  if (typeof o.confidence !== 'number' || o.confidence < 0 || o.confidence > 1) return false;
  if (typeof o.nextAction !== 'string' || !VALID_NEXT_ACTIONS.has(o.nextAction)) return false;
  if (!o.intent || typeof o.intent !== 'object') return false;
  const intent = o.intent as Record<string, unknown>;
  if (typeof intent.category !== 'string' || !VALID_INTENT_CATEGORIES.has(intent.category)) return false;
  if (typeof intent.goal !== 'string') return false;
  if (typeof intent.confidence !== 'number') return false;
  // Le plan est optionnel (les questions n'ont pas besoin de plan)
  if (o.plan !== undefined && o.plan !== null) {
    if (typeof o.plan !== 'object') return false;
    const plan = o.plan as Record<string, unknown>;
    if (typeof plan.title !== 'string' || plan.title.trim().length === 0) return false;
    if (typeof plan.summary !== 'string') return false;
    if (!Array.isArray(plan.steps)) return false;
    for (const step of plan.steps) {
      if (!step || typeof step !== 'object') return false;
      const s = step as Record<string, unknown>;
      if (typeof s.title !== 'string' || s.title.trim().length === 0) return false;
      if (typeof s.description !== 'string') return false;
      if (typeof s.operation !== 'string' || !VALID_PLAN_OPERATIONS.has(s.operation)) return false;
    }
  }
  return true;
}

/**
 * PHASE 6 — Construit un objet EngineeringPlan valide à partir de la réponse LLM.
 * Le plan LLM est validé, on lui ajoute planId, planHash, status. Si la réponse
 * LLM ne contient pas de plan valide, on retourne undefined (le conversation-engine
 * utilisera alors le PlanGenerator rule-based en fallback).
 */
function buildEngineeringPlanFromLLM(
  planObj: unknown,
  intent: IntentResult
): EngineeringPlan | undefined {
  if (!planObj || typeof planObj !== 'object') return undefined;
  const p = planObj as Record<string, unknown>;
  if (typeof p.title !== 'string' || typeof p.summary !== 'string' || !Array.isArray(p.steps)) {
    return undefined;
  }
  if (p.steps.length === 0) return undefined;

  const steps: PlanStep[] = p.steps.map((rawStep, idx) => {
    const s = rawStep as Record<string, unknown>;
    return {
      stepIndex: idx + 1,
      title: String(s.title || `Étape ${idx + 1}`),
      description: String(s.description || ''),
      targetDomain: intent.domain,
      operation: (s.operation as PlanStep['operation']) || 'MODIFY',
      requiresApproval: Boolean(s.requiresApproval) || intent.urgency === 'HIGH'
    };
  });

  const planId = `plan-llm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const title = p.title;
  const summary = p.summary;
  const partialPlan = {
    planId,
    title,
    summary,
    steps,
    estimatedImpact: `${steps.length} étapes générées par IA pour : ${intent.goal}`,
    status: 'DRAFT' as const
  };
  const planHash = `llm-${Date.now().toString(36)}`;

  return {
    ...partialPlan,
    planHash
  };
}

function buildSystemPrompt(): string {
  return [
    "Tu es le moteur d'Intent et de Planning de VibeCode Studio. Analyse la demande utilisateur et renvoie un JSON valide.",
    "",
    "Reponds UNIQUEMENT avec un objet JSON de la forme exacte suivante, sans texte avant ou apres :",
    "{",
    "  \"interpretation\": \"ta comprehension de la demande en 1 phrase\",",
    "  \"intent\": {",
    "    \"category\": \"une de: CREATE, MODIFY, DELETE, EXPLAIN, ANALYZE, DEBUG, OPTIMIZE, REFACTOR, QUESTION, REVIEW, TEST, DEPLOYMENT, NAVIGATION, EXPLORATION, UNKNOWN\",",
    "    \"goal\": \"l'objectif principal en 5-10 mots\",",
    "    \"confidence\": \"nombre entre 0 et 1\",",
    "    \"entities\": [\"mots-cles importants\"],",
    "    \"urgency\": \"NORMAL ou HIGH\"",
    "  },",
    "  \"reply\": \"ta reponse a l'utilisateur en 1-2 phrases (en francais)\",",
    "  \"confidence\": \"nombre entre 0 et 1\",",
    "  \"nextAction\": \"une de: ASK_QUESTION, REQUEST_CONFIRMATION, PRESENT_PLAN, EXECUTE_PLAN, REQUEST_UNDERSTANDING, RESPOND_DIRECTLY, ROLLBACK\",",
    "  \"plan\": {",
    "    \"title\": \"titre court du plan\",",
    "    \"summary\": \"resume en 1 phrase\",",
    "    \"steps\": [",
    "      {",
    "        \"title\": \"titre court de l'etape\",",
    "        \"description\": \"description detaillee de l'etape\",",
    "        \"operation\": \"une de: ANALYZE, CREATE, MODIFY, DELETE, VERIFY\",",
    "        \"requiresApproval\": false",
    "      }",
    "    ]",
    "  }",
    "}",
    "",
    "IMPORTANT :",
    "- Le plan doit contenir des etapes SPECIFIQUES a la demande (pas 'Analyser > Implementer > Verifier').",
    "- Pour 'Cree une page contact', genere des etapes concretes comme : 1. Inspecter le routing existant, 2. Creer le composant ContactForm, 3. Ajouter la route /contact, 4. Ajouter la validation, 5. Tester.",
    "- Si la demande est une question (QUESTION/EXPLAIN), tu peux omettre le plan ou mettre un tableau de steps vide.",
    "- Reponds en francais."
  ].join('\n');
}

function buildUserPrompt(request: ReasoningRequest): string {
  const intent = request.intent;
  const recent = request.memory.turn.recentMessages
    .slice(-3)
    .map(m => `${m.sender}: ${m.content}`)
    .join('\n');
  return [
    `Demande utilisateur actuelle : "${request.userMessage}"`,
    '',
    'Intent pre-detecte par regex (auxiliaire, a confirmer ou corriger) :',
    `- category: ${intent.category}`,
    `- goal: ${intent.goal}`,
    `- confidence: ${intent.confidence}`,
    '',
    'Historique recent :',
    recent || '(aucun)',
    '',
    'Analyse cette demande et renvoie le JSON structure.'
  ].join('\n');
}

/**
 * Reasoning Provider basé sur LLM. Tente d'abord un appel au LLM, et bascule
 * sur le fallback (DefaultReasoningProvider en general) en cas d'echec
 * (timeout, cle invalide, reponse mal formee, etc.).
 *
 * Garantit que le systeme ne plante jamais si le LLM est indisponible.
 */
export class LLMReasoningProvider implements ReasoningProvider {
  constructor(
    private readonly callLLM: LLMCaller,
    private readonly fallback: ReasoningProvider
  ) {}

  public async reason(request: ReasoningRequest): Promise<ReasoningResponse> {
    try {
      const systemPrompt = buildSystemPrompt();
      const userPrompt = buildUserPrompt(request);

      const rawResponse = await this.callLLM(systemPrompt, userPrompt);

      // Extraire le JSON de la reponse (le LLM peut l'envelopper dans ```json ... ```)
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('LLMReasoningProvider - pas de JSON trouve dans la reponse LLM, fallback', {
          component: 'llm-reasoning',
          responsePreview: rawResponse.slice(0, 200)
        });
        return this.fallback.reason(request);
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!validateLLMResponse(parsed)) {
        logger.warn('LLMReasoningProvider - schema de reponse invalide, fallback', {
          component: 'llm-reasoning',
          keys: Object.keys(parsed)
        });
        return this.fallback.reason(request);
      }

      // Construire le IntentResult final en fusionnant LLM + regex pre-detecte
      const llmIntent = parsed.intent as Partial<IntentResult>;
      const finalIntent: IntentResult = {
        category: llmIntent.category as IntentCategory,
        domain: request.intent.domain,
        goal: llmIntent.goal || request.intent.goal,
        requestedAction: request.intent.requestedAction,
        entities: Array.isArray(llmIntent.entities) ? llmIntent.entities : request.intent.entities,
        constraints: request.intent.constraints,
        urgency: (llmIntent.urgency === 'HIGH' ? 'HIGH' : 'NORMAL'),
        confidence: typeof llmIntent.confidence === 'number' ? llmIntent.confidence : request.intent.confidence,
        ambiguities: request.intent.ambiguities
      };

      // PHASE 6 — Construire le EngineeringPlan à partir de la réponse LLM si présent
      const llmPlan = buildEngineeringPlanFromLLM(parsed.plan, finalIntent);

      return {
        interpretation: typeof parsed.interpretation === 'string' ? parsed.interpretation : `Intent ${finalIntent.category} detecte par LLM`,
        intent: finalIntent,
        assumptions: [],
        clarifications: request.intent.ambiguities,
        reply: parsed.reply as string,
        confidence: parsed.confidence as number,
        nextAction: parsed.nextAction as NextActionKind,
        plan: llmPlan
      };
    } catch (err) {
      logger.warn("LLMReasoningProvider - erreur lors de l'appel LLM, fallback active", {
        component: 'llm-reasoning',
        error: err instanceof Error ? err.message : String(err)
      });
      return this.fallback.reason(request);
    }
  }
}
