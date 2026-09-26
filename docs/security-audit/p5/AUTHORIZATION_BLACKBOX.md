# ATTAQUES DE PRIVILÈGES ET MATRICE RBAC (AUTHORIZATION_BLACKBOX)

## 1. Confinement des Rôles Standard

- **Rôle VIEWER :**
  - Tentative de création de projet (`POST /api/v1/projects`) -> **HTTP 403 Forbidden** (Confirmé).
  - Tentative d'écriture de fichier (`POST /api/v1/files/write`) -> **HTTP 403 Forbidden** (Confirmé).
  - Tentative d'exécution de terminal -> **HTTP 403 Forbidden** (Confirmé).
- **Rôle ENGINEER :**
  - Tentative de suppression de projet (`DELETE /api/v1/projects/:id`) -> **HTTP 403 Forbidden** (Confirmé).
  - Tentative d'accès à l'audit du tenant (`GET /api/v1/audit`) -> **HTTP 403 Forbidden** (Confirmé).

## 2. Écart Découvert : Absence de Contrôle RBAC sur le Proxy IA

- **Constat :** Dans `apps/api/src/routes/ai.ts`, la fonction `handleAiProxyRoutes` valide l'authentification (`extractRequestContext`), mais n'appelle aucune assertion de permission RBAC (`assertPermission`).
- **Conséquence :** Un utilisateur disposant uniquement du rôle `VIEWER` peut émettre des requêtes sur `POST /api/v1/ai/chat/completions` et consommer la clé Mistral serveur de l'organisation.
