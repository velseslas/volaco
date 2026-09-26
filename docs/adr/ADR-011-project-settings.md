# ADR-011 : Architecture des Paramètres de Projet (CORE-006)

- **Statut** : Accepté
- **Date** : 2026-09-04
- **Décideur** : Équipe Plateforme & Core Engineering
- **Contexte** : Cahier des Charges V7.0 — Phase 2 (CORE-006)

## 1. Contexte et Problématique
Dans le cadre de la **Phase 2 (CORE APPLICATION)**, le bloc **CORE-006 — Project Settings** permet de configurer les métadonnées, la stack technique (`framework`, `buildTool`, `nodeVersion`) et les variables d'environnement (`envVars`) propres à chaque projet.

Les exigences fondamentales sont :
1. **Masquage Automatique des Secrets** : Toute variable d'environnement dont la clé évoque un secret (`API_KEY`, `SECRET`, `PASSWORD`, `TOKEN`, `CREDENTIAL`) doit impérativement être masquée lors de la lecture afin d'éviter les fuites de données dans les logs ou les réponses HTTP.
2. **Contrôle d'Accès RBAC** : Lecture autorisée dès le rôle `VIEWER`, mais modification strictement réservée aux rôles `ENGINEER`, `ADMIN` ou `OWNER`.
3. **Traçabilité des Changements** : Émission systématique d'un événement d'audit `SETTINGS_UPDATE`.
4. **Herméticité Multi-Tenant** : Aucun locataire ne peut lire ni altérer les paramètres d'un projet tiers.

## 2. Décision
1. **Module Métier `settings` dans `@volaco/core`** :
   - Interfaces `ProjectStack`, `ProjectSettings`, `UpdateProjectSettingsInput`.
   - `SettingsService` : gère les paramètres par défaut, les mises à jour atomiques, le masquage via `maskSecret` et les logs d'audit.
2. **Endpoints API REST Dédiés (`apps/api`)** :
   - `GET /api/v1/projects/:id/settings` : consultation protégée avec masquage des secrets.
   - `PUT /api/v1/projects/:id/settings` : mise à jour des paramètres.

## 3. Conséquences
- Configuration claire et extensible de chaque application.
- Préparation de la dernière brique de Phase 2 : **CORE-007 (Versioning / Revisions)**.
