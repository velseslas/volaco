# ADR-010 : Architecture du Terminal Sécurisé et Contrôlé (CORE-005)

- **Statut** : Accepté
- **Date** : 2026-09-04
- **Décideur** : Équipe Plateforme & Core Engineering
- **Contexte** : Cahier des Charges V7.0 — Phase 2 (CORE-005)

## 1. Contexte et Problématique
Dans le cadre de la **Phase 2 (CORE APPLICATION)**, le bloc **CORE-005 — Terminal / Command Interface Contrôlée** a pour objet de permettre à l'utilisateur et au Studio de lancer des commandes système indispensables (vérification de version, statut Git, builds, tests) sans exposer le serveur hôte à des attaques par exécution de code arbitraire.

Le terminal doit garantir :
1. **Une Whitelist Stricte de Binaires** : seuls `pnpm`, `npm`, `node` et `git` sont recevables.
2. **Une Protection Anti-Injection Absolue** : détection et rejet immédiat des opérateurs de chaînage shell (`;`, `&&`, `||`, `|`, `>`, `<`, `$()`, etc.).
3. **Une Exécution Contrôlée & Sandboxée** : capture des flux `stdout` et `stderr`, code de retour numérique, calcul de latence d'exécution.
4. **Contrôle d'Accès RBAC** : permission `PROJECT_UPDATE` requise (interdit aux rôles `VIEWER`).
5. **Traçabilité Complète** : émission d'un événement d'audit `TERMINAL_EXECUTE` pour chaque tentative d'exécution.

## 2. Décision
1. **Module Métier `terminal` dans `@volaco/core`** :
   - `validateAndParseCommand` : parseur strict rejetant toute commande suspecte ou hors whitelist.
   - `TerminalService` : service d'exécution contrôlé avec isolation multi-tenant et audit trail.
2. **Endpoint API REST Dédié (`apps/api`)** :
   - `POST /api/v1/projects/:id/terminal/execute` : reçoit `{ command }` et retourne `{ result: CommandResult, requestId }`.

## 3. Conséquences
- Zéro risque de compromission du serveur par injection de commande shell.
- Environnement prêt pour l'intégration des paramètres de projet (**CORE-006**) et du versioning (**CORE-007**).
