# ADR-008 : Architecture de l'Explorateur de Fichiers (CORE-003)

- **Statut** : Accepté
- **Date** : 2026-09-04
- **Décideur** : Équipe Plateforme & Core Engineering
- **Contexte** : Cahier des Charges V7.0 — Phase 2 (CORE-003)

## 1. Contexte et Problématique
Le bloc **CORE-003 — File Explorer** fournit les structures et services nécessaires à la manipulation fine de l'arborescence des fichiers au sein d'un projet du Workspace.

L'utilisateur et les sous-systèmes (éditeurs, compilateurs, révisions) doivent pouvoir :
1. Consulter l'arborescence hiérarchique triée (dossiers en tête, fichiers ordonnés alphabétiquement).
2. Lire le contenu complet, la taille en octets et la date de modification d'un fichier.
3. Créer de nouveaux fichiers ou dossiers avec création automatique des dossiers parents intermédiaires.
4. Renommer des fichiers ou des dossiers avec mise à jour en cascade des chemins enfants.
5. Supprimer des fichiers ou dossiers (avec suppression récursive pour les dossiers).
6. Protéger impérativement le système contre les attaques par Directory Traversal (`..`, chemins absolus, caractères nuls).
7. Assurer une étanchéité multi-tenant totale et tracer toutes les mutations par des événements d'audit (`FILE_CREATE`, `FILE_DELETE`, `FILE_RENAME`).

## 2. Décision
1. **Module Métier `file-explorer` dans `@volaco/core`** :
   - Types de données stricts : `FileNode`, `FileContent`, `CreateFileInput`, `RenameFileInput`, `ProjectFilesSummary`.
   - `sanitizePath` : Sanitisation stricte et rejet de toute séquence relative ou dangereuse.
   - `FileStore` : Stockage virtuel en mémoire compartimenté par clé composite `${tenantId}:${projectId}`.
   - `FileExplorerService` : Validation des accès projets, contrôle RBAC (`PROJECT_READ`, `PROJECT_UPDATE`), construction de l'arbre récursif et émission d'audits.
2. **Endpoints API REST Dédiés (`apps/api`)** :
   - `GET /api/v1/projects/:id/files` : Arborescence complète et métriques de fichiers.
   - `GET /api/v1/projects/:id/files/content?path=...` : Lecture du contenu d'un fichier.
   - `POST /api/v1/projects/:id/files` : Création de fichier ou dossier.
   - `POST /api/v1/projects/:id/files/rename` : Renommage de fichier ou dossier.
   - `DELETE /api/v1/projects/:id/files?path=...` : Suppression de fichier ou dossier.

## 3. Conséquences
- Fondation établie pour **CORE-004 (Code Editor Persistence)** et la synchronisation continue avec l'éditeur de code du Studio.
- Conformité totale avec les règles CDC 0.1, 0.2 et 0.3.
