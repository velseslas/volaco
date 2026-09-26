# ANALYSE DE LA SURFACE D'ATTAQUE POST-REMÉDIATION
## VOLACO-CORE — CARTOGRAPHIE DES VECTEURS ET FRONTIÈRES D'EXPOSITION

**Périmètre :** Monorepo complet `volaco-core`  
**Date d'évaluation :** 11 Septembre 2026  

---

### 1. Frontière Réseau & Points d'Entrée Non Authentifiés

Le serveur HTTP Node.js expose deux zones distinctes : la zone publique non authentifiée et la zone privée protégée par Bearer JWT.

#### A. Points d'Entrée Publics (Sans Token Exigé)

| Route / Ressource | Méthode | Rôle & Fonction | Risque Identifié |
| :--- | :---: | :--- | :--- |
| `/`, `/index.html`, `/studio` | `GET` | Distribution de l'interface Studio HTML | Injection automatique d'un JWT `ENGINEER` pour `default-tenant` (`window.__VO_SESSION_TOKEN__`). |
| `/:staticStudioFile` | `GET` | Distribution des assets statiques locaux (`js`, `css`, `png`, `svg`) | Vérification sommaire `!includes('..')` sans `path.resolve` étanche (SEC-005). |
| `/health`, `/api/v1/health` | `GET` | Sonde d'état et diagnostic de santé | Exposition de la configuration et de l'environnement d'exécution. |
| `/status`, `/api/v1/status` | `GET` | Statut opérationnel du monolithe modulaire | Divulgation de la phase et de l'architecture. |
| `/metrics`, `/api/v1/metrics`| `GET` | Métriques de performances globales et latences | Surveillance inter-tenants des volumes de trafic et taux d'erreurs (SEC-015). |
| `/api/v1/auth/session` | `POST` | Émission d'un token de session de développement | Délivrance sans mot de passe d'un jeton avec droits d'ingénieur pour `default-tenant`. |

---

### 2. Frontière Authentifiée (Contrôle d'Accès & RBAC)

Toutes les autres routes HTTP (38 endpoints) sont protégées par le middleware `extractRequestContext()`, qui impose :
* Un en-tête `Authorization: Bearer <HMAC-SHA256-JWT>`.
* La signature du jeton avec la clé cryptographique `AUTH_SECRET` (minimum 32 caractères).
* L'extraction du contexte utilisateur `{ tenantId, role }`.

#### Matrice des Privilèges par Rôle

```
                    ┌────────────────────────────┐
                    │           OWNER            │ (Tous les droits + TENANT_MANAGE)
                    └─────────────┬──────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │           ADMIN            │ (Création, Lecture, Mise à jour, Suppression)
                    └─────────────┬──────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │          ENGINEER          │ (Création, Lecture, Mise à jour, Mutation)
                    └─────────────┬──────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │           VIEWER           │ (Lecture seule exclusive - PROJECT_READ)
                    └────────────────────────────┘
```

---

### 3. Surface d'Attaque Côté Navigateur (Frontend Studio)

Le frontend Studio (`apps/studio/index.html`) constitue une interface à haute densité fonctionnelle contenant plus de 12 000 lignes de JavaScript vanilla :

1. **La Sandbox Preview (`#wsLiveIframe`) :**
   - **Frontière :** Attribut `sandbox="allow-scripts allow-modals allow-forms allow-popups allow-downloads"`.
   - **Isolation :** Pas de `allow-same-origin`. L'origine est opaque (`null`), interdisant l'accès direct au DOM et aux storages de la fenêtre parente.
   - **Canal de communication :** Événements `postMessage`.
   - **Contrôle de source :** Le parent vérifie strictement `event.source === iframe.contentWindow` et rejette toute charge utile contenant `command`, `action` ou `eval`.
   - **Rendu des logs :** Les messages sont neutralisés par `escapeTerminalHtml()` avant insertion dans le terminal.

2. **La Dépendance CDN Externe :**
   - Les scripts `html2canvas`, `jszip` et `font-awesome` sont verrouillés par des condensats SHA-512 SRI avec `crossorigin="anonymous"`.
   - Le script Tailwind CDN (`https://cdn.tailwindcss.com`) est chargé dynamiquement en cas d'absence de la version locale, sans condensat SRI.

3. **La Prévisualisation Déportée (`popoutPreview`) :**
   - Création d'un Blob URL `text/html;charset=utf-8`.
   - Ouverture via `window.open(url, '_blank', 'noopener,noreferrer')`.
   - Révocation automatique du Blob URL après 15 secondes.

---

### 4. Surface d'Exposition de l'Agent Runtime & du Moteur de Mutation

La chaîne d'exécution agentique relie l'utilisateur au système de fichiers virtuel :

```
[Prompt Utilisateur]
        │
        ▼
[Proxy IA /api/v1/ai] ──(Délimiteurs XML <user_input>)──► [Modèle LLM Codestral]
        │                                                           │
        │◄──────────────────(Plan d'Ingénierie JSON)────────────────┘
        │
        ▼
[Agent Runtime / Planner]
        │
        ▼
[Validateur & ToolRegistry] ──(Vérification AgentCapabilityError)
        │
        ▼
[MutationOrchestrator] ──────(Vérification RBAC PROJECT_MUTATE)
        │
        ▼
[FileStore (In-Memory)]
```

* **Point d'attention de sécurité :** Dans `executor.ts`, pour tout rôle disposant de `PROJECT_MUTATE`, les options `allowBreaking` et `allowHighRisk` valent `true` si le plan ne les spécifie pas.
* **Herméticité Multi-Tenant du Rollback :** La fonction `mutationService.rollback()` exige désormais que `tenantId` corresponde à l'attribut `tenantId` scellé dans la transaction sous peine de `ForbiddenError` (403).

---

### 5. Surface Mémoire & Persistance

* Tous les magasins de données (`FileStore`, `ProjectStore`, `RevisionStore`, `AuditStore`) résident exclusivement dans la mémoire vive du processus Node.js.
* Aucune écriture sur le système de fichiers physique de l'hôte n'est effectuée par les services de fichiers ou de projets (aucun risque de corruption de fichiers hôtes par ce biais).
* Le système est vulnérable à l'épuisement mémoire (Heap DoS) en cas de multiplication de locataires ou d'accumulation de clés dans le RateLimiter.
