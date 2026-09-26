# ADR-006 : Architecture de l'Espace de Travail (Workspace Core)

- **Statut** : Accepté
- **Date** : 2026-09-04
- **Décideur** : Équipe Plateforme & Core Engineering
- **Contexte** : Cahier des Charges V7.0 — Phase 2 (CORE-001)

## 1. Contexte et Problématique
Le passage à la **Phase 2 (CORE APPLICATION)** requiert de sortir du modèle éphémère du navigateur pour établir un véritable espace de travail (`Workspace`) géré par le Core et l'API.

L'utilisateur doit pouvoir :
1. Charger un projet existant dans un espace de travail isolé.
2. Suivre l'état du Workspace selon un cycle de vie déterministe (`IDLE`, `LOADING`, `READY`, `SAVING`, `ERROR`).
3. Sauvegarder et restaurer l'état du workspace (fichier actif, arborescence ouverte, statut de synchronisation).
4. Garantir l'isolation multi-tenant stricte : aucun locataire ne peut accéder ou charger un workspace d'un autre projet sans permission RBAC explicite.

## 2. Décision
1. **Module Dédié `workspace` dans `@volaco/core`** :
   - Interfaces et types immuables définissant `WorkspaceState`, `WorkspaceSession` et `WorkspaceStatus`.
   - `WorkspaceService` responsable de la validation des permissions RBAC (`PROJECT_READ`, `PROJECT_WRITE`) et de la persistance de l'état.
2. **Endpoints API REST Dédiés (`apps/api`)** :
   - `GET /api/v1/workspaces/:projectId` : charge la session de travail et vérifie l'accès du locataire.
   - `PUT /api/v1/workspaces/:projectId/state` : synchronise l'état actif (fichiers ouverts, curseur, vue active) avec trace d'audit.
3. **Traçabilité et Observabilité** :
   - Chaque chargement ou sauvegarde de workspace émet un événement d'audit (`WORKSPACE_LOAD`, `WORKSPACE_SAVE`) et mesure la latence d'exécution.

## 3. Conséquences
- Fondation solide pour les blocs suivants de la Phase 2 :
  - **CORE-002** (Dashboard de projets)
  - **CORE-003** (Explorateur de fichiers)
  - **CORE-004** (Éditeur de code)
- Zéro accès direct non contrôlé à la base de données.
