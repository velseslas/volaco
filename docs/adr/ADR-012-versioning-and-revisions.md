# ADR-012 : Architecture du Versioning et Rollback (CORE-007)

- **Statut** : Accepté
- **Date** : 2026-09-04
- **Décideur** : Équipe Plateforme & Core Engineering
- **Contexte** : Cahier des Charges V7.0 — Phase 2 (CORE-007)

## 1. Contexte et Problématique
Dans le cadre de la **Phase 2 (CORE APPLICATION)**, le bloc **CORE-007 — Versioning / Revisions** constitue le mécanisme de sécurité ultime permettant à l'utilisateur de capturer l'état complet de son projet sous forme de révisions immuables et d'effectuer un retour en arrière (rollback) en 1 clic sans risque de corruption ni de perte de données.

Les exigences fondamentales sont :
1. **Snapshot Global Immuable** : Capture synchronisée de l'ensemble des fichiers du projet (`FileStore`) avec condensats cryptographiques SHA-256 individuels et chaînage parent-enfant.
2. **Rollback Non Destructif** : Selon la règle CDC 0.2, un rollback ne détruit jamais l'historique : il crée une nouvelle révision de restauration (ex: Révision #3 restaurant la Révision #1).
3. **Restauration Physique du FileStore** : Le rollback doit impérativement réécrire les fichiers dans le `FileStore` de façon à ce que le code actif du Workspace soit instantanément mis à jour.
4. **Contrôle d'Accès RBAC & Audit** : Permission `PROJECT_UPDATE` requise, génération systématique d'audits `REVISION_CREATE` et `ROLLBACK_TRIGGERED`.

## 2. Décision
1. **Module Métier `versioning` dans `@volaco/core`** :
   - `VersioningService` : orchestre la synchronisation entre `RevisionStore` et `FileStore`, assure la capture des snapshots complets et la réinjection atomique lors des rollbacks.
2. **Endpoints API REST Dédiés (`apps/api`)** :
   - `GET /api/v1/projects/:id/revisions` : liste chronologique des révisions.
   - `POST /api/v1/projects/:id/revisions` : création de snapshot.
   - `POST /api/v1/projects/:id/revisions/:revId/rollback` : exécution du rollback en 1 clic.

## 3. Conséquences
- Clôture avec succès de tous les blocs CORE-001 à CORE-007.
- Éligibilité immédiate au franchissement de la **Quality Gate 2 (GATE 2)**.
