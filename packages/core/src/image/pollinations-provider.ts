/**
 * VibeCode Core — Provider Pollinations (P4)
 *
 * Premier connecteur d'image RÉEL : génération par Pollinations.ai —
 * génération neuronale SANS clé API (URL prompt-encoded). Adapté au
 * vibecoding : aucune configuration, image unique par seed.
 *
 * LOT 2 (30/10) — RÉSILIENCE : le panneau Pollinations renvoie
 * régulièrement 402 (quota pilote), 429 (rate-limit), 500/503 (charges)
 * et la première erreur était définitive — image perdue, 500 anonyme
 * côté client (diagnostic images du 30/10 : 0 reconnecté). Tactique :
 *  - 3 tentatives (initiale + 2), backoff 1 s puis 3 s ;
 *  - statuts éphémères RÉESSAYABLES : 402/429/500/503 — le 402 pilote est
 *    intermittent, les essais suivants passent régulièrement ;
 *  - tout échec technique (timeout, non-image, image tronquée) est aussi
 *    réessayé : même panneau instable ;
 *  - échec final = ImageProviderUnavailableError (statut + essais tracés)
 *    → la route /images/generate le traduit en 502 explicite.
 * Le fetch ET les délais sont injectables (tests, zéro réseau réel).
 */

import { logger } from '../logger.js';
import type { GeneratedImage, ImageGenerateOptions, ImageProvider } from './registry.js';

const POLLINATIONS_URL = 'https://image.pollinations.ai/prompt/';

/** Statuts éphémères du panneau Pollinations qui méritent un nouvel essai. */
const RETRYABLE_STATUS: ReadonlyArray<number> = [402, 429, 500, 503];

/**
 * Permission refusée / service indisponible : erreur typée pour que la
 * route distingue un provider HORS SERVICE d'un prompt ou d'un stockage
 * en échec (les autres erreurs restent des 500).
 */
export class ImageProviderUnavailableError extends Error {
  public readonly provider: string;
  public readonly status?: number | undefined;
  public readonly attempts: number;

  constructor(provider: string, message: string, details?: { status?: number | undefined; attempts?: number }) {
    super(message);
    this.name = 'ImageProviderUnavailableError';
    this.provider = provider;
    this.status = details?.status;
    this.attempts = details?.attempts ?? 1;
  }
}

function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PollinationsImageProvider implements ImageProvider {
  public readonly id = 'pollinations';
  public readonly name = 'Pollinations (génération neuronale, sans clé)';

  private readonly timeoutMs: number;
  /** Backoff par essai supplémentaire — injectable pour des tests rapides. */
  private readonly retryDelaysMs: ReadonlyArray<number>;

  constructor(timeoutMs = 90000, retryDelaysMs: ReadonlyArray<number> = [1000, 3000]) {
    this.timeoutMs = timeoutMs;
    this.retryDelaysMs = retryDelaysMs;
  }

  /** Délai avant l'essai suivant (attempt 0 = avant le PREMIER retry). */
  private delayMsFor(attempt: number): number {
    return this.retryDelaysMs[attempt] ?? 3000;
  }

  public isAvailable(): boolean {
    // Aucune clé requise : disponible partout où le réseau l'est.
    return true;
  }

  public async generate(prompt: string, options: ImageGenerateOptions = {}): Promise<GeneratedImage> {
    const width = Math.min(Math.max(options.width ?? 1024, 256), 1920);
    const height = Math.min(Math.max(options.height ?? 576, 256), 1080);
    const fetchImpl = options.fetchImpl ?? fetch;
    const maxAttempts = this.retryDelaysMs.length + 1;

    let lastMessage = 'Pollinations injoignable';
    let lastStatus: number | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      // seed NOUVEAU à chaque essai : un essai = une image neuve, un retry
      // n'hérite pas d'un seed jugé maudit.
      const seed = Math.floor(Math.random() * 1_000_000);
      const url = POLLINATIONS_URL + encodeURIComponent(prompt.slice(0, 400))
        + `?width=${width}&height=${height}&nologo=true&seed=${seed}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetchImpl(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'VibeCode-Studio/1.0' }
        });
        if (!response.ok) {
          const status = response.status;
          if (RETRYABLE_STATUS.includes(status) && attempt < this.retryDelaysMs.length) {
            const delayMs = this.delayMsFor(attempt);
            logger.warn('Pollinations indisponible — nouvel essai programmé', {
              component: 'pollinations-provider',
              attempt: attempt + 1,
              maxAttempts,
              status,
              retryMs: delayMs
            });
            lastMessage = 'Pollinations a répondu HTTP ' + status;
            lastStatus = status;
            await sleepAsync(delayMs);
            continue;
          }
          lastMessage = 'Pollinations a répondu HTTP ' + status;
          lastStatus = status;
          break;
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
          throw new Error('Réponse non-image du provider (' + contentType.slice(0, 60) + ')');
        }
        const data = Buffer.from(await response.arrayBuffer());
        if (data.length < 1000) {
          throw new Error('Image renvoyée vide ou tronquée (' + data.length + ' octets)');
        }
        if (attempt > 0) {
          logger.warn('Pollinations rétabli après essais ratés', {
            component: 'pollinations-provider',
            attempt: attempt + 1,
            maxAttempts
          });
        }
        return { data, contentType };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          lastMessage = 'Pollinations : délai dépassé (' + this.timeoutMs + ' ms)';
          lastStatus = undefined;
        } else if (error instanceof Error) {
          lastMessage = error.message;
        } else {
          lastMessage = String(error);
        }
        if (attempt < this.retryDelaysMs.length) {
          const delayMs = this.delayMsFor(attempt);
          logger.warn('Pollinations : échec technique — nouvel essai programmé', {
            component: 'pollinations-provider',
            attempt: attempt + 1,
            maxAttempts,
            error: lastMessage,
            retryMs: delayMs
          });
          await sleepAsync(delayMs);
          continue;
        }
        break;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new ImageProviderUnavailableError(this.id, lastMessage, {
      status: lastStatus,
      attempts: maxAttempts
    });
  }
}
