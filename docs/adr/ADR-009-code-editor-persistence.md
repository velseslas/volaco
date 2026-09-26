# ADR-009 : Architecture de Persistance de l'Éditeur de Code (CORE-004)

- **Statut** : Accepté
- **Date** : 2026-09-04
- **Décideur** : Équipe Plateforme & Core Engineering
- **Contexte** : Cahier des Charges V7.0 — Phase 2 (CORE-004)

## 1. Contexte et Problématique
Dans le cadre de la **Phase 2 (CORE APPLICATION)**, le bloc **CORE-004 — Code Editor** assure la persistance fiable et contrôlée des modifications de code effectuées par l'utilisateur ou par les flux de génération.

L'éditeur doit satisfaire les exigences suivantes :
1. Sauvegarde atomique du contenu d'un fichier identifié par son chemin relatif au projet.
2. Calcul systématique du condensat cryptographique SHA-256 du contenu pour garantir l'intégrité et la traçabilité des modifications.
3. Synchronisation de l'état de travail du Workspace (`WorkspaceService`) : passage immédiat de `isDirty: true` à `isDirty: false` dès que la sauvegarde réussit.
4. Contrôle d'accès strict via RBAC (`PROJECT_UPDATE` requis, rejet des `VIEWER`).
5. Émission d'un événement d'audit `FILE_SAVE` avec métadonnées (`sizeBytes`, `sha256`, `path`).

## 2. Décision
1. **Module Métier `editor` dans `@volaco/core`** :
   - Types stricts : `SaveFileInput`, `SaveFileResult`, `FileDraftStatus`.
   - `EditorService` : orchestre la sauvegarde via `FileStore`, le calcul du hash SHA-256 via le module cryptographique natif de Node, la synchronisation du `WorkspaceService` et l'audit.
2. **Endpoint API REST Dédié (`apps/api`)** :
   - `PUT /api/v1/projects/:id/files/content` : reçoit `{ path, content }` et renvoie les métadonnées de persistance et l'horodatage.

## 3. Conséquences
- Fin de la perte potentielle de code ou de désynchronisation entre le Workspace et les fichiers.
- Prérequis fondamental pour **CORE-005 (Terminal Contrôlé)** et **CORE-007 (Versioning / Revisions)**.
