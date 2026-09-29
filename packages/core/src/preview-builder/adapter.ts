/**
 * ÉTAPE 08 — AI GENERATION ADAPTER : frontière entre le générateur réel et
 * le Preview Builder (spec : ADAPTER = SSE → PreviewBuildEvent).
 *
 * ARCHITECTURE :
 *   AI GENERATOR → SSE → parse → validate → normalize → PreviewBuildEvent
 *                                                          → PREVIEW ENGINE
 *
 * RÈGLES :
 * - le moteur ne sait RIEN de SSE/HTTP/fetch/transport (ce module non plus,
 *   hormis SSEBuildEventSource qui encapsule le transport de façon injectable) ;
 * - tout événement entrant est NON FIABLE : parse, validate, normalize,
 *   rejeter proprement — un événement invalide ne casse JAMAIS le pipeline ;
 * - l'ordre des événements est CONSERVÉ (traducteur, pas deuxième moteur) ;
 * - les événements inconnus (chat, token, compass, AI_THINKING…) sont ignorés ;
 * - normalisation PUR : input → output, sans effet de bord.
 */

import type { PreviewBuildEvent } from './engine.js';

export interface NormalizeResult {
  events: PreviewBuildEvent[];
  /** Événements reconnus mais hors contrat Preview (compass, chat, token…). */
  ignored: number;
  /** Événements rejetés (malformés, sans id, type inconnu…). */
  rejected: number;
  /** Raison du rejet (diagnostic — l'entrée n'est jamais mutée). */
  reason?: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * Normalise UN événement brut du générateur en 0..n PreviewBuildEvents.
 * Contrat du flux réel (routes/conversation.ts) : start, compass, plan,
 * chat, token, section_start, section_end, diff, done, error, cancelled.
 * Retourne { events, ignored, rejected } — jamais d'exception.
 */
export function normalizeGenerationEvent(raw: unknown): NormalizeResult {
  const rejected = (reason: string): NormalizeResult => ({ events: [], ignored: 0, rejected: 1, reason });
  const ignored = (count = 1): NormalizeResult => ({ events: [], ignored: count, rejected: 0 });

  if (!isRecord(raw)) return { events: [], ignored: 0, rejected: 1, reason: 'payload non-objet' };
  const type = str(raw.type) ?? str(raw.event);
  if (!type) return { events: [], ignored: 0, rejected: 1, reason: 'sans type' };

  switch (type) {
    case 'start':
      return { events: [{ kind: 'BUILD_STARTED', stage: 'structure', timestamp: ts(raw) }], ignored: 0, rejected: 0 };

    case 'section_start': {
      const name = str(raw.name);
      if (!name) return { events: [], ignored: 0, rejected: 1, reason: 'section_start sans name' };
      const after = str(raw.after);
      const created: PreviewBuildEvent = {
        kind: 'COMPONENT_CREATED',
        component: {
          id: name,
          type: name,
          ...(name ? { label: name } : {}),
          ...(after !== undefined ? { parentId: after } : {})
        },
        timestamp: ts(raw)
      };
      const building: PreviewBuildEvent = { kind: 'COMPONENT_BUILDING', componentId: name, timestamp: ts(raw) };
      return { events: [created, building], ignored: 0, rejected: 0 };
    }

    case 'section_end': {
      const name = str(raw.name);
      if (!name) return { events: [], ignored: 0, rejected: 1, reason: 'section_end sans name' };
      const metadata: Record<string, unknown> = {};
      if (typeof raw.html === 'string') metadata.html = raw.html;
      return {
        events: [
          {
            kind: 'COMPONENT_READY',
            componentId: name,
            timestamp: ts(raw),
            ...(Object.keys(metadata).length ? { metadata } : {})
          }
        ],
        ignored: 0,
        rejected: 0
      };
    }

    case 'done': {
      if (raw.awaitingConfirmation === true) return ignored(); // Plan First : hors contrat de build
      return { events: [{ kind: 'BUILD_COMPLETED', timestamp: ts(raw) }], ignored: 0, rejected: 0 };
    }

    case 'error':
      return { events: [{ kind: 'BUILD_FAILED', error: str(raw.error) || 'erreur générateur', timestamp: ts(raw) }], ignored: 0, rejected: 0 };

    case 'cancelled': {
      const reason = str(raw.reason);
      return {
        events: [
          { kind: 'BUILD_CANCELLED', timestamp: ts(raw), ...(reason !== undefined ? { reason } : {}) }
        ],
        ignored: 0,
        rejected: 0
      };
    }

    // Événements reconnus du flux réel mais SANS équivalent dans le contrat
    // Preview (narration, tokens, compass, diff…) : ignorés proprement.
    case 'chat':
    case 'token':
    case 'compass':
    case 'plan':
    case 'diff':
      return ignored();

    default:
      return ignored(); // type inconnu : ignoré, jamais injecté (spec §événements inconnus)
  }
}

function ts(raw: Record<string, unknown>): number {
  return typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
}

/** Normalise une séquence en conservant l'ordre (traducteur, pas réordonneur). */
export function normalizeGenerationEvents(raws: unknown[]): NormalizeResult {
  const result: NormalizeResult = { events: [], ignored: 0, rejected: 0 };
  for (const raw of raws || []) {
    const r = normalizeGenerationEvent(raw);
    result.events.push(...r.events);
    result.ignored += r.ignored;
    result.rejected += r.rejected;
  }
  return result;
}

/* =====================================================================
 * BUILD EVENT SOURCE — abstraction Mock / SSE interchangeable.
 * Les deux produisent des PreviewBuildEvents pour le MÊME moteur.
 * ===================================================================== */

export interface BuildEventSourceHandle {
  stop(): void;
}

export interface BuildEventSource {
  /** Démarre la source ; handler reçoit des PreviewBuildEvents ordonnés. */
  subscribe(handler: (event: PreviewBuildEvent) => void, onError?: (message: string) => void): BuildEventSourceHandle;
}

/** Transport SSE simulé : séquence de chunks texte (isolée du pipeline). */
export interface MockSSETransport {
  chunks: string[];
  /** Délai entre chunks (défaut 250 ms). */
  intervalMs?: number;
}

/**
 * SOURCE SSE RÉELLE : ouvre le flux via fetch (injectable pour les tests),
 * parse les frames `data: {json}` et normalise via l'adaptateur.
 * Aucune dépendance : le transport est fourni par l'app hôte (navigateur).
 */
export class SSEBuildEventSource implements BuildEventSource {
  constructor(
    private readonly options: {
      url: string;
      body?: unknown;
      headers?: Record<string, string>;
      fetchImpl?: typeof fetch;
    }
  ) {}

  public subscribe(handler: (event: PreviewBuildEvent) => void, onError?: (message: string) => void): BuildEventSourceHandle {
    const controller = new AbortController();
    const doFetch = this.options.fetchImpl ?? fetch;
    doFetch(this.options.url, {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', ...(this.options.headers || {}) },
      body: JSON.stringify(this.options.body ?? {}),
      signal: controller.signal
    })
      .then(async (res) => {
        if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += typeof value === 'string' ? value : decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';
          for (const frame of frames) consumeSseFrame(frame, handler, onError);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return; // stop() volontaire
        onError?.(err instanceof Error ? err.message : String(err));
      });
    return { stop: () => controller.abort() };
  }
}

/** Traite UNE frame SSE (texte) : parse data:, valide, normalise, notifie. */
export function consumeSseFrame(frame: string, handler: (event: PreviewBuildEvent) => void, onError?: (message: string) => void): { accepted: number; ignored: number; rejected: number; malformed: number } {
  const dataLines = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) return { accepted: 0, ignored: 0, rejected: 0, malformed: 0 };
  const payload = dataLines.join('\n');
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    onError?.('SSE JSON invalide ignoré');
    return { accepted: 0, ignored: 0, rejected: 0, malformed: 1 };
  }
  const result = normalizeGenerationEvent(parsed);
  for (const event of result.events) handler(event);
  if (result.rejected > 0) onError?.(`${result.rejected} événement(s) générateur rejeté(s)`);
  return { accepted: result.events.length, ignored: result.ignored, rejected: result.rejected, malformed: 0 };
}

/** SOURCE MOCK : rejoue le scénario de démonstration à rythme constant. */
export class MockBuildEventSource implements BuildEventSource {
  constructor(private readonly options: { events: PreviewBuildEvent[]; intervalMs?: number }) {}

  public subscribe(handler: (event: PreviewBuildEvent) => void): BuildEventSourceHandle {
    const events = this.options.events;
    let i = 0;
    const timer = setInterval(() => {
      if (i >= events.length) { clearInterval(timer); return; }
      handler(events[i]!);
      i++;
    }, this.options.intervalMs ?? 300);
    return { stop: () => clearInterval(timer) };
  }
}
