/**
 * Import side-effect SPÉCIALISÉ (doit être LE PREMIER import du fichier de test) :
 * place VOLACO_DATA_DIR dans un dossier temporaire AVANT l'évaluation de la
 * chaîne serveur — garantit que composants/stockage des tests n'écrivent jamais
 * dans .volaco-data réel (les imports statiques hoistent avant le corps du
 * module : l'assignation dans le corps arrivait trop tard).
 *
 * LOT S4 — Fournit aussi un keyring dédié valide pour le chiffrement at-rest
 * (si absent, l'écriture des clés échoue explicitement, jamais en clair).
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const tempDataDir = mkdtempSync(join(tmpdir(), 'volaco-agentkeys-test-'));
process.env.VOLACO_DATA_DIR = tempDataDir;
process.env.VOLACO_MCP_REMOTE_KEY_ID = 'test-keyring-v1';
process.env.VOLACO_MCP_REMOTE_KEY = randomBytes(32).toString('base64');
// LOT B — secret JWT dédié (exigé au démarrage) + mode strict désactivé pour
// les requêtes de test utilisant les en-têtes legacy (développement/test).
process.env.VOLACO_JWT_SECRET = randomBytes(32).toString('base64');
if (process.env.VOLACO_STRICT_AUTH === undefined) {
  process.env.VOLACO_STRICT_AUTH = '0';
}
