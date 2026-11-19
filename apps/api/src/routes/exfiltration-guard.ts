/**
 * É50/É51 — GARDE-FOU D'EXFILTRATION — point d'entrée API (re-export).
 *
 * L'implémentation canonique vit désormais dans le core :
 *   packages/core/src/ai-native/security/exfiltration-guard.ts
 * (déplacement É51 : le Mutation Orchestrator — core — doit utiliser le même
 * garde-fou déterministe à sa frontière d'écriture, et le core n'importe pas
 * depuis apps/. Ce fichier reste l'import utilisé par les attaches É50 dans
 * apps/api pour que les chemins déjà sécurisés restent inchangés.)
 *
 * Contrat identique : refus par défaut, whitelist fermée, scan déterministe
 * sans accès réseau, trace d'audit structurée.
 */

export {
  runExfiltrationGuard,
  describeExfiltrationBlocker
} from '../../../../packages/core/src/ai-native/security/exfiltration-guard.js';

export type {
  ExfiltrationFinding,
  ExfiltrationGuardReport
} from '../../../../packages/core/src/ai-native/security/exfiltration-guard.js';
