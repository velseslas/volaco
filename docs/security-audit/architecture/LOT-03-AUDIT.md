# LOT 03 — AUDIT D'ARCHITECTURE : STUDIO ↔ CANONICAL APPLICATION MODEL

> **Date :** 14 Septembre 2026  
> **Statut :** PHASE 1 VALIDÉE — PRÊT POUR IMPLÉMENTATION (PHASE 2)  
> **Auteur :** Antigravity AI Engine (Google DeepMind)  
> **Périmètre :** Volaco Core — Studio Frontend (`apps/studio/index.html`, `volaco_studio.html`), API Tier (`apps/api/src/`), Core Domain (`packages/core/src/`)  
> **Règle absolue :** Phase 1 = AUDIT UNIQUEMENT. Zéro modification de code en Phase 1.

---

## 1. ARCHITECTURE ACTUELLE

Le système Volaco Core repose à ce jour sur une séparation architecturale nette entre le backend serveur Node.js / Fastify et l'interface client VibeCode Studio :

1. **Serveur Backend (`apps/api/src/server.ts`)** :
   - Serveur HTTP natif durci avec Content-Security-Policy (SEC-005, SEC-007, SEC-011), Rate Limiter (SEC-013), et authentification JWT multi-tenant étanche (`RequestContext` avec `tenantId`, `role`, et permissions RBAC `assertPermission`).
   - Distribution statique du Studio sur les chemins `/`, `/index.html`, `/volaco_studio.html`, `/shell`, `/studio` avec résolution canonique stricte.
   - Persistance durable sur disque via `DurableFileStorage` sous `.volaco_data/` (`projects.json`, `revisions.json`, `application_models.json`, `application_model_versions.json`).
   - Couche canonique LOT 02 établie et validée : `ApplicationModelStore`, `ApplicationModelRepository`, `ApplicationModelValidator`, `SchemaMigrationEngine`, exposés sous `/api/v1/projects/:projectId/application-model*`.

2. **Studio Frontend (`apps/studio/index.html` & miroir `volaco_studio.html`)** :
   - Application Web monopage (SPA) autonome de 971 902 octets, conçue pour être servie soit par le serveur Volaco, soit utilisable de manière autonome en mode déconnecté.
   - Parité binaire stricte byte-for-byte requise et validée par la Quality Gate 2 (Check 7/7) et `supply-chain.test.ts`.
   - Actuellement, le Studio maintient son propre état local en mémoire (`userProjects`, `activeProjectId`, `virtualFiles`, `currentAppHtml`) synchronisé avec `localStorage`.

---

## 2. FLUX STUDIO → API

Dans l'état actuel du code, le Studio initie les requêtes sortantes suivantes vers l'API via le helper `authenticatedFetch` :

1. **Synchronisation des projets** (`syncStudioWithServer`) :
   - `GET /api/v1/projects` : Récupère la liste des projets existants sur le serveur pour le tenant courant.
   - `POST /api/v1/projects` : Si le serveur ne contient aucun projet, le Studio tente de pousser ses projets locaux initiaux avec `{ name, description, customId }`.
2. **Persistance d'un fichier et création de révision** (`syncSaveFileToServer`) :
   - `PUT /api/v1/projects/:projectId/files/content` : Sauvegarde le contenu d'un fichier (ex: `index.html`).
   - `POST /api/v1/projects/:projectId/revisions` : Crée une révision avec snapshot des fichiers et métadonnées d'auteur.
3. **Création manuelle de projet** (`syncCreateProjectToServer`) :
   - `POST /api/v1/projects` puis `PUT /api/v1/projects/:projectId/files/content`.
4. **Suppression de projet** (`syncDeleteProjectToServer`) :
   - `DELETE /api/v1/projects/:projectId`.
5. **Services IA et Observabilité** :
   - `/api/v1/ai/status`, `/api/v1/ai/configure-key`, `/api/v1/ai/chat/completions`.
   - `/api/v1/projects/:projectId/audit`, `/api/v1/projects/:projectId/history`.

> **CONSTAT CRITIQUE DE RUPTURE :**  
> Le Studio **n'appelle JAMAIS** les routes `/api/v1/projects/:projectId/application-model*`.  
> Le flux Studio → API ignore totalement l'Application Model canonique serveur mis en place au LOT 02.

---

## 3. FLUX API → STUDIO

L'état entrant consommé par le Studio depuis l'API est restreint à :

1. La liste des projets (`{ projects: [{ id, name, description }] }`) issue de `GET /api/v1/projects`.
2. Le contenu brut du fichier `index.html` via `GET /api/v1/projects/:projectId/files/content?path=index.html`.
3. Les accusés de réception (status 200/201) de sauvegarde de fichier et de révision.

Le Studio ignore actuellement :
- Le `Canonical Application Model` (schéma v1.0 / v1.1).
- Le `modelVersion` (clé de voûte de l'optimistic concurrency locking).
- L'arborescence réelle des fichiers (`GET /api/v1/projects/:projectId/files`).
- L'historique complet des révisions du projet (`GET /api/v1/projects/:projectId/revisions`).
- L'état agrégé du projet (`GET /api/v1/projects/:projectId/state`).

---

## 4. UTILISATION ACTUELLE DE LOCALSTORAGE

L'inspection exhaustive du Studio révèle 4 clés de stockage local :

| Clé `localStorage` | Rôle actuel | Diagnostic | Stratégie LOT 03 |
| :--- | :--- | :--- | :--- |
| `vibecode_studio_user_key` | Token de session JWT / Clé utilisateur | Requis pour l'authentification cross-requêtes et les tests | **KEEP** — Conserver tel quel. |
| `vibecode_studio_theme` | Préférence cosmétique (`light` / `dark`) | Pure préférence UI, aucun impact données | **KEEP** — Conserver tel quel. |
| `vibecode_persisted_app` | Contenu HTML de l'application en cours | Écrasement aveugle sans `tenantId` ni `projectId`. Risque de contamination cross-projet | **DEPRECATE / ISOLATE** — Clé préfixée par tenant/projet, utilisée uniquement en secours offline. |
| `vibecode_saved_projects` | Tableau JSON complet des projets et de leurs codes | Agit comme une seconde source de vérité concurrente au serveur | **MIGRATE / DEPRECATE SOURCE** — Rétrogradé en cache local passif indexé par version. Le serveur est la source de vérité. |

*Polyfill de sécurité :* Le polyfill `createSafeStorage` (mémoire volatile en cas de restriction d'accès aux cookies/stockage tiers) est maintenu sans modification.

---

## 5. APPELS APPLICATION MODEL EXISTANTS

- **Côté Studio (`apps/studio/index.html`) :**  
  **0 appel.** Aucune référence aux endpoints `/api/v1/projects/:projectId/application-model`.
- **Côté Backend (`apps/api/src/routes/application-model.ts`) :**  
  Toutes les routes nécessaires sont opérationnelles et testées (LOT 02) :
  - `GET /api/v1/projects/:projectId/application-model`
  - `POST /api/v1/projects/:projectId/application-model/changes`
  - `POST /api/v1/projects/:projectId/application-model/propose`
  - `GET /api/v1/projects/:projectId/application-model/versions`
  - `GET /api/v1/projects/:projectId/application-model/versions/:version`
  - `POST /api/v1/projects/:projectId/application-model/validate`
  - `POST /api/v1/projects/:projectId/application-model/migrate`
  - `POST /api/v1/projects/:projectId/application-model/rollback`

---

## 6. DONNÉES ACTUELLEMENT CALCULÉES LOCALEMENT

Le Studio fabrique aujourd'hui de manière autonome et factice des représentations applicatives :

1. **`renderApplicationModelTree()` :**  
   Parse le code HTML brut de l'éditeur avec `DOMParser`, compte les balises `<form>`, `<button>`, `<input>`, `<script>`, et génère un faux arbre DOM prétendant représenter le modèle applicatif.
2. **`renderDnaView()` :**  
   Affiche un objet JSON en dur (`dnaRawJsonBlock`) avec un `schemaVersion: "7.0.0"` fictif et des invariants statiques.
3. **Identifiants de projet :**  
   Génération d'identifiants côté client via `'proj-' + Date.now()`.
4. **Gestion des révisions en mémoire :**  
   `appVersionHistory = [currentAppHtml]` géré localement dans un tableau JavaScript.

---

## 7. CONFLITS ENTRE ÉTAT LOCAL ET ÉTAT SERVEUR

L'audit a mis en évidence quatre sources majeures de divergence :

1. **Désynchronisation des identifiants de projet (`customId`) :**  
   Le Studio transmet `customId: projId` lors de `POST /api/v1/projects`. Or, `apps/api/src/routes/projects.ts` ne transmettait pas ce champ à `projectStore.createProject(tenantId, name, description, customId)`. Le serveur générait donc son propre ID aléatoire (`proj_...`), rendant les appels ultérieurs du Studio sur `proj-...` caducs (HTTP 404).
2. **Absence d'Optimistic Concurrency Control dans le Studio :**  
   Lors de la sauvegarde (`executeSaveCode`), le Studio n'envoie aucun `expectedModelVersion`. Si deux onglets ou deux utilisateurs modifient le projet, le dernier enregistrement écrase aveuglément les modifications de l'autre sans jamais lever le code HTTP 409 Conflict.
3. **Écrasement aveugle par `localStorage` au chargement :**  
   Au rechargement de la page, le Studio charge d'abord le contenu de `localStorage.getItem('vibecode_saved_projects')`. Si le serveur a été mis à jour par un autre client, le Studio affiche des données périmées jusqu'à ce qu'un `syncStudioWithServer` vienne (ou non) les remplacer.
4. **Faux boutons d'opérations fichiers dans le Studio :**  
   Les fonctions `uiCreateNewFile`, `uiCreateNewFolder`, `uiTriggerRenameFile`, `uiTriggerDeleteFile` se contentaient d'afficher un `prompt()` ou un `confirm()` puis un toast/log sans jamais invoquer les API de `FileStore` (`/api/v1/projects/:projectId/files*`).

---

## 8. FONCTIONS DE SYNCHRONISATION EXISTANTES

- `syncStudioWithServer()` : Seule fonction de synchronisation globale. Elle est asynchrone, non bloquante, et ne gère que les projets et `index.html`.
- `syncSaveFileToServer(projId, filePath, content)` : Envoie le fichier via PUT puis crée une révision via POST.
- `syncCreateProjectToServer(projId, name, category, initialCode)` : Crée le projet et son premier fichier.
- `syncDeleteProjectToServer(projId)` : Supprime le projet côté serveur.

Ces fonctions n'informent aucun indicateur d'état dans l'interface utilisateur. L'utilisateur ne sait jamais si son projet est synchronisé, en cours de sauvegarde, en conflit ou hors-ligne.

---

## 9. RISQUES DE MIGRATION

1. **Régression de la parité byte-for-byte :**  
   `apps/studio/index.html` et `volaco_studio.html` (ainsi que la copie brain) doivent impérativement demeurer identiques au bit près, sous peine d'échec immédiat de la Quality Gate 2 (Check 7/7).
2. **Régression de sécurité :**  
   Les règles strictes de multi-tenant (`tenantId:projectId`), de sandboxing de l'iframe de preview (`sandbox="allow-scripts allow-modals allow-forms allow-popups allow-downloads"` sans `allow-same-origin`), et les condensats cryptographiques SRI SHA-512 des CDN ne doivent pas être altérés.
3. **Perte de données utilisateur :**  
   Si la migration de `localStorage` purge sans précaution l'état local avant confirmation de la persistance serveur, l'utilisateur pourrait perdre son travail.
4. **Blocage en cas d'API indisponible :**  
   Le Studio doit rester robuste et utilisable en mode dégradé (OFFLINE) avec alerte claire si le serveur API n'est pas joignable.

---

## 10. FICHIERS À MODIFIER

1. **`apps/api/src/routes/projects.ts`** :
   - Accepter le champ `customId` dans le payload de création de projet `POST /api/v1/projects`.
   - Initialiser systématiquement le Canonical Application Model lors de la création d'un projet (`applicationModelStore.getModel(tenantId, project.id)`).
2. **`apps/studio/index.html`** (et duplication binaire stricte sur `volaco_studio.html` et copie d'intégrité brain) :
   - Intégrer l'état de synchronisation unifié : `SYNCED`, `DIRTY`, `SYNCING`, `CONFLICT`, `OFFLINE`, `ERROR`.
   - Ajouter un badge visuel minimal et réactif dans la barre supérieure du Workspace Studio (`#studioSyncStatusBadge`).
   - Mettre à jour `openProject` pour charger de manière asynchrone et prioritaire le Canonical Application Model (`GET /api/v1/projects/:projectId/application-model`).
   - Mettre à jour `renderApplicationModelTree()` pour afficher la véritable arborescence canonique du modèle (Pages, Routes, Composants, APIs, Données, Permissions, Design System, Architecture) au lieu du comptage DOM factice.
   - Injecter `expectedModelVersion` lors de la persistance et intercepter les erreurs HTTP 409 pour déclencher l'état `CONFLICT` dans l'UI.
   - Rétrograder `localStorage` au statut de cache secondaire avec vérification de version et cloisonnement `tenantId:projectId`.
   - Brancher les opérations fichiers (`uiCreateNewFile`, `uiTriggerRenameFile`, `uiTriggerDeleteFile`) sur l'API serveur `files`.
3. **`apps/api/tests/lot03-studio-application-model.test.ts`** :
   - Nouvelle suite de tests d'intégration complète (33 tests couvrant les sections A à H).

---

## 11. FICHIERS À NE PAS MODIFIER

- `apps/api/src/middleware/auth.ts` (Authentification HMAC et RequestContext gelés).
- `apps/api/src/middleware/rate-limiter.ts` (Rate limiting gelé).
- `packages/core/src/model/application-model/types.ts` (Contrat canonique LOT 02 gelé).
- `packages/core/src/model/application-model/validator.ts` (Validateur LOT 02 gelé).
- `packages/core/src/model/application-model/migration.ts` (Moteur de migration schéma gelé).
- `apps/api/tests/security/*` (Tous les tests P6/P7/P8 gelés).

---

## 12. STRATÉGIE PROPOSÉE

```text
┌───────────────────────────────────────────────────────────────┐
│                      STUDIO UI WORKSPACE                      │
│                                                               │
│   [SaaS Pulse Analytics]  [● Unsaved / ✓ Synced / ⚠ Conflict] │
│                                                               │
│   ┌───────────────────────┐   ┌───────────────────────────┐   │
│   │ Canonical Model View  │   │ Code Editor / Preview     │   │
│   │ ├── Pages (1)         │   │ (index.html)              │   │
│   │ ├── Routes (1)        │   │                           │   │
│   │ ├── Components (1)    │   │                           │   │
│   │ ├── Design / Tokens   │   │                           │   │
│   │ └── Architecture      │   │                           │   │
│   └───────────────────────┘   └───────────────────────────┘   │
└───────────────────────────────┬───────────────────────────────┘
                                │
                 REST (avec expectedModelVersion)
                                │
                                ▼
┌───────────────────────────────────────────────────────────────┐
│                      VOLACO CORE SERVER                       │
│                                                               │
│   POST /projects  ──────>  ProjectStore                       │
│   GET /app-model  ──────>  ApplicationModelStore              │
│   POST /changes   ──────>  Optimistic Lock Check (409)        │
│   PUT /files      ──────>  FileStore / RevisionStore          │
│                                │                              │
│                                ▼                              │
│                      DURABLE PERSISTENCE                      │
│                      (.volaco_data/*.json)                    │
└───────────────────────────────────────────────────────────────┘
```

1. **Source de Vérité Unique :**  
   L'état serveur dans `ApplicationModelStore` est l'unique autorité.
2. **Cycle de Vie du Chargement (`openProject`) :**  
   - Affichage immédiat du cache local pour réactivité UX (`OFFLINE` ou `SYNCING`).
   - Appel concurrent de `GET /api/v1/projects/:projectId/application-model`.
   - Mise à jour de l'état mémoire Studio avec les données canoniques (`model`, `modelVersion`).
   - Passage en état `SYNCED`.
3. **Machine à États de Synchronisation :**  
   - Modification dans l'éditeur $\rightarrow$ `DIRTY` (`● Unsaved changes`).
   - Déclenchement sauvegarde $\rightarrow$ `SYNCING` (`↻ Saving...`).
   - Succès de la persistance $\rightarrow$ `SYNCED` (`✓ Synced`).
   - Rejet HTTP 409 (version obsolète) $\rightarrow$ `CONFLICT` (`⚠ Conflict`).
   - Perte réseau / timeout $\rightarrow$ `OFFLINE` (`⌁ Offline`).
   - Erreur 500 / validation $\rightarrow$ `ERROR` (`✕ Sync error`).
4. **Optimistic Locking & Concurrence :**  
   Le client Studio fournit son `expectedModelVersion` lors de chaque modification du modèle. En cas de réponse HTTP 409, l'écrasement est empêché et l'utilisateur est averti.
5. **Cloisonnement Multi-Tenant :**  
   Toutes les lectures/écritures cache et requêtes API transmettent et valident rigoureusement le tuple `(tenantId, projectId)`.

---

## 13. TESTS NÉCESSAIRES

La suite dédiée `apps/api/tests/lot03-studio-application-model.test.ts` couvrira l'intégralité des 33 cas d'usage imposés :

- **A — Initialisation (Tests 1-4) :**
  1. Création d'un nouveau projet avec son modèle canonique par défaut.
  2. Vérification que l'ApplicationModel associé au projet est créé et valide.
  3. Projet legacy existant sans modèle : auto-initialisation canonique transparente.
  4. Idempotence de l'initialisation (aucun doublon de modèle ni de version).
- **B — Chargement (Tests 5-8) :**
  5. Chargement de l'état du projet par le Studio.
  6. Chargement du Canonical Application Model et de ses sections.
  7. Récupération des révisions associées au projet.
  8. Récupération des fichiers du projet.
- **C — Synchronisation (Tests 9-14) :**
  9. Détection de modification et transition d'état.
  10. Sauvegarde et mise à jour durable.
  11. Création d'une révision liée aux changements.
  12. Mise à jour de l'ApplicationModel et incrémentation de `modelVersion`.
  13. Persistance après rafraîchissement (rechargement sans perte).
  14. Persistance après redémarrage du serveur API.
- **D — Conflits et Concurrence (Tests 15-18) :**
  15. Détection d'un `modelVersion` obsolète.
  16. Sauvegardes concurrentes simulant deux onglets du Studio.
  17. Réponse stricte HTTP 409 Conflict sur version périmée.
  18. Garantie absolue contre tout écrasement silencieux.
- **E — LocalStorage & Cache (Tests 19-22) :**
  19. Validation d'un cache local cohérent avec le serveur.
  20. Détection et rejet d'un cache obsolète par rapport au serveur.
  21. Rejet d'un cache appartenant à un autre projet.
  22. Rejet d'un cache appartenant à un autre tenant.
- **F — Multi-Tenant (Tests 23-24) :**
  23. Projets partageant le même `projectId` dans deux tenants distincts.
  24. Étanchéité hermétique : zéro fuite de modèle ou de fichiers entre tenants.
- **G — Cohérence des Fichiers (Tests 25-29) :**
  25. Création de fichier et répercussion dans le modèle/révision.
  26. Mise à jour de fichier.
  27. Suppression de fichier.
  28. Renommage de fichier.
  29. Déplacement de fichier.
- **H — Robustesse (Tests 30-33) :**
  30. Comportement et statut en cas d'API indisponible.
  31. Gestion propre des timeouts réseau.
  32. Rejet des payloads invalides avec message explicite.
  33. Récupération automatique après rétablissement de l'erreur.

---

## 14. CRITÈRES DE SORTIE

La Phase 1 d'audit est validée. Le passage en Phase 2 d'implémentation est conditionné aux critères suivants :

1. Architecture cible formellement documentée et alignée avec les LOT 01 et LOT 02.
2. Clés `localStorage` inventoriées et rétrogradées en cache passif.
3. Aucune modification de code prématurée effectuée durant l'audit.
4. Parité binaire stricte de `apps/studio/index.html` préservée pour la Phase 2.
5. Invariants de sécurité P6, P7 et P8 totalement préservés.

**Verdict Phase 1 : AUDIT VALIDÉ — AUTORISATION D'ENGAGER LA PHASE 2 D'IMPLÉMENTATION.**
