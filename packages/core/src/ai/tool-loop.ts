/**
 * VibeCode Core - Boucle d'exécution d'outils (É33)
 *
 * É33 — Tool-calling exécuté : le modèle demande des outils (tool_calls),
 * la boucle exécute les handlers fournis, renvoie les résultats au modèle
 * et itère jusqu'à la réponse finale — avec bornes strictes :
 * - nombre maximum d'appels au modèle (maxIterations, défaut 5) ;
 * - le dernier appel est envoyé SANS outils : le modèle doit répondre
 *   en texte, la boucle ne peut pas diverger ;
 * - taille maximale d'un résultat d'outil renvoyé au modèle (troncature) ;
 * - chaque exécution est tracée (outil, arguments, succès/erreur, durée).
 *
 * Cette brique est générique : elle ne connaît ni le Studio ni le Builder.
 * Les appelants fournissent les outils et les handlers (fonctions serveur
 * de confiance). Les erreurs de handler ne remontent PAS au modèle sous
 * forme d'exception : elles sont renvoyées au modèle comme résultat d'outil
 * (« ERREUR: … ») pour qu'il puisse se corriger.
 */

import {
  AIProviderAdapter,
  AIProviderGenerateRequest,
  AIProviderMessage,
  AIProviderTool,
  AIProviderToolCall,
  TenantProviderCredentials
} from './providers/types.js';

export type ToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

export interface ToolLoopOptions {
  /** Handlers par nom d'outil ; un outil sans handler renvoie une erreur au modèle. */
  readonly handlers: Readonly<Record<string, ToolHandler>>;
  /** Nombre maximum d'appels au modèle (défaut 5). */
  readonly maxIterations?: number;
  /** Taille maximale d'un résultat d'outil renvoyé au modèle (défaut 8000 caractères). */
  readonly maxToolResultLength?: number;
}

export interface ToolLoopTraceEntry {
  readonly iteration: number;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly ok: boolean;
  readonly result: string;
  readonly durationMs: number;
}

export interface ToolLoopResult {
  readonly text: string;
  readonly iterations: number;
  readonly trace: readonly ToolLoopTraceEntry[];
  /** true si la borne d'itérations a forcé l'arrêt (dernier appel sans outils). */
  readonly stoppedByToolLimit: boolean;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
  readonly costUsd: number;
  readonly providerId: string;
  readonly modelId: string;
}

interface ParsedToolArgs {
  readonly ok: boolean;
  readonly args: Record<string, unknown>;
  readonly error?: string;
}

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_MAX_TOOL_RESULT_LENGTH = 8000;
const ERROR_PREFIX = 'ERREUR:';

/**
 * Parse les arguments JSON d'un tool call. Un objet est renvoyé tel quel ;
 * une valeur scalaire est enveloppée sous { value } ; du JSON invalide ou
 * vide est signalé (le modèle recevra l'erreur, jamais une exception).
 */
export function parseToolArguments(rawArguments: string): ParsedToolArgs {
  if (!rawArguments || rawArguments.trim().length === 0) {
    return { ok: true, args: {} };
  }
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, args: parsed as Record<string, unknown> };
    }
    return { ok: true, args: { value: parsed } };
  } catch (err) {
    return {
      ok: false,
      args: {},
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function runToolLoop(
  adapter: AIProviderAdapter,
  request: AIProviderGenerateRequest,
  tools: readonly AIProviderTool[],
  options: ToolLoopOptions,
  credentials?: TenantProviderCredentials | undefined
): Promise<ToolLoopResult> {
  const maxIterations = Math.max(1, options.maxIterations ?? DEFAULT_MAX_ITERATIONS);
  const maxResultLength = Math.max(1, options.maxToolResultLength ?? DEFAULT_MAX_TOOL_RESULT_LENGTH);
  const trace: ToolLoopTraceEntry[] = [];

  const initialMessages: AIProviderMessage[] = [];
  if (request.systemPrompt) {
    initialMessages.push({ role: 'system', content: request.systemPrompt });
  }
  initialMessages.push({ role: 'user', content: request.prompt });

  let messages = initialMessages;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let providerId = '';
  let modelId = '';

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const isLastIteration = iteration === maxIterations;
    // Au dernier appel, les outils sont retirés : le modèle ne peut plus
    // en demander, il DOIT répondre en texte → la boucle termine toujours.
    const response = await adapter.generate(
      { ...request, messages, tools: isLastIteration ? undefined : tools },
      credentials
    );

    providerId = response.providerId;
    modelId = response.modelId;
    inputTokens += response.usage.inputTokens;
    outputTokens += response.usage.outputTokens;
    totalTokens += response.usage.totalTokens;
    costUsd += response.costUsd;

    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        text: response.text,
        iterations: iteration,
        trace,
        stoppedByToolLimit: false,
        usage: { inputTokens, outputTokens, totalTokens },
        costUsd,
        providerId,
        modelId
      };
    }

    // Le message assistant porte les demandes d'outils (format multi-tours).
    messages = [
      ...messages,
      { role: 'assistant', content: response.text, toolCalls: response.toolCalls }
    ];

    const toolResults: AIProviderMessage[] = [];
    for (const call of response.toolCalls) {
      toolResults.push(await executeToolCall(call, iteration, options.handlers, maxResultLength, trace));
    }
    messages = [...messages, ...toolResults];
  }

  // Inatteignable : le dernier appel est envoyé sans outils, donc retourne
  // forcément un texte. Présent pour satisfaire le compilateur.
  throw new Error('runToolLoop: boucle terminée sans réponse finale (bug de garde)');
}

async function executeToolCall(
  call: AIProviderToolCall,
  iteration: number,
  handlers: Readonly<Record<string, ToolHandler>>,
  maxResultLength: number,
  trace: ToolLoopTraceEntry[]
): Promise<AIProviderMessage> {
  const toolMessage = (content: string): AIProviderMessage => ({
    role: 'tool',
    content,
    toolCallId: call.id,
    name: call.name
  });

  const startedAt = Date.now();
  const recordTrace = (ok: boolean, result: string, args: Record<string, unknown>): void => {
    trace.push({
      iteration,
      toolName: call.name,
      args,
      ok,
      result,
      durationMs: Date.now() - startedAt
    });
  };

  const parsed = parseToolArguments(call.arguments);
  if (!parsed.ok) {
    const content = `${ERROR_PREFIX} arguments JSON invalides pour "${call.name}" (${parsed.error}). Renvoyez un objet JSON valide.`;
    recordTrace(false, content, {});
    return toolMessage(content);
  }

  const handler = handlers[call.name];
  if (!handler) {
    const available = Object.keys(handlers);
    const content = `${ERROR_PREFIX} outil inconnu "${call.name}". Outils disponibles: ${available.length > 0 ? available.join(', ') : 'aucun'}.`;
    recordTrace(false, content, parsed.args);
    return toolMessage(content);
  }

  try {
    const raw = await handler(parsed.args);
    let content: string;
    if (typeof raw === 'string') {
      content = raw.length === 0 ? 'OK' : raw;
    } else if (raw === undefined || raw === null) {
      content = 'OK';
    } else {
      content = JSON.stringify(raw) || 'OK';
    }
    if (content.length > maxResultLength) {
      content = `${content.slice(0, maxResultLength)}…[tronqué à ${maxResultLength} caractères]`;
    }
    recordTrace(true, content, parsed.args);
    return toolMessage(content);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const content = `${ERROR_PREFIX} l'outil "${call.name}" a échoué: ${reason}`;
    recordTrace(false, content, parsed.args);
    return toolMessage(content);
  }
}
