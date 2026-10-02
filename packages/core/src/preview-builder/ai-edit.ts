/**
 * ÉTAPE 35 — ÉDITION IA PAR OUTILS d'un élément réel du Builder.
 *
 * É32/É33/É34 ont posé la chaîne tool-calling (adaptateur, boucle serveur,
 * proxy). É35 la consomme : l'utilisateur sélectionne un élément RÉEL du
 * HTML IA (texte, image ou lien), décrit sa modification, et le modèle
 * répond UNIQUEMENT via un appel d'outil structuré (set_text /
 * set_image_src / set_link_href). La valeur retournée est ensuite appliquée
 * par les commandes PURES existantes (updateTextContent / updateImageSource /
 * updateLinkHref) — jamais injectée comme HTML.
 *
 * Ce module est ISOMORPHE (aucune dépendance Node) : il tourne côté serveur
 * (tests avec fetchImpl factice) ET dans le navigateur (le Builder passe
 * fetch et l'URL du proxy). La clé API ne quitte jamais le serveur : tout
 * passe par le proxy SEC-003.
 *
 * Sémantique de la boucle : l'appel d'outil EST la réponse — il n'y a rien
 * à exécuter ni à renvoyer au modèle. La boucle sert uniquement de relance
 * bornée si le modèle répond en texte libre au lieu d'appeler l'outil
 * (maxModelCalls, défaut 3). Aucune divergence possible.
 */

export type AiEditElementKind = 'text' | 'image' | 'link';

/** Description de l'élément réel à modifier + la demande de l'utilisateur. */
export interface AiEditRequest {
  readonly kind: AiEditElementKind;
  /** Consigne libre de l'utilisateur (ex: « rends ce titre plus percutant »). */
  readonly instruction: string;
  /** Valeur actuelle de l'élément (texte, src ou href). */
  readonly currentValue: string;
}

export interface AiEditLoopOptions {
  readonly fetchImpl: typeof fetch;
  /** URL du proxy IA (ex: '/api/v1/ai/chat/completions'). */
  readonly url: string;
  readonly request: AiEditRequest;
  readonly model?: string | undefined;
  /** Nombre max d'appels au modèle (défaut 3). */
  readonly maxModelCalls?: number | undefined;
  /** En-têtes additionnels (tenant/rôle du Builder ; la clé reste côté serveur). */
  readonly headers?: Record<string, string> | undefined;
}

export type AiEditFailure =
  | 'empty-instruction'
  | 'http-error'
  | 'no-tool-call'
  | 'invalid-args';

export interface AiEditOutcome {
  readonly ok: boolean;
  /** Valeur finale produite par le modèle (texte/src/href, déjà trimée). */
  readonly value?: string;
  readonly reason?: AiEditFailure;
  readonly detail?: string;
  /** Nombre d'appels réellement passés au modèle. */
  readonly iterations: number;
}

const TOOL_NAMES: Record<AiEditElementKind, string> = {
  text: 'set_text',
  image: 'set_image_src',
  link: 'set_link_href'
};

const VALUE_KEYS: Record<AiEditElementKind, 'text' | 'src' | 'href'> = {
  text: 'text',
  image: 'src',
  link: 'href'
};

const MAX_VALUE_LENGTH = 8000;

function systemPromptFor(kind: AiEditElementKind): string {
  const tool = TOOL_NAMES[kind];
  const role = kind === 'text'
    ? 'Tu es un rédacteur web senior : tu réécris des contenus courts (titres, accroches, paragraphes) avec un français impeccable et un ton adapté à la consigne.'
    : kind === 'image'
      ? 'Tu es un directeur artistique web : tu proposes l URL d image la plus adaptée (Unsplash : https://images.unsplash.com/photo-... cohérente avec le thème).'
      : 'Tu es un intégrateur web : tu proposes le href le plus adapté (ancre interne #..., route relative ou URL https sûre).';
  return role +
    ' Tu réponds EXCLUSIVEMENT en appelant l outil "' + tool + '" avec la nouvelle valeur. ' +
    'Ne réponds JAMAIS en texte libre, ne pose pas de question, n appelle pas d autre outil. ' +
    'Un seul appel d outil, puis c est fini.';
}

function userPromptFor(request: AiEditRequest): string {
  const current = request.currentValue.length > 0 ? request.currentValue : '(vide)';
  return 'Valeur actuelle de l élément :\n« ' + current + ' »\n\n' +
    'Demande de l utilisateur : ' + request.instruction.trim() + '\n\n' +
    'Appelle l outil "' + TOOL_NAMES[request.kind] + '" avec la nouvelle valeur.';
}

/** Corps de requête compatible /v1/chat/completions (format OpenAI/Mistral). */
function buildRequestBody(
  request: AiEditRequest,
  model: string,
  extraReminder: string | null
): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPromptFor(request.kind) },
    { role: 'user', content: userPromptFor(request) }
  ];
  if (extraReminder) {
    messages.push({ role: 'user', content: extraReminder });
  }
  return {
    model,
    messages,
    temperature: 0.3,
    max_tokens: 1024,
    tools: [
      {
        type: 'function',
        function: {
          name: TOOL_NAMES[request.kind],
          description: 'Renvoie la nouvelle valeur de l élément modifié.',
          parameters: {
            type: 'object',
            properties: { [VALUE_KEYS[request.kind]]: { type: 'string', description: 'Nouvelle valeur' } },
            required: [VALUE_KEYS[request.kind]]
          }
        }
      }
    ]
  };
}

interface MistralChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
    };
  }>;
}

/** Extrait la valeur du premier tool call ; null si absent/invalide/vide. */
function extractValue(data: MistralChatResponse, kind: AiEditElementKind): { value: string } | { error: string } {
  const toolCalls = data?.choices?.[0]?.message?.tool_calls;
  const call = toolCalls && toolCalls.length > 0 ? toolCalls[0] : undefined;
  if (!call || !call.function || call.function.name !== TOOL_NAMES[kind]) {
    return { error: 'no-tool-call' };
  }
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || '{}');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'invalid-args' };
    }
    args = parsed as Record<string, unknown>;
  } catch {
    return { error: 'invalid-args' };
  }
  const raw = args[VALUE_KEYS[kind]];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { error: 'invalid-args' };
  }
  return { value: raw.trim().slice(0, MAX_VALUE_LENGTH) };
}

export async function runAiEditLoop(options: AiEditLoopOptions): Promise<AiEditOutcome> {
  const instruction = options.request.instruction.trim();
  if (instruction.length === 0) {
    return { ok: false, reason: 'empty-instruction', iterations: 0 };
  }
  const maxModelCalls = Math.max(1, options.maxModelCalls ?? 3);
  const model = options.model || 'codestral-latest';

  let extraReminder: string | null = null;
  for (let attempt = 1; attempt <= maxModelCalls; attempt++) {
    const body = buildRequestBody(options.request, model, extraReminder);
    let response: Response;
    try {
      response = await options.fetchImpl(options.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
        body: JSON.stringify(body)
      });
    } catch (err) {
      return {
        ok: false,
        reason: 'http-error',
        detail: err instanceof Error ? err.message : String(err),
        iterations: attempt
      };
    }
    if (!response.ok) {
      return { ok: false, reason: 'http-error', detail: 'HTTP ' + response.status, iterations: attempt };
    }

    let data: MistralChatResponse;
    try {
      data = (await response.json()) as MistralChatResponse;
    } catch (err) {
      return {
        ok: false,
        reason: 'http-error',
        detail: 'réponse non JSON: ' + (err instanceof Error ? err.message : String(err)),
        iterations: attempt
      };
    }

    const extracted = extractValue(data, options.request.kind);
    if ('value' in extracted) {
      return { ok: true, value: extracted.value, iterations: attempt };
    }

    // Dernière tentative : inutile de relancer, on échoue honnêtement.
    if (attempt === maxModelCalls) {
      return { ok: false, reason: extracted.error as AiEditFailure, iterations: attempt };
    }
    // Relance avec un rappel plus ferme (le modèle a répondu autrement).
    extraReminder = extracted.error === 'invalid-args'
      ? 'Ton appel précédent était invalide (arguments JSON manquants ou vides). Réponds UNIQUEMENT en appelant l outil "' + TOOL_NAMES[options.request.kind] + '" avec une chaîne non vide.'
      : 'Tu as répondu en texte libre. Réponds UNIQUEMENT en appelant l outil "' + TOOL_NAMES[options.request.kind] + '" avec la nouvelle valeur.';
  }

  // Inatteignable (la boucle retourne à chaque itération) — garde compilateur.
  return { ok: false, reason: 'no-tool-call', iterations: maxModelCalls };
}
