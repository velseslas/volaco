/**
 * LOT B — import side-effect SPÉCIALISÉ (doit être LE PREMIER import du test) :
 * fournit un secret JWT dédié valide + une clé API distincte AVANT l'évaluation
 * de la chaîne serveur (les imports statiques hoistent avant le corps du module).
 */

import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VOLACO_DATA_DIR = mkdtempSync(join(tmpdir(), 'volaco-lotb-test-'));
process.env.VOLACO_JWT_SECRET = randomBytes(32).toString('base64');
process.env.VOLACO_API_KEY = 'api-key-test-' + randomBytes(6).toString('hex');
