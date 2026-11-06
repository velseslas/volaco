/**
 * LOT B — import side-effect minimal (doit être LE PREMIER import du test) :
 * fournit un secret JWT dédié valide (exigé au démarrage, B3-1/P0) et, par
 * défaut en test, désactive le mode strict (le repli dev par en-têtes
 * x-tenant-id/x-user-role reste disponible pour les suites non dédiées).
 *
 * Les suites qui TESTENT explicitement le strict (auth-strict, auth-strict-mode,
 * mcp-remote-servers-strict) positionnent `VOLACO_STRICT_AUTH='1'` dans leur
 * corps de module, AVANT le démarrage du serveur : leur valeur l'emporte.
 */

import { randomBytes } from 'node:crypto';

if (!process.env.VOLACO_JWT_SECRET) {
  process.env.VOLACO_JWT_SECRET = randomBytes(32).toString('base64');
}
if (process.env.VOLACO_STRICT_AUTH === undefined) {
  process.env.VOLACO_STRICT_AUTH = '0';
}

// LOT B (décision 5) — quotas MCP distants : les suites d'intégration font
// volontairement des dizaines d'appels sur le même tenant en quelques
// millisecondes ; les plafonds de production par minute sont inadaptés à cet
// exercice déterministe. La limitation elle-même est prouvée par sa suite
// dédiée (lot-b-audit-quota.test.ts, sans serveur). Overrides de TEST only.
const TEST_MCP_QUOTA = '100000';
for (const name of [
  'VOLACO_MCP_QUOTA_DISCOVERY_TENANT', 'VOLACO_MCP_QUOTA_DISCOVERY_USER',
  'VOLACO_MCP_QUOTA_PREPARE_TENANT', 'VOLACO_MCP_QUOTA_PREPARE_USER',
  'VOLACO_MCP_QUOTA_CALL_TENANT', 'VOLACO_MCP_QUOTA_CALL_USER',
  'VOLACO_MCP_QUOTA_CONNECTORS_TENANT', 'VOLACO_MCP_QUOTA_CONNECTORS_USER'
]) {
  if (process.env[name] === undefined) process.env[name] = TEST_MCP_QUOTA;
}
