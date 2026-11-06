/**
 * LOT B — import side-effect minimal (doit être LE PREMIER import du test) :
 * fournit un secret JWT dédié valide, exigé par `loadConfig()` depuis la
 * décision B3-1/P0 (le service refuse de démarrer sans secret conforme).
 * Désactive aussi le mode strict (comportement de développement/test).
 */

import { randomBytes } from 'node:crypto';

if (!process.env.VOLACO_JWT_SECRET) {
  process.env.VOLACO_JWT_SECRET = randomBytes(32).toString('base64');
}
if (process.env.VOLACO_STRICT_AUTH === undefined) {
  process.env.VOLACO_STRICT_AUTH = '0';
}
