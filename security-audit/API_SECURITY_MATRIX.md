# MATRICE COMPLÈTE DE SÉCURITÉ DE L'API REST (API SECURITY MATRIX)

**Date d'évaluation :** 11 Septembre 2026  
**Périmètre :** 17 fichiers de route dans `apps/api/src/routes/` exposant 38 endpoints HTTP  
**Auteurs :** Red Team Volaco  

---

## 1. Matrice des 38 Endpoints HTTP

| Méthode | Chemin d'Accès | Rôle Minimal Requis | Vérification de Propriété Projet | Données en Entrée | Effets de Bord / Stockage | Risque & Vulnérabilité Identifiée |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- |
| **GET** | `/health` | Aucun | N/A | Aucun | Aucun | Public, statut serveur exposé |
| **GET** | `/status` | Aucun | N/A | Aucun | Aucun | Public, architecture exposée |
| **GET** | `/metrics` | Aucun | N/A | Aucun | Aucun | **SEC-015** : Fuite de statistiques globales sans auth |
| **GET** | `/api/v1/audit` | `TENANT_MANAGE` | `tenantId` | Aucun | Aucun | Vulnérable si header spoofing (SEC-002) |
| **GET** | `/api/v1/ai/usage` | `PROJECT_READ` | `tenantId` | Aucun | Aucun | Vulnérable si header spoofing (SEC-002) |
| **GET** | `/api/v1/dashboard/summary` | `VIEWER` | `tenantId` | Aucun | Aucun | Résumé complet des projets du tenant |
| **GET** | `/api/v1/projects` | `PROJECT_READ` | `tenantId` | Aucun | Aucun | Liste tous les projets du tenant |
| **POST** | `/api/v1/projects` | `PROJECT_CREATE` | `tenantId` | JSON `{name, description}` | Création en mémoire dans `ProjectStore` | Vulnérable à l'usurpation de tenant |
| **GET** | `/api/v1/projects/:id` | `PROJECT_READ` | Oui (`getProject`) | Param `:id` | Aucun | IDOR protégé si tenant authentique |
| **DELETE** | `/api/v1/projects/:id` | `PROJECT_DELETE` | Oui (`deleteProject`) | Param `:id` | Suppression dans `ProjectStore` | Risque suppression par un faux OWNER |
| **GET** | `/api/v1/projects/:id/summary` | `PROJECT_READ` | Oui (`assertProjectAccess`) | Param `:id` | Aucun | Métriques du projet |
| **GET** | `/api/v1/projects/:id/workspace` | `PROJECT_READ` | Oui (`assertProjectAccess`) | Param `:id` | Aucun | État de l'espace de travail |
| **PUT** | `/api/v1/projects/:id/workspace` | `PROJECT_UPDATE` | Oui (`assertProjectAccess`) | JSON payload | Mise à jour workspace | Altération de workspace |
| **GET** | `/api/v1/projects/:id/state` | `PROJECT_READ` | Oui (`assertProjectAccess`) | Param `:id` | Aucun | État complet de l'application |
| **GET** | `/api/v1/projects/:id/shell` | `PROJECT_READ` | Oui (`assertProjectAccess`) | Param `:id` | Aucun | ViewModel du Studio |
| **GET** | `/api/v1/projects/:id/activity` | `PROJECT_READ` | Oui (`assertProjectAccess`) | Query `?limit=` | Aucun | Historique d'activité du projet |
| **GET** | `/api/v1/projects/:id/audit` | `PROJECT_READ` | Oui (`assertProjectAccess`) | Param `:id` | Aucun | Rapport d'audit qualité et santé |
| **POST** | `/api/v1/projects/:id/audit/run` | `PROJECT_UPDATE` | Oui (`assertProjectAccess`) | JSON payload | Calcul en mémoire d'audit | Risque d'épuisement CPU si flood |
| **GET** | `/api/v1/projects/:id/features` | `PROJECT_READ` | Oui (`assertProjectAccess`) | Param `:id` | Aucun | Découverte d'opportunités |
| **POST** | `/api/v1/projects/:id/features/discover`| `PROJECT_UPDATE`| Oui (`assertProjectAccess`) | JSON payload | Analyse des fonctionnalités | Coût CPU/mémoire |
| **GET** | `/api/v1/projects/:id/feedback` | `PROJECT_READ` | Oui (`assertProjectAccess`) | Param `:id` | Aucun | Données de feedback utilisateur |
| **POST** | `/api/v1/projects/:id/feedback/analyze` | `PROJECT_UPDATE`| Oui (`assertProjectAccess`) | JSON payload | Analyse des bugs & signaux | Injection indirecte possible |
| **GET** | `/api/v1/projects/:id/strategy` | `PROJECT_READ` | Oui (`assertProjectAccess`) | Param `:id` | Aucun | Vision stratégique et roadmap |
| **POST** | `/api/v1/projects/:id/strategy/analyze` | `PROJECT_UPDATE`| Oui (`assertProjectAccess`) | JSON payload | Calcul de score stratégique | Coût de calcul |
| **GET** | `/api/v1/projects/:id/evolution` | `PROJECT_READ` | Oui (`getProject`) | Param `:id` | Aucun | Rapport d'évolution AINT-017 |
| **POST** | `/api/v1/projects/:id/evolution/analyze`| `PROJECT_READ` | Oui (`getProject`) | JSON payload | Génération déterministe AINT-017 | Absence de rate limit (SEC-013) |
| **GET** | `/api/v1/projects/:id/evolution/health` | `PROJECT_READ` | Oui (`getProject`) | Param `:id` | Aucun | Score de santé produit |
| **GET** | `/api/v1/projects/:id/evolution/roadmap`| `PROJECT_READ` | Oui (`getProject`) | Param `:id` | Aucun | Roadmap NOW/NEXT/LATER |
| **GET** | `/api/v1/projects/:id/evolution/scenarios`| `PROJECT_READ`| Oui (`getProject`) | Param `:id` | Aucun | Scénarios de compromis |
| **POST** | `/api/v1/projects/:id/evolution/what-if`| `PROJECT_READ` | Oui (`getProject`) | JSON `{question, target}` | Simulation d'impact | Consommation CPU |
| **DELETE**| `/api/v1/projects/:id/evolution` | `PROJECT_UPDATE`| Oui (`getProject`) | Param `:id` | Purge du cache LRU du rapport | Vidage de cache non contrôlé |
| **POST** | `/api/v1/projects/:id/evolution/proposals/:pId/decision`| `PROJECT_UPDATE`| Oui (`getProject`) | JSON `{type, reason}` | Transition de statut de proposal | Validation sans supervision OWNER |
| **GET** | `/api/v1/projects/:id/files` | `PROJECT_READ` | Oui (`assertProjectAccess`) | Param `:id` | Aucun | Arborescence complète des fichiers |
| **GET** | `/api/v1/projects/:id/files/content` | `PROJECT_READ` | Oui (`assertProjectAccess`) | Query `?path=` | Aucun | Lecture du code source virtuel |
| **PUT** | `/api/v1/projects/:id/files/content` | `PROJECT_UPDATE`| Oui (`assertProjectAccess`) | JSON `{path, content}` (10 Mo) | **Écriture dans FileStore RAM** | **SEC-013 : Heap DoS OOM Crash** |
| **POST** | `/api/v1/projects/:id/terminal/execute` | `ENGINEER` | Oui (`assertProjectAccess`) | JSON `{command}` | Simulation de commande | Safe: Mock terminal sans shell |
| **GET** | `/api/v1/projects/:id/settings` | `PROJECT_READ` | Oui (`getProject`) | Param `:id` | Aucun | **SEC-012 : Fuite de DATABASE_URL** |
| **PUT** | `/api/v1/projects/:id/settings` | `PROJECT_UPDATE`| Oui (`getProject`) | JSON `{stack, envVars}` | Modification de variables d'env | Altération de configuration |
| **GET** | `/api/v1/projects/:id/revisions` | `PROJECT_READ` | Oui (`getProject`) | Param `:id` | Aucun | Historique des révisions du projet |
| **POST** | `/api/v1/projects/:id/revisions` | `PROJECT_UPDATE`| Oui (`getProject`) | JSON `{message, files, author}` | Création de snapshot révision | **SEC-016 : Usurpation d'auteur** |
| **POST** | `/api/v1/projects/:id/revisions/:rId/rollback` | `PROJECT_UPDATE`| Oui (`getProject`) | Param `:id`, `:rId` | Restauration de l'état du code | Déclenchement de rollback |
