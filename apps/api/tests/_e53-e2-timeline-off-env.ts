/**
 * É53 LOT E2 — environnement T7 (télémétrie OFF) : import side-effect, TOUJOURS
 * PREMIER import du fichier e53-e2-timeline-off.test.ts.
 *
 * `executionTimelineEnabled` est un `const` de module capturé au CHARGEMENT de
 * conversation.ts (route /stream) : le flag doit donc être posé AVANT tout
 * import de server.js. On hérite d'abord de l'env partagé LOT B (strict auth
 * désactivé pour les tests, secret JWT, quotas MCP), puis on force la
 * télémétrie OFF — exactement le contrat de la Correction B : désactiver la
 * COLLECTE ne désactive jamais le CONTRÔLE (l'annulation reste opérationnelle).
 */
import './_lot-b-legacy-env.js';

process.env.VOLACO_EXECUTION_TIMELINE = 'off';
