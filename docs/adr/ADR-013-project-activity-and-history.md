# ADR-013 : Architecture de l'Activité et Historique Projet (CAPP-007) & Quality Gate 2

- **Statut** : Accepté
- **Date** : 2026-09-04
- **Décideur** : Équipe Plateforme & Core Engineering
- **Contexte** : Cahier des Charges V7.0 — Phase 2 (CAPP-007 & Clôture GATE 2)

## 1. Contexte et Problématique
Dans le cycle de vie de développement assisté par IA de VibeCode Studio, le suivi continu et précis des événements projet constitue un impératif fondamental d'observabilité, d'audit et de traçabilité.

Le bloc **CAPP-007 — Project Activity & History** finalise la Phase 2 (Core Application) en permettant d'enregistrer et de consulter une chronologie granulaire de l'ensemble des actions survenant au sein d'un projet :
- Création du projet
- Création, modification, suppression ou renommage de fichiers
- Création de révisions et snapshots
- Modifications autonomes ou guidées par l'IA
- Rollbacks non destructifs vers des versions antérieures
- Transitions de statut et validations

La séquence type de validation Phase 2 s'articule comme suit :
```text
PROJECT HISTORY
09:42  User created project
09:45  File created
09:47  File modified
09:48  Revision 2 created
09:51  AI modification
09:53  Revision 3 created
09:55  Rollback → Revision 1
```

## 2. Décision d'Architecture
1. **Modèle de Données Granulaire (`packages/core/src/activity/`)** :
   - `ProjectActivity` : horodatage ISO (`timestamp`), temps d'affichage formaté (`displayTime`), type d'activité (`ActivityType`), acteur identifié (`ActivityActor`: Utilisateur, Agent IA, Système) et métadonnées contextuelles.
   - `ProjectActivityStore` : isolation hermétique multi-tenant et multi-projet, support du tri chronologique descendant et ascendant, et filtrage par type d'événement ou acteur.
   - `ProjectActivityService` : contrôle d'accès strict via la matrice RBAC (`PROJECT_READ` pour la consultation, `PROJECT_UPDATE` pour l'enregistrement), synchronisation automatique miroir avec `AuditStore` (FND-005).

2. **Endpoints API REST (`apps/api`)** :
   - `GET /api/v1/projects/:projectId/history` (et alias `/activity`) : liste chronologique paginée et filtrable.
   - `POST /api/v1/projects/:projectId/history` : enregistrement manuel d'événement.
   - `POST /api/v1/projects/:projectId/history/seed` : injection déterministe de la séquence de référence.

3. **Intégration Studio (`apps/studio/index.html` & `volaco_studio.html`)** :
   - Onglet **Historique** enrichi proposant une vue bi-mode : **Timeline d'Activité (CAPP-007)** et **Révisions & Rollback (CORE-007)**.
   - Réactivité en temps réel : tout snapshot ou rollback met à jour instantanément la timeline.

4. **Conditions de franchissement de la Quality Gate 2 (GATE 2)** :
   - TypeScript strict (`tsc --noEmit`) sans aucune erreur.
   - Build de production (`tsc`).
   - 100% de succès sur la suite complète de tests (170+ tests).
   - Non-régression totale sur GATE 1 (les 31 tests historiques de la Phase 1).
   - Validation de l'isolation multi-tenant, du RBAC, de la sécurité contre le Path Traversal et les injections de commandes.
   - Intégrité syntaxique totale de l'ensemble des 12 templates interactifs du Studio.

## 3. Conséquences
- Validation complète et officielle de l'ensemble des exigences de la **Phase 2 (CORE APPLICATION)** : 100%.
- Gel de la Phase 2 et éligibilité pour la transition vers les phases ultérieures.
