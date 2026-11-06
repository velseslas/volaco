/**
 * LOT B — environnement de test PARTAGÉ (import side-effect, en PREMIER import).
 *
 * Le mode strict est désormais le DÉFAUT (B1). La grande majorité des tests
 * historiques s'authentifient via les en-têtes legacy x-tenant-id/x-user-role
 * (non signés). Pour ne pas les casser tout en conservant la garantie
 * « strict par défaut », on désactive explicitement le strict ici
 * (`VOLACO_STRICT_AUTH='0'`, autorisé en développement/test) et on fournit un
 * secret JWT dédié valide (exigé par le démarrage du service).
 *
 * Les suites DÉDIÉES au mode strict (auth-strict-mode, auth-enforcement,
 * lot-b-auth-revocation) positionnent leur propre configuration AVANT cet
 * import et n'utilisent donc PAS ce helper.
 */

import { randomBytes } from 'node:crypto';

// Développement/test uniquement : le strict reste le comportement par défaut
// partout ailleurs (production : strict obligatoire, jamais désactivable).
if (process.env.VOLACO_STRICT_AUTH === undefined) {
  process.env.VOLACO_STRICT_AUTH = '0';
}
if (!process.env.VOLACO_JWT_SECRET) {
  process.env.VOLACO_JWT_SECRET = randomBytes(32).toString('base64');
}

// LOT B (décision 5) — quotas MCP distants : les suites d'intégration font
// volontairement des dizaines d'appels (prepare/call) sur le MÊME tenant en
// quelques millisecondes ; les plafonds de production par minute sont
// inadaptés à cet exercice DÉTERMINISTE. On les surcharge ici à une valeur
// haute : la limitation elle-même est prouvée par sa suite dédiée
// (lot-b-audit-quota.test.ts, qui teste le limiteur sans serveur) et par
// lot-b-quota-e2e le cas échéant. Ces overrides n'affectent QUE les tests.
const TEST_MCP_QUOTA = '100000';
for (const name of [
  'VOLACO_MCP_QUOTA_DISCOVERY_TENANT', 'VOLACO_MCP_QUOTA_DISCOVERY_USER',
  'VOLACO_MCP_QUOTA_PREPARE_TENANT', 'VOLACO_MCP_QUOTA_PREPARE_USER',
  'VOLACO_MCP_QUOTA_CALL_TENANT', 'VOLACO_MCP_QUOTA_CALL_USER',
  'VOLACO_MCP_QUOTA_CONNECTORS_TENANT', 'VOLACO_MCP_QUOTA_CONNECTORS_USER'
]) {
  if (process.env[name] === undefined) process.env[name] = TEST_MCP_QUOTA;
}
