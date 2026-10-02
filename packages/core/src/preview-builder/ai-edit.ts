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

import type { EditableElementInfo } from './editing.js';

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
  /** É37 — validation des URL d'image proposées (image inaccessible → relance). */
  readonly validateImageUrl?: ImageUrlValidator | undefined;
}

export type AiEditFailure =
  | 'empty-instruction'
  | 'http-error'
  | 'no-tool-call'
  | 'invalid-args'
  | 'image-inaccessible';

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

/**
 * É37 — Hook de validation d'URL d'image (optionnel, injecté par l'appelant).
 * Renvoie null si l'image charge, sinon une raison courte. Le module reste
 * isomorphe : c'est l'appelant (navigateur : new Image() + timeout ; tests :
 * un stub) qui fournit la mécanique.
 */
export type ImageUrlValidator = (url: string) => Promise<string | null> | string | null;

/**
 * E43 — appel d'outil validé COLLECTÉ en mode prévisualisation (deferApply) :
 * rien n'est appliqué, l'appelant décide après confirmation humaine.
 */
export interface AiEditProposedCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
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
      // É37 — une URL d'image est vérifiée AVANT d'être acceptée : si elle
      // ne charge pas, l'erreur repart au modèle qui propose une autre URL.
      if (options.request.kind === 'image' && options.validateImageUrl) {
        const invalid = await options.validateImageUrl(extracted.value);
        if (invalid) {
          if (attempt === maxModelCalls) {
            return { ok: false, reason: 'image-inaccessible', detail: invalid, iterations: attempt };
          }
          extraReminder = 'L URL d image proposée ne charge pas (' + invalid + '). Appelle à nouveau l outil "' + TOOL_NAMES[options.request.kind] + '" avec une AUTRE URL valide (https://images.unsplash.com/photo-...).';
          continue;
        }
      }
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

/* =====================================================================
 * ÉTAPE 36 — ÉDITION IA PAR COMPOSANT : boucle multi-outils multi-tours.
 *
 * Contrairement à l'édition mono-élément (le tool call EST la réponse),
 * ici le modèle peut enchaîner PLUSIEURS modifications : chaque tour peut
 * contenir plusieurs tool_calls (set_text / set_image_src / set_link_href
 * avec le path de l'inventaire), l'appelant exécute chaque appel via sa
 * fonction `apply` (commandes pures du Builder) et le résultat est
 * renvoyé au modèle au format wire (assistant tool_calls → tool results).
 * La boucle se termine quand le modèle répond en texte libre, ou à la
 * borne maxModelCalls (défaut 6) — les modifications déjà appliquées
 * restent en place (succès partiel honnête, jamais d'annulation cachée).
 * ===================================================================== */

export interface AiComponentEditOutcome {
  /** false uniquement si rien n'a pu être tenté (consigne vide, HTTP). */
  readonly ok: boolean;
  /** Nombre d'appels d'outil exécutés avec succès par `apply`. */
  readonly appliedCount: number;
  /** E43 — appels validés collectés en mode prévisualisation (non appliqués). */
  readonly proposedCalls: readonly AiEditProposedCall[];
  /** Nombre de tours réellement passés au modèle. */
  readonly iterations: number;
  /** Résultats d'outils en échec (refus de commande, path invalide, …). */
  readonly toolErrors: readonly string[];
  /** Phrase finale du modèle (narration), si fournie. */
  readonly finalText: string;
  readonly limitReached: boolean;
  readonly reason?: 'http-error' | 'empty-instruction' | 'empty-inventory';
  readonly detail?: string;
}

const COMPONENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'set_text',
      description: 'Remplace le TEXTE de l élément situé à path (élément textuel de l inventaire).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'array', items: { type: 'integer' }, description: 'Path EXACT issu de l inventaire' },
          text: { type: 'string', description: 'Nouveau texte' }
        },
        required: ['path', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_image_src',
      description: 'Remplace le src de l image située à path (Unsplash : https://images.unsplash.com/photo-...).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'array', items: { type: 'integer' }, description: 'Path EXACT issu de l inventaire' },
          src: { type: 'string', description: 'Nouvelle URL d image' }
        },
        required: ['path', 'src']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_link_href',
      description: 'Remplace le href du lien situé à path (ancre #, route relative ou https sûre).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'array', items: { type: 'integer' }, description: 'Path EXACT issu de l inventaire' },
          href: { type: 'string', description: 'Nouvelle cible du lien' }
        },
        required: ['path', 'href']
      }
    }
  }
] as const;

const COMPONENT_VALUE_KEYS: Record<string, 'text' | 'src' | 'href'> = {
  set_text: 'text',
  set_image_src: 'src',
  set_link_href: 'href'
};

function componentSystemPrompt(): string {
  return 'Tu édites un composant web EXISTANT, section par section, via des outils. ' +
    'L inventaire des éléments éditables est fourni dans le message : chaque ligne donne path (l adresse exacte de l élément), son type et sa valeur actuelle. ' +
    'RÈGLES : appelle les outils set_text / set_image_src / set_link_href avec le path EXACT de l inventaire (jamais un path inventé). ' +
    'Tu peux faire plusieurs appels dans un même tour pour des modifications indépendantes. ' +
    'Ne modifie que ce que la demande de l utilisateur concerne ; conserve le style de l existant. ' +
    'Quand tu as terminé, réponds en texte libre avec UNE courte phrase de confirmation.';
}

function componentUserPrompt(instruction: string, inventory: readonly EditableElementInfo[]): string {
  const MAX_LINES = 60;
  const MAX_VALUE = 120;
  const lines = inventory.slice(0, MAX_LINES).map((el) => {
    const value = el.value.length > MAX_VALUE ? el.value.slice(0, MAX_VALUE) + '…' : el.value;
    const label = el.kind === 'text' ? 'texte' : el.kind === 'image' ? 'image' : 'lien';
    return `path=${JSON.stringify(el.path)} ${label} <${el.tag}> « ${value} »`;
  });
  const truncated = inventory.length > MAX_LINES ? `\n(… et ${inventory.length - MAX_LINES} autres éléments)` : '';
  return 'Inventaire des éléments éditables :\n' + lines.join('\n') + truncated +
    '\n\nDemande de l utilisateur : ' + instruction.trim();
}

/** Valide un path d'arguments : tableau d'entiers ≥ 0 non vide. */
function isValidPath(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0
    && value.every((k) => typeof k === 'number' && Number.isInteger(k) && k >= 0);
}

export async function runAiComponentEditLoop(options: {
  fetchImpl: typeof fetch;
  url: string;
  instruction: string;
  inventory: readonly EditableElementInfo[];
  /** Exécute un appel d'outil validé (nom connu + path valide + valeur non vide) ; renvoie le résultat à nourrir au modèle ('ERREUR: …' si refus). */
  apply: (call: { name: string; args: Record<string, unknown> }) => string | Promise<string>;
  model?: string | undefined;
  maxModelCalls?: number | undefined;
  headers?: Record<string, string> | undefined;
  /** É37 — validation des URL d'image proposées (image inaccessible → erreur nourrie au modèle, qui propose une autre URL). */
  validateImageUrl?: ImageUrlValidator | undefined;
  /** E43 — prévisualisation : les appels validés sont COLLECTÉS (proposedCalls) sans être appliqués ; le modèle reçoit OK et l'appelant applique après confirmation humaine. */
  deferApply?: boolean | undefined;
}): Promise<AiComponentEditOutcome> {
  const instruction = options.instruction.trim();
  if (instruction.length === 0) {
    return { ok: false, appliedCount: 0, proposedCalls: [], iterations: 0, toolErrors: [], finalText: '', limitReached: false, reason: 'empty-instruction' };
  }
  if (options.inventory.length === 0) {
    return { ok: false, appliedCount: 0, proposedCalls: [], iterations: 0, toolErrors: [], finalText: '', limitReached: false, reason: 'empty-inventory' };
  }
  const deferApply = options.deferApply === true;
  const proposedCalls: AiEditProposedCall[] = [];
  const maxModelCalls = Math.max(1, options.maxModelCalls ?? 6);
  const model = options.model || 'codestral-latest';

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: componentSystemPrompt() },
    { role: 'user', content: componentUserPrompt(instruction, options.inventory) }
  ];

  let appliedCount = 0;
  const toolErrors: string[] = [];

  for (let iteration = 1; iteration <= maxModelCalls; iteration++) {
    const isLastIteration = iteration === maxModelCalls;
    let response: Response;
    try {
      response = await options.fetchImpl(options.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          max_tokens: 2048,
          // Au dernier tour, les outils sont retirés : le modèle doit conclure.
          tools: isLastIteration ? undefined : COMPONENT_TOOLS
        })
      });
    } catch (err) {
      return {
        ok: false, appliedCount, proposedCalls, iterations: iteration, toolErrors, finalText: '', limitReached: false,
        reason: 'http-error', detail: err instanceof Error ? err.message : String(err)
      };
    }
    if (!response.ok) {
      return {
        ok: false, appliedCount, proposedCalls, iterations: iteration, toolErrors, finalText: '', limitReached: false,
        reason: 'http-error', detail: 'HTTP ' + response.status
      };
    }

    let data: MistralChatResponse;
    try {
      data = (await response.json()) as MistralChatResponse;
    } catch (err) {
      return {
        ok: false, appliedCount, proposedCalls, iterations: iteration, toolErrors, finalText: '', limitReached: false,
        reason: 'http-error', detail: 'réponse non JSON: ' + (err instanceof Error ? err.message : String(err))
      };
    }

    const message = data?.choices?.[0]?.message;
    const rawToolCalls = message?.tool_calls;
    if (!rawToolCalls || rawToolCalls.length === 0) {
      // Réponse en texte libre : fin naturelle de la boucle.
      return {
        ok: true, appliedCount, proposedCalls, iterations: iteration, toolErrors,
        finalText: (message?.content ?? '').trim(), limitReached: false
      };
    }

    // Historique : le message assistant porte les tool_calls demandés.
    messages.push({
      role: 'assistant',
      content: message?.content ?? '',
      tool_calls: rawToolCalls.map((tc, idx) => ({
        id: 'c' + iteration + '-' + idx,
        type: 'function',
        function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments || '{}' }
      }))
    });

    for (let idx = 0; idx < rawToolCalls.length; idx++) {
      const call = rawToolCalls[idx];
      const callId = 'c' + iteration + '-' + idx;
      const name = call?.function?.name ?? '';
      let result: string;
      let args: Record<string, unknown> = {};
      const toolError = (msg: string): string => {
        toolErrors.push(msg);
        return 'ERREUR: ' + msg;
      };
      if (!(name in COMPONENT_VALUE_KEYS)) {
        result = toolError('outil inconnu "' + name + '"');
      } else {
        try {
          const parsed: unknown = JSON.parse(call?.function?.arguments || '{}');
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            args = parsed as Record<string, unknown>;
          }
        } catch {
          args = {};
        }
        const valueKey: 'text' | 'src' | 'href' = COMPONENT_VALUE_KEYS[name] ?? 'text';
        const value = args[valueKey];
        if (!isValidPath(args.path)) {
          result = toolError('path invalide pour "' + name + '" — utilise un path EXACT de l inventaire');
        } else if (typeof value !== 'string' || value.trim().length === 0) {
          result = toolError('valeur "' + valueKey + '" manquante ou vide');
        } else if (name === 'set_image_src' && options.validateImageUrl) {
          // É37 — l'URL est testée AVANT application : une image qui ne
          // charge pas est refusée au modèle, qui propose une autre URL.
          const invalid = await options.validateImageUrl(value.trim());
          if (invalid) {
            result = toolError('image inaccessible (' + invalid + ') — propose une AUTRE URL https://images.unsplash.com/photo-...');
          } else if (deferApply) {
            // E43 — collecté, pas appliqué ; le modèle reçoit OK pour conclure.
            const cleanArgs = { ...args, [valueKey]: value.trim() };
            proposedCalls.push({ name, args: cleanArgs });
            result = 'OK';
          } else {
            result = await options.apply({ name, args: { ...args, [valueKey]: value.trim() } });
            if (result.startsWith('ERREUR:')) {
              toolErrors.push(result.slice('ERREUR:'.length).trim());
            } else {
              appliedCount += 1;
            }
          }
        } else {
          args[valueKey] = value.trim();
          if (deferApply) {
            // E43 — collecté, pas appliqué.
            proposedCalls.push({ name, args });
            result = 'OK';
          } else {
            const applied = await options.apply({ name, args });
            if (applied.startsWith('ERREUR:')) {
              result = applied;
              toolErrors.push(applied.slice('ERREUR:'.length).trim());
            } else {
              appliedCount += 1;
              result = applied;
            }
          }
        }
      }
      messages.push({ role: 'tool', tool_call_id: callId, content: result });
    }
  }

  // Borne atteinte : le dernier tour était sans outils, donc ce tour-ci a
  // répondu en texte libre et la boucle a déjà retourné. Garde compilateur.
  return { ok: true, appliedCount, proposedCalls, iterations: maxModelCalls, toolErrors, finalText: '', limitReached: true };
}

/* =====================================================================
 * ÉTAPE 39 — ÉDITION IA PAR PAGE : multi-sections.
 *
 * Généralisation de la boucle par composant : l'inventaire couvre TOUS les
 * composants à HTML réel, chaque entrée porte sa section, et les outils
 * exigent un argument `section` en plus du `path`. L'appelant résout la
 * section (commande pure sur le bon composant) et persiste les sections
 * touchées (É38). Mêmes garanties : validations nourries au modèle, borne
 * maxModelCalls dont le DERNIER tour part sans outils, succès partiel
 * honnête.
 * ===================================================================== */

export interface PageEditableElement {
  readonly section: string;
  readonly path: number[];
  readonly kind: 'text' | 'image' | 'link';
  readonly tag: string;
  readonly value: string;
}

export interface AiPageEditOutcome {
  readonly ok: boolean;
  readonly appliedCount: number;
  /** E43 — appels validés collectés en mode prévisualisation (non appliqués). */
  readonly proposedCalls: readonly AiEditProposedCall[];
  /** Sections réellement modifiées (déduites des appels validés réussis). */
  readonly touchedSections: readonly string[];
  readonly iterations: number;
  readonly toolErrors: readonly string[];
  readonly finalText: string;
  readonly limitReached: boolean;
  readonly reason?: 'http-error' | 'empty-instruction' | 'empty-inventory';
  readonly detail?: string;
}

const PAGE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'set_text',
      description: 'Remplace le TEXTE de l élément situé à path DANS la section indiquée.',
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'string', description: 'Nom EXACT de la section (issu de l inventaire)' },
          path: { type: 'array', items: { type: 'integer' }, description: 'Path EXACT issu de l inventaire' },
          text: { type: 'string', description: 'Nouveau texte' }
        },
        required: ['section', 'path', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_image_src',
      description: 'Remplace le src de l image à path DANS la section (Unsplash : https://images.unsplash.com/photo-...).',
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'string', description: 'Nom EXACT de la section (issu de l inventaire)' },
          path: { type: 'array', items: { type: 'integer' }, description: 'Path EXACT issu de l inventaire' },
          src: { type: 'string', description: 'Nouvelle URL d image' }
        },
        required: ['section', 'path', 'src']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_link_href',
      description: 'Remplace le href du lien à path DANS la section (ancre #, route relative ou https sûre).',
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'string', description: 'Nom EXACT de la section (issu de l inventaire)' },
          path: { type: 'array', items: { type: 'integer' }, description: 'Path EXACT issu de l inventaire' },
          href: { type: 'string', description: 'Nouvelle cible du lien' }
        },
        required: ['section', 'path', 'href']
      }
    }
  }
] as const;

function pageSystemPrompt(): string {
  return 'Tu édites une page web EXISTANTE composée de SECTIONS, via des outils. ' +
    'L inventaire des éléments éditables est fourni : chaque ligne donne la section, le path (l adresse exacte de l élément dans cette section) et la valeur actuelle. ' +
    'RÈGLES : appelle les outils set_text / set_image_src / set_link_href avec la section ET le path EXACTS de l inventaire (jamais de valeurs inventées). ' +
    'Tu peux faire plusieurs appels dans un même tour, y compris dans des sections différentes. ' +
    'Ne modifie que ce que la demande concerne ; conserve le style de l existant. ' +
    'Quand tu as terminé, réponds en texte libre avec UNE courte phrase de confirmation.';
}

function pageUserPrompt(instruction: string, inventory: readonly PageEditableElement[]): string {
  const MAX_LINES = 100;
  const MAX_VALUE = 100;
  const lines = inventory.slice(0, MAX_LINES).map((el) => {
    const value = el.value.length > MAX_VALUE ? el.value.slice(0, MAX_VALUE) + '…' : el.value;
    const label = el.kind === 'text' ? 'texte' : el.kind === 'image' ? 'image' : 'lien';
    return `section=${el.section} path=${JSON.stringify(el.path)} ${label} <${el.tag}> « ${value} »`;
  });
  const truncated = inventory.length > MAX_LINES ? `\n(… et ${inventory.length - MAX_LINES} autres éléments)` : '';
  return 'Inventaire des éléments éditables (toutes sections) :\n' + lines.join('\n') + truncated +
    '\n\nDemande de l utilisateur : ' + instruction.trim();
}

export async function runAiPageEditLoop(options: {
  fetchImpl: typeof fetch;
  url: string;
  instruction: string;
  inventory: readonly PageEditableElement[];
  /** Exécute un appel validé (outil connu + section non vide + path valide + valeur non vide) ; renvoie le résultat à nourrir au modèle ('ERREUR: …' si refus). */
  apply: (call: { name: string; args: Record<string, unknown> }) => string | Promise<string>;
  model?: string | undefined;
  maxModelCalls?: number | undefined;
  headers?: Record<string, string> | undefined;
  validateImageUrl?: ImageUrlValidator | undefined;
  /** E43 — prévisualisation : les appels validés sont COLLECTÉS (proposedCalls) sans être appliqués. */
  deferApply?: boolean | undefined;
}): Promise<AiPageEditOutcome> {
  const instruction = options.instruction.trim();
  if (instruction.length === 0) {
    return { ok: false, appliedCount: 0, proposedCalls: [], touchedSections: [], iterations: 0, toolErrors: [], finalText: '', limitReached: false, reason: 'empty-instruction' };
  }
  if (options.inventory.length === 0) {
    return { ok: false, appliedCount: 0, proposedCalls: [], touchedSections: [], iterations: 0, toolErrors: [], finalText: '', limitReached: false, reason: 'empty-inventory' };
  }
  const deferApply = options.deferApply === true;
  const proposedCalls: AiEditProposedCall[] = [];
  const maxModelCalls = Math.max(1, options.maxModelCalls ?? 8);
  const model = options.model || 'codestral-latest';

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: pageSystemPrompt() },
    { role: 'user', content: pageUserPrompt(instruction, options.inventory) }
  ];

  let appliedCount = 0;
  const touched = new Set<string>();
  const toolErrors: string[] = [];

  for (let iteration = 1; iteration <= maxModelCalls; iteration++) {
    const isLastIteration = iteration === maxModelCalls;
    let response: Response;
    try {
      response = await options.fetchImpl(options.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          max_tokens: 2048,
          tools: isLastIteration ? undefined : PAGE_TOOLS
        })
      });
    } catch (err) {
      return {
        ok: false, appliedCount, proposedCalls, touchedSections: [...touched], iterations: iteration, toolErrors, finalText: '', limitReached: false,
        reason: 'http-error', detail: err instanceof Error ? err.message : String(err)
      };
    }
    if (!response.ok) {
      return {
        ok: false, appliedCount, proposedCalls, touchedSections: [...touched], iterations: iteration, toolErrors, finalText: '', limitReached: false,
        reason: 'http-error', detail: 'HTTP ' + response.status
      };
    }

    let data: MistralChatResponse;
    try {
      data = (await response.json()) as MistralChatResponse;
    } catch (err) {
      return {
        ok: false, appliedCount, proposedCalls, touchedSections: [...touched], iterations: iteration, toolErrors, finalText: '', limitReached: false,
        reason: 'http-error', detail: 'réponse non JSON: ' + (err instanceof Error ? err.message : String(err))
      };
    }

    const message = data?.choices?.[0]?.message;
    const rawToolCalls = message?.tool_calls;
    if (!rawToolCalls || rawToolCalls.length === 0) {
      return {
        ok: true, appliedCount, proposedCalls, touchedSections: [...touched], iterations: iteration, toolErrors,
        finalText: (message?.content ?? '').trim(), limitReached: false
      };
    }

    messages.push({
      role: 'assistant',
      content: message?.content ?? '',
      tool_calls: rawToolCalls.map((tc, idx) => ({
        id: 'p' + iteration + '-' + idx,
        type: 'function',
        function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments || '{}' }
      }))
    });

    for (let idx = 0; idx < rawToolCalls.length; idx++) {
      const call = rawToolCalls[idx];
      const callId = 'p' + iteration + '-' + idx;
      const name = call?.function?.name ?? '';
      let result: string;
      let args: Record<string, unknown> = {};
      const toolError = (msg: string): string => {
        toolErrors.push(msg);
        return 'ERREUR: ' + msg;
      };
      if (!(name in COMPONENT_VALUE_KEYS)) {
        result = toolError('outil inconnu "' + name + '"');
      } else {
        try {
          const parsed: unknown = JSON.parse(call?.function?.arguments || '{}');
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            args = parsed as Record<string, unknown>;
          }
        } catch {
          args = {};
        }
        const valueKey: 'text' | 'src' | 'href' = COMPONENT_VALUE_KEYS[name] ?? 'text';
        const value = args[valueKey];
        const section = typeof args.section === 'string' ? args.section.trim() : '';
        if (section.length === 0) {
          result = toolError('section manquante — utilise un nom EXACT de l inventaire');
        } else if (!isValidPath(args.path)) {
          result = toolError('path invalide pour "' + name + '" — utilise un path EXACT de l inventaire');
        } else if (typeof value !== 'string' || value.trim().length === 0) {
          result = toolError('valeur "' + valueKey + '" manquante ou vide');
        } else if (name === 'set_image_src' && options.validateImageUrl) {
          const invalid = await options.validateImageUrl(value.trim());
          if (invalid) {
            result = toolError('image inaccessible (' + invalid + ') — propose une AUTRE URL https://images.unsplash.com/photo-...');
          } else if (deferApply) {
            // E43 — collecté, pas appliqué ; le modèle reçoit OK pour conclure.
            proposedCalls.push({ name, args: { ...args, section, [valueKey]: value.trim() } });
            result = 'OK';
          } else {
            result = await options.apply({ name, args: { ...args, section, [valueKey]: value.trim() } });
            if (result.startsWith('ERREUR:')) {
              toolErrors.push(result.slice('ERREUR:'.length).trim());
            } else {
              appliedCount += 1;
              touched.add(section);
            }
          }
        } else {
          args[valueKey] = value.trim();
          args.section = section;
          if (deferApply) {
            // E43 — collecté, pas appliqué.
            proposedCalls.push({ name, args: { ...args } });
            result = 'OK';
          } else {
            const applied = await options.apply({ name, args });
            if (applied.startsWith('ERREUR:')) {
              result = applied;
              toolErrors.push(applied.slice('ERREUR:'.length).trim());
            } else {
              appliedCount += 1;
              touched.add(section);
              result = applied;
            }
          }
        }
      }
      messages.push({ role: 'tool', tool_call_id: callId, content: result });
    }
  }

  // Garde compilateur (le dernier tour part sans outils → retourne avant).
  return { ok: true, appliedCount, proposedCalls, touchedSections: [...touched], iterations: maxModelCalls, toolErrors, finalText: '', limitReached: true };
}
