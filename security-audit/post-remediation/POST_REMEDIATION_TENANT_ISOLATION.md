# AUDIT D'ÉTANCHÉITÉ MULTI-TENANT POST-REMÉDIATION
## VOLACO-CORE — MATRICE D'ISOLATION HERMÉTIQUE ET FRONTIÈRES LOCATAIRES

**Périmètre :** Monorepo complet `volaco-core`  
**Objectif :** Vérifier qu'aucun utilisateur d'un Tenant A ne peut lire, modifier, supprimer ou déclencher une opération sur une ressource du Tenant B.

---

### 1. Règle Fondamentale d'Étanchéité

Dans `volaco-core`, l'identité du locataire (`tenantId`) doit être :
1. **Dérivée exclusivement** du jeton Bearer JWT cryptographiquement signé et vérifié par `verifyAuthToken()`.
2. **Injectée de manière immuable** dans le `RequestContext` de la requête HTTP.
3. **Propagée obligatoirement** à chaque méthode des services métiers de `packages/core`.
4. **Utilisée comme premier composant de clé** dans tous les magasins de données (composite key `${tenantId}:${projectId}`).

---

### 2. Matrice d'Isolation Multi-Tenant

| Ressource | Identifiant Stockage | Mécanisme d'Isolation | Preuve de Code | Résultat |
| :--- | :--- | :--- | :--- | :---: |
| **Projets (`ProjectStore`)** | `projects.set(id, project)` | `getProject(tenantId, id)` vérifie `project.tenantId === tenantId`. `listProjects(tenantId)` filtre par `tenantId`. | `packages/core/src/identity/project.ts:52-58` | **HERMÉTIQUE** |
| **Fichiers virtuels (`FileStore`)** | `projectFiles.set('${tenantId}:${projectId}', map)` | La Map de fichiers est indexée par le couple `tenantId:projectId`. Accès projet vérifié en amont. | `packages/core/src/file-explorer/store.ts:50-52` | **HERMÉTIQUE** |
| **Révisions & Snapshots (`RevisionStore`)** | `revisions.set('${tenantId}:${projectId}', revs)` | Clé composite stricte `tenantId:projectId`. Vérification de propriété du projet préalable. | `packages/core/src/model/revision-store.ts:18-20` | **HERMÉTIQUE** |
| **Paramètres de Projet (`SettingsStore`)** | `settings.set('${tenantId}:${projectId}', data)` | Clé composite stricte `tenantId:projectId`. Vérification de propriété préalable. | `packages/core/src/settings/service.ts:25-30` | **HERMÉTIQUE** |
| **Terminal Sandboxé (`TerminalService`)** | Exécution sans persistance locale | Vérifie `projectStore.getProject(tenantId, projectId)` avant toute exécution de commande. | `packages/core/src/terminal/service.ts:36-39` | **HERMÉTIQUE** |
| **Transactions de Mutation (`MutationOrchestrator`)** | `transactions.set(txId, tx)` | `rollback()` vérifie `if (tenantId && tx.tenantId !== tenantId) throw ForbiddenError`. | `packages/core/.../mutation-orchestrator/service.ts:478-483` | **HERMÉTIQUE** |
| **Consommation & Quotas IA (`AiUsageTracker`)** | `tenantUsage.set(tenantId, records)` | Agrégation et comptage de tokens cloisonnés par `tenantId`. | `packages/core/src/ai/usage.ts:35-45` | **HERMÉTIQUE** |
| **Concurrence Requêtes IA (`activeAiRequests`)** | `activeAiRequestsPerTenant.set(tenantId, n)` | Plafonnement de 5 requêtes simultanées par `tenantId`. | `apps/api/src/routes/ai.ts:89-110` | **HERMÉTIQUE** |
| **Journal d'Audit (`AuditStore`)** | `events.push(event)` avec `tenantId` | `auditStore.query(tenantId)` filtre strictement par `tenantId`. Accessible uniquement avec le rôle `OWNER` (`TENANT_MANAGE`). | `packages/core/src/observability/audit.ts:38-45` | **HERMÉTIQUE** |
| **Moteur d'Évolution (`AINT-017`)** | `proposalStore.set('${tenantId}::${projectId}::${id}')` & Cache LRU | Préfixe composite strict. `assertTenant()` valide l'appartenance du rapport. | `packages/core/src/ai-native/evolution/service.ts:80-88` | **HERMÉTIQUE** |

---

### 3. Analyse des Vecteurs de Fuite et Exceptions

#### A. Le `tenantId` est-il jamais récupéré du corps de la requête ou de la query ?
* **Non.** Dans toutes les routes d'ingénierie (`/projects`, `/files`, `/terminal`, `/evolution`, `/audit`, `/revisions`), `context.tenantId` provient exclusivement du JWT. Même si le client injecte `{ "tenantId": "autre_tenant" }` dans son payload JSON, cette valeur est ignorée et écrasée par `context.tenantId`.

#### B. Le `tenantId` peut-il être perdu pendant un traitement asynchrone ?
* **Non.** Toutes les fonctions de la chaîne d'appel reçoivent explicitement `context.tenantId` en argument direct sans passer par une variable globale ou un stockage de thread partagé susceptible de provoquer des collisions de concurrence.

#### C. L'exception architecturale : Le `default-tenant` public
* **Constat :** L'endpoint `POST /api/v1/auth/session` et la distribution de `index.html` injectent un jeton valide pour `tenantId: 'default-tenant'`.
* **Conséquence :** Ce locataire particulier est en accès libre. Il ne bénéficie d'aucune confidentialité et doit être considéré comme un bac à sable public éphémère.
* **Recommandation :** Interdire la création de projets confidentiels sous `default-tenant` et désactiver l'auto-émission de tokens en mode production multi-clients.

---

### 4. Conclusion sur l'Étanchéité Multi-Tenant

L'objectif de sécurité est **PLEINEMENT ATTEINT** sur le plan de la cloisonnement des données :
**Aucun utilisateur authentifié sur le Tenant A ne peut lire, modifier, détruire ou déclencher d'opérations sur les ressources du Tenant B.**
