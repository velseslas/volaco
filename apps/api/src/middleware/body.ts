import type { IncomingMessage } from 'node:http';
import { AppError } from '../../../../packages/core/src/errors.js';

/**
 * Taille maximale par défaut d'un corps de requête (1 Mo). Les générations IA
 * peuvent transporter le HTML complet d'une application — 1 Mo couvre largement
 * ce cas tout en bornant la mémoire consommée par requête.
 */
export const MAX_BODY_BYTES = 1_048_576;

/**
 * Lit le corps d'une requête avec une borne stricte de taille.
 *
 * Unique implémentation pour toutes les routes : avant ce helper, chaque route
 * définissait sa propre copie de readBody avec un accumulateur SANS limite —
 * un POST volumineux suffisait à saturer la mémoire du serveur (DoS).
 */
export function readBody(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new AppError(
          `Corps de requête trop volumineux (max ${maxBytes} octets)`,
          'PAYLOAD_TOO_LARGE',
          413
        ));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
  });
}
