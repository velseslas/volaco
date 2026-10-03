/**
 * VibeCode Core — Provider Pollinations (P4)
 *
 * Premier connecteur d'image RÉEL : génération par Pollinations.ai —
 * génération neuronale SANS clé API (URL prompt-encoded). Adapté au
 * vibecoding : aucune configuration, image unique par seed.
 *
 * Le fetch est injectable (tests) ; en production c'est le fetch global.
 */

import type { GeneratedImage, ImageGenerateOptions, ImageProvider } from './registry.js';

const POLLINATIONS_URL = 'https://image.pollinations.ai/prompt/';

export class PollinationsImageProvider implements ImageProvider {
  public readonly id = 'pollinations';
  public readonly name = 'Pollinations (génération neuronale, sans clé)';

  private readonly timeoutMs: number;

  constructor(timeoutMs = 90000) {
    this.timeoutMs = timeoutMs;
  }

  public isAvailable(): boolean {
    // Aucune clé requise : disponible partout où le réseau l'est.
    return true;
  }

  public async generate(prompt: string, options: ImageGenerateOptions = {}): Promise<GeneratedImage> {
    const width = Math.min(Math.max(options.width ?? 1024, 256), 1920);
    const height = Math.min(Math.max(options.height ?? 576, 256), 1080);
    // seed aléatoire : une même demande produit une image NOUVELLE à chaque appel
    const seed = Math.floor(Math.random() * 1_000_000);
    const url = POLLINATIONS_URL + encodeURIComponent(prompt.slice(0, 400))
      + `?width=${width}&height=${height}&nologo=true&seed=${seed}`;

    const fetchImpl = options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'VibeCode-Studio/1.0' }
      });
      if (!response.ok) {
        throw new Error('Pollinations a répondu HTTP ' + response.status);
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        throw new Error('Réponse non-image du provider (' + contentType.slice(0, 60) + ')');
      }
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length < 1000) {
        throw new Error('Image renvoyée vide ou tronquée (' + data.length + ' octets)');
      }
      return { data, contentType };
    } finally {
      clearTimeout(timer);
    }
  }
}
