# ADR-007 : Architecture du Tableau de Bord Projets (CORE-002)

- **Statut** : Accepté
- **Date** : 2026-09-04
- **Décideur** : Équipe Plateforme & Core Engineering
- **Contexte** : Cahier des Charges V7.0 — Phase 2 (CORE-002)

## 1. Contexte et Problématique
Dans le cadre de la **Phase 2 (CORE APPLICATION)**, le bloc **CORE-002 — Project Dashboard** a pour vocation de centraliser la gestion, la visualisation et le cycle de vie des projets utilisateur.

L'utilisateur et le système doivent pouvoir :
1. Obtenir une synthèse consolidée des projets d'un tenant (`DashboardSummary`).
2. Visualiser les projets triés par date de dernière modification sous forme de cartes d'information (`ProjectCard`).
3. Créer un nouveau projet avec validation stricte du nom, attribution d'un identifiant unique et traçabilité par audit.
4. Supprimer un projet de manière contrôlée avec vérification des permissions RBAC (`PROJECT_DELETE`) réservées aux rôles ADMIN/OWNER.
5. Garantir une isolation multi-tenant absolue (étanchéité totale des projets entre locataires).

## 2. Décision
1. **Module Métier `dashboard` dans `@volaco/core`** :
   - Définition des types `ProjectCard`, `DashboardSummary`, `CreateProjectInput`.
   - `DashboardService` encapsule la logique de calcul de synthèse, de tri temporel descendant, de validation RBAC et de notification d'audit (`PROJECT_CREATE`, `PROJECT_DELETE`).
2. **Endpoint API REST Dédié (`apps/api`)** :
   - `GET /api/v1/dashboard/summary` : délivre la synthèse du tenant authentifié avec horodatage, métadonnées et identifiant de traçabilité `X-Request-Id`.
3. **Interface Studio Synchronisée** :
   - Vue `#view-dashboard` avec grille dynamique de projets `#dashboardProjectsGrid`.
   - Modale de création `#newProjectModal` avec choix de template et bascule directe vers le Workspace.

## 3. Conséquences
- Architecture modulaire et découplée respectant les règles CDC 0.1 et 0.3.
- Prérequis satisfait pour le passage à **CORE-003 (File Explorer)**.
